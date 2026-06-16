/* ============================================================
   Split the Bill — multi-trip, backend-synced.
   Reads gated by passcode; editing requires admin login.
   ============================================================ */
(() => {
  "use strict";

  const API = "/api";
  const PASS_KEY = "balitrip-pass";
  const PALETTE = ["#ff6f59", "#2fd6c3", "#ffb454", "#c08cff", "#7bd88f", "#ff8fc7", "#ffd66b", "#6cb8ff"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const grp = new Intl.NumberFormat("en-US");

  // --- state ---
  let tripId = new URLSearchParams(location.search).get("t") || "";
  let doc = null;
  let pass = "";
  let admin = false, loginEnabled = false;
  const canEdit = true;   // any passcode user can edit money entries (editor tier); admin adds people/trip/OCR
  let CUR = "IDR";
  let personById = {}, personColor = {};
  let pollTimer = null;

  const $ = (s) => document.querySelector(s);
  const money = (n) => (CUR === "IDR" ? "Rp " : CUR + " ") + grp.format(Math.round(n || 0));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cacheKey = () => "balitrip-trip-" + tripId;
  const sumItems = (items) => (items || []).reduce((s, it) => s + (it.lineTotal || 0), 0);

  function fmtWhen(date, time) {
    let out = "";
    if (date) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
      if (m) out = parseInt(m[3], 10) + " " + (MONTHS[parseInt(m[2], 10) - 1] || "");
    }
    if (time) out += (out ? " · " : "") + String(time).slice(0, 5);
    return out.trim();
  }
  const dateSortKey = (r) => (r.date || "9999-99-99") + " " + (r.time || "99:99");

  // --- api ---
  async function api(path, opts = {}) {
    const headers = {};
    if (pass) headers["X-Passcode"] = pass;
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const res = await fetch(API + path, { method: opts.method || "GET", headers, body, credentials: "same-origin" });
    if (!res.ok) {
      const e = new Error("api " + res.status); e.code = res.status;
      try { e.body = await res.json(); } catch (_) {}
      throw e;
    }
    return res.status === 204 ? null : res.json();
  }

  function adoptDoc(d) {
    if (!d || !d.trip) return;
    doc = d;
    CUR = d.trip.baseCurrency || "IDR";
    personById = {}; personColor = {};
    (d.people || []).forEach((p, i) => { personById[p.id] = p; personColor[p.id] = p.color || PALETTE[i % PALETTE.length]; });
    try { localStorage.setItem(cacheKey(), JSON.stringify(d)); } catch (_) {}
  }
  function cacheLoad() {
    try { const raw = localStorage.getItem(cacheKey()); if (raw) return JSON.parse(raw); } catch (_) {}
    return null;
  }

  function setSync(status) {
    const el = $("#sync"); if (!el) return;
    el.classList.toggle("live", status === "live");
    el.classList.toggle("offline", status === "offline");
    $("#syncLabel").textContent = status === "live" ? "live" : status === "offline" ? "offline" : "syncing…";
  }

  // a write returns the full doc; adopt + re-render. Optimistic local edits happen first.
  function pushDoc(promise) {
    return promise
      .then((d) => { adoptDoc(d); render(); setSync("live"); return d; })
      .catch((e) => {
        if (e.code === 401) lock("Session expired — enter passcode");
        else if (e.code === 403) { setSync("offline"); alert("Editing needs login."); refreshTrip(); }
        else setSync("offline");
        throw e;
      });
  }

  // ---------- settlement ----------
  function compute() {
    const consumed = {}, paid = {}, owes = {}, owed = {};
    (doc.people || []).forEach((p) => { consumed[p.id] = paid[p.id] = owes[p.id] = owed[p.id] = 0; });
    let unassignedTotal = 0, unassignedCount = 0, totalLines = 0, assignedLines = 0;

    (doc.receipts || []).forEach((rc) => {
      const grand = rc.grandTotal || sumItems(rc.items);
      if (rc.payerId && paid[rc.payerId] !== undefined) paid[rc.payerId] += grand;
      const ratio = grand / (sumItems(rc.items) || 1);
      (rc.items || []).forEach((it) => {
        totalLines++;
        const sh = (it.sharedBy || []).filter((id) => personById[id]);
        const scaled = (it.lineTotal || 0) * ratio;
        if (sh.length === 0) { unassignedTotal += scaled; unassignedCount++; }
        else { assignedLines++; const per = scaled / sh.length; sh.forEach((id) => consumed[id] += per); }
      });
    });

    (doc.expenses || []).forEach((e) => {
      if (e.payerId && paid[e.payerId] !== undefined) paid[e.payerId] += e.amount || 0;
      totalLines++;
      const keys = Object.keys(e.shares || {}).filter((id) => personById[id]);
      if (keys.length === 0) { unassignedTotal += e.amount || 0; unassignedCount++; return; }
      assignedLines++;
      const mode = e.splitMode || "EVENLY";
      if (mode === "BY_AMOUNT") keys.forEach((id) => consumed[id] += e.shares[id] || 0);
      else if (mode === "BY_PERCENTAGE") keys.forEach((id) => consumed[id] += (e.amount || 0) * (e.shares[id] || 0) / 100);
      else if (mode === "BY_SHARES") {
        const tot = keys.reduce((s, id) => s + (e.shares[id] || 0), 0) || 1;
        keys.forEach((id) => consumed[id] += (e.amount || 0) * (e.shares[id] || 0) / tot);
      } else { const per = (e.amount || 0) / keys.length; keys.forEach((id) => consumed[id] += per); }
    });

    (doc.adjustments || []).forEach((a) => {
      if (!personById[a.fromId] || !personById[a.toId]) return;
      const amt = a.amount || 0;
      if (a.kind === "payment") { owed[a.fromId] += amt; owes[a.toId] += amt; }
      else { owes[a.fromId] += amt; owed[a.toId] += amt; }
    });

    const net = {};
    (doc.people || []).forEach((p) => net[p.id] = paid[p.id] - consumed[p.id] - owes[p.id] + owed[p.id]);
    return { consumed, paid, net, unassignedTotal, unassignedCount, totalLines, assignedLines };
  }

  function settle(net) {
    const cr = [], db = [];
    (doc.people || []).forEach((p) => {
      const v = Math.round(net[p.id]);
      if (v > 0) cr.push({ id: p.id, amt: v }); else if (v < 0) db.push({ id: p.id, amt: -v });
    });
    cr.sort((a, b) => b.amt - a.amt); db.sort((a, b) => b.amt - a.amt);
    const out = []; let ci = 0, di = 0;
    while (ci < cr.length && di < db.length) {
      const c = cr[ci], d = db[di]; const pay = Math.min(c.amt, d.amt);
      if (pay > 0) out.push({ from: d.id, to: c.id, amount: pay });
      c.amt -= pay; d.amt -= pay; if (c.amt <= 0) ci++; if (d.amt <= 0) di++;
    }
    return out;
  }

  const pname = (id) => (personById[id] ? personById[id].name : "—");
  const pcol = (id) => personColor[id] || "var(--teal)";

  // ---------- chips ----------
  function personChip(pid, active, onClick) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip" + (canEdit ? "" : " chip--ro");
    b.style.setProperty("--c", pcol(pid));
    b.dataset.pid = pid;
    b.setAttribute("aria-pressed", active ? "true" : "false");
    b.textContent = pname(pid);
    if (canEdit && onClick) b.addEventListener("click", onClick);
    return b;
  }
  function mkMini(label, fn) {
    const b = document.createElement("button");
    b.className = "mini-btn"; b.type = "button"; b.textContent = label;
    b.addEventListener("click", fn); return b;
  }

  // ---------- render: people bar ----------
  function renderPeopleBar() {
    const el = $("#peopleBar"); el.innerHTML = "";
    if (!doc.people.length) { el.innerHTML = `<span class="empty-hint">No people yet${admin ? " — add some to start." : "."}</span>`; return; }
    doc.people.forEach((p) => {
      const chip = document.createElement(admin ? "button" : "span");
      chip.className = "pbar-chip"; chip.style.setProperty("--c", personColor[p.id]);
      chip.innerHTML = `<span class="pbar-dot"></span>${esc(p.name)}`;
      if (admin) { chip.type = "button"; chip.addEventListener("click", () => openPerson(p)); }
      el.appendChild(chip);
    });
  }

  // ---------- render: shared costs ----------
  function expenseShareText(e) {
    const keys = Object.keys(e.shares || {}).filter((id) => personById[id]);
    if (!keys.length) return "Not assigned yet";
    const mode = e.splitMode || "EVENLY";
    const names = keys.map(pname).join(", ");
    if (mode === "EVENLY") return `${esc(names)} · ${money((e.amount || 0) / keys.length)} each`;
    return `${esc(names)} · split ${mode.replace("BY_", "by ").toLowerCase()}`;
  }
  function renderShared() {
    const wrap = $("#shared"); wrap.innerHTML = "";
    if (!doc.expenses.length) { wrap.innerHTML = `<p class="empty-hint">No shared costs${canEdit ? " — add one." : "."}</p>`; return; }
    doc.expenses.forEach((e) => {
      const card = document.createElement("article"); card.className = "expense";
      const head = document.createElement("div"); head.className = "expense__head";
      head.innerHTML = `
        <div>
          <h3 class="expense__name">${esc(e.title)}</h3>
          <div class="payer">paid by <b style="color:${pcol(e.payerId)}">${esc(pname(e.payerId))}</b>
            ${(e.splitMode && e.splitMode !== "EVENLY") ? `<span class="tag">${esc(e.splitMode.replace("BY_", "").toLowerCase())}</span>` : ""}</div>
        </div>
        <div class="expense__amt">${money(e.amount)}</div>`;
      if (canEdit) { const ed = mkEdit(() => openExpense(e)); head.appendChild(ed); }
      card.appendChild(head);

      const chips = document.createElement("div"); chips.className = "chips";
      const evenly = (e.splitMode || "EVENLY") === "EVENLY";
      doc.people.forEach((p) => {
        const active = (e.shares || {})[p.id] !== undefined;
        chips.appendChild(personChip(p.id, active, () => {
          if (evenly) toggleExpenseMember(e, p.id);
          else openExpense(e);
        }));
      });
      if (canEdit && evenly) {
        const q = document.createElement("span"); q.className = "chip-quick";
        q.append(mkMini("Everyone", () => setExpenseMembers(e, doc.people.map((p) => p.id))),
                 mkMini("Clear", () => setExpenseMembers(e, [])));
        chips.appendChild(q);
      }
      card.appendChild(chips);
      const note = document.createElement("div"); note.className = "split-note"; note.innerHTML = expenseShareText(e);
      card.appendChild(note);
      wrap.appendChild(card);
    });
  }

  // ---------- render: receipts ----------
  function itemShareText(rc, it) {
    const sh = (it.sharedBy || []).filter((id) => personById[id]);
    if (!sh.length) return "Not assigned yet";
    const ratio = (rc.grandTotal || sumItems(rc.items)) / (sumItems(rc.items) || 1);
    const per = ((it.lineTotal || 0) * ratio) / sh.length;
    return `${esc(sh.map(pname).join(", "))} · <b>${money(per)}</b> each`;
  }
  function renderReceipts() {
    const wrap = $("#receipts"); wrap.innerHTML = "";
    if (!doc.receipts.length) { wrap.innerHTML = `<p class="empty-hint">No receipts${canEdit ? " — add one." : "."}</p>`; return; }
    doc.receipts.slice().sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b))).forEach((rc) => {
      const grand = rc.grandTotal || sumItems(rc.items);
      const card = document.createElement("article"); card.className = "receipt";
      const head = document.createElement("div"); head.className = "receipt__head";
      const meta = [rc.sub, fmtWhen(rc.date, rc.time)].filter(Boolean).join("  ·  ");
      head.innerHTML = `
        <div>
          <h3 class="receipt__name">${esc(rc.title)}</h3>
          ${meta ? `<div class="receipt__meta">${esc(meta)}</div>` : ""}
          <div class="payer">paid by <b style="color:${pcol(rc.payerId)}">${esc(pname(rc.payerId))}</b></div>
        </div>
        <div class="receipt__totals"><div class="receipt__grand">${money(grand)}</div></div>`;
      if (canEdit) head.appendChild(mkEdit(() => openReceipt(rc)));
      card.appendChild(head);

      const ul = document.createElement("ul"); ul.className = "items";
      (rc.items || []).forEach((it) => {
        const li = document.createElement("li"); li.className = "item";
        const top = document.createElement("div"); top.className = "item__top";
        const qty = it.quantity && it.quantity > 1 ? `<span class="item__qty">×${it.quantity}</span>` : "";
        const flag = it.needsReview ? `<span class="warn" title="${esc(it.note || "Needs review")}">⚠</span>` : "";
        top.innerHTML = `<span class="item__name">${esc(it.name)}${qty}${flag}</span>
          <span class="item__price">${money(it.lineTotal || 0)}</span>`;
        li.appendChild(top);

        const chips = document.createElement("div"); chips.className = "chips";
        doc.people.forEach((p) => chips.appendChild(personChip(p.id, (it.sharedBy || []).includes(p.id),
          () => toggleItemSharer(rc, it, p.id))));
        if (canEdit) {
          const q = document.createElement("span"); q.className = "chip-quick";
          q.append(mkMini("Everyone", () => setItemSharers(rc, it, doc.people.map((p) => p.id))),
                   mkMini("Clear", () => setItemSharers(rc, it, [])));
          chips.appendChild(q);
        }
        li.appendChild(chips);
        const note = document.createElement("div"); note.className = "split-note"; note.innerHTML = itemShareText(rc, it);
        li.appendChild(note);
        ul.appendChild(li);
      });
      card.appendChild(ul);
      wrap.appendChild(card);
    });
  }

  function mkEdit(fn) {
    const b = document.createElement("button");
    b.className = "edit-btn"; b.type = "button"; b.title = "Edit"; b.textContent = "✎";
    b.addEventListener("click", fn); return b;
  }

  // ---------- render: settle panel + final ----------
  function fillTransfers(el, transfers, big) {
    el.innerHTML = "";
    if (!transfers.length) { el.innerHTML = `<li class="${big ? "ftransfer" : "transfer"} empty">All square 🎉</li>`; return; }
    transfers.forEach((t) => {
      const li = document.createElement("li");
      if (big) {
        li.className = "ftransfer";
        li.innerHTML = `<span class="ftransfer__who">
            <span class="person__dot" style="--c:${pcol(t.from)}"></span>
            <b style="color:${pcol(t.from)}">${esc(pname(t.from))}</b>
            <span class="ftransfer__verb">pays</span>
            <b style="color:${pcol(t.to)}">${esc(pname(t.to))}</b>
          </span><span class="ftransfer__amt">${money(t.amount)}</span>`;
      } else {
        li.className = "transfer";
        li.innerHTML = `<b style="color:${pcol(t.from)}">${esc(pname(t.from))}</b>
          <span class="arrow">→</span><b style="color:${pcol(t.to)}">${esc(pname(t.to))}</b>
          <span class="amt">${money(t.amount)}</span>`;
      }
      el.appendChild(li);
    });
  }

  function renderSettle() {
    const c = compute();
    const peopleEl = $("#people"); peopleEl.innerHTML = "";
    doc.people.forEach((p) => {
      const n = c.net[p.id];
      const sign = n > 0.5 ? "pos" : n < -0.5 ? "neg" : "";
      const label = n > 0.5 ? "gets back" : n < -0.5 ? "owes" : "settled";
      const row = document.createElement("div"); row.className = "person";
      row.innerHTML = `
        <span class="person__dot" style="--c:${personColor[p.id]}"></span>
        <span><span class="person__name">${esc(p.name)}</span>
          <span class="person__sub">had ${money(c.consumed[p.id])} · paid ${money(c.paid[p.id])}</span></span>
        <span class="person__net ${sign}">${money(Math.abs(n))}<small>${label}</small></span>`;
      peopleEl.appendChild(row);
    });

    const adjEl = $("#adjustList"); adjEl.innerHTML = "";
    if (!doc.adjustments.length) adjEl.innerHTML = `<li class="empty-hint">No manual adjustments.</li>`;
    else doc.adjustments.forEach((a) => {
      const verb = a.kind === "payment" ? "paid" : "→";
      const li = document.createElement("li"); li.className = "adjust__item" + (a.kind === "payment" ? " is-payment" : "");
      li.innerHTML = `<span><b style="color:${pcol(a.fromId)}">${esc(pname(a.fromId))}</b>
        <span class="verb">${verb}</span> <b style="color:${pcol(a.toId)}">${esc(pname(a.toId))}</b>
        ${a.label ? `<span class="lbl">${esc(a.label)}</span>` : ""}</span>
        <span class="amt">${money(a.amount)}</span>`;
      if (canEdit) {
        const del = document.createElement("button");
        del.className = "adjust__del"; del.type = "button"; del.title = "Remove"; del.textContent = "✕";
        del.addEventListener("click", () => pushDoc(api(`/trips/${tripId}/adjustments/${a.id}`, { method: "DELETE" })));
        li.appendChild(del);
      }
      adjEl.appendChild(li);
    });

    const transfers = settle(c.net);
    fillTransfers($("#transfers"), transfers, false);
    if ($("#finalTransfers")) fillTransfers($("#finalTransfers"), transfers, true);
    const fn = $("#finalNote");
    if (fn) fn.textContent = c.unassignedCount
      ? `Note: ${c.unassignedCount} line${c.unassignedCount > 1 ? "s" : ""} (${money(c.unassignedTotal)}) still unassigned — assign them for an exact split.` : "";

    const pct = c.totalLines ? Math.round((c.assignedLines / c.totalLines) * 100) : 0;
    $("#progressFill").style.width = pct + "%";
    $("#progressLabel").textContent = `${c.assignedLines} of ${c.totalLines} lines assigned`;
    $("#unassignedNote").textContent = c.unassignedCount
      ? `${c.unassignedCount} line${c.unassignedCount > 1 ? "s" : ""} (${money(c.unassignedTotal)}) still unassigned — not included above.` : "";
    $("#fabLabel").textContent = transfers.length ? `Settle up · ${transfers.length} payment${transfers.length > 1 ? "s" : ""}` : "All square";
  }

  function render() {
    if (!doc) return;
    $("#tripName").textContent = doc.trip.name || "Split the Bill";
    document.title = (doc.trip.name ? doc.trip.name + " · " : "") + "Split the Bill";
    document.body.classList.toggle("is-admin", admin);
    renderPeopleBar();
    renderShared();
    renderReceipts();
    renderSettle();
  }

  // ---------- mutations: receipts / expenses ----------
  function findReceipt(rid) { return doc.receipts.find((r) => r.id === rid); }
  function findExpense(eid) { return doc.expenses.find((e) => e.id === eid); }

  function saveReceipt(rc) { return pushDoc(api(`/trips/${tripId}/receipts/${rc.id}`, { method: "PUT", body: rc })); }
  function saveExpense(e) { return pushDoc(api(`/trips/${tripId}/expenses/${e.id}`, { method: "PUT", body: e })); }

  function toggleItemSharer(rc, it, pid) {
    const set = new Set(it.sharedBy || []);
    set.has(pid) ? set.delete(pid) : set.add(pid);
    it.sharedBy = doc.people.map((p) => p.id).filter((id) => set.has(id));
    render(); saveReceipt(rc);
  }
  function setItemSharers(rc, it, ids) { it.sharedBy = ids.slice(); render(); saveReceipt(rc); }
  function toggleExpenseMember(e, pid) {
    e.shares = e.shares || {};
    if (e.shares[pid] !== undefined) delete e.shares[pid]; else e.shares[pid] = 1;
    render(); saveExpense(e);
  }
  function setExpenseMembers(e, ids) {
    const s = {}; ids.forEach((id) => s[id] = 1); e.shares = s; render(); saveExpense(e);
  }

  // ---------- person dialog ----------
  const personDialog = $("#personDialog");
  let pnEditing = null, pnColor = PALETTE[0];
  function buildSwatches() {
    const w = $("#pnSwatches"); w.innerHTML = "";
    PALETTE.forEach((c) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "swatch";
      b.style.background = c; b.dataset.c = c;
      b.addEventListener("click", () => { pnColor = c; w.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("is-on", s.dataset.c === c)); });
      w.appendChild(b);
    });
  }
  function selectSwatch(c) { pnColor = c; $("#pnSwatches").querySelectorAll(".swatch").forEach((s) => s.classList.toggle("is-on", s.dataset.c === c)); }
  function openPerson(p) {
    pnEditing = p ? p.id : null;
    $("#pnTitle").textContent = p ? "Edit person" : "Add person";
    $("#pnName").value = p ? p.name : "";
    selectSwatch(p && p.color ? p.color : PALETTE[doc.people.length % PALETTE.length]);
    $("#pnDelete").hidden = !p;
    personDialog.showModal();
  }
  $("#addPersonBtn").addEventListener("click", () => openPerson(null));
  $("#pnCancel").addEventListener("click", () => personDialog.close());
  $("#personForm").addEventListener("submit", () => {
    const name = $("#pnName").value.trim(); if (!name) return;
    const body = { name, color: pnColor };
    if (pnEditing) pushDoc(api(`/trips/${tripId}/people/${pnEditing}`, { method: "PUT", body }));
    else pushDoc(api(`/trips/${tripId}/people`, { method: "POST", body }));
  });
  $("#pnDelete").addEventListener("click", () => {
    if (!pnEditing || !confirm("Delete this person? They'll be removed from all splits.")) return;
    personDialog.close();
    pushDoc(api(`/trips/${tripId}/people/${pnEditing}`, { method: "DELETE" }));
  });

  // ---------- receipt dialog (manual + OCR draft) ----------
  const receiptDialog = $("#receiptDialog");
  let rcEditing = null, rcItems = [];
  function payerOptions(sel, selected) {
    sel.innerHTML = "";
    const none = document.createElement("option"); none.value = ""; none.textContent = "— nobody —"; sel.appendChild(none);
    doc.people.forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; if (p.id === selected) o.selected = true; sel.appendChild(o); });
  }
  function renderRcItems() {
    const w = $("#rcItems"); w.innerHTML = "";
    rcItems.forEach((it, idx) => {
      const row = document.createElement("div"); row.className = "rc-item";
      row.innerHTML = `
        <input class="ri-name" placeholder="Item" value="${esc(it.name || "")}" />
        <input class="ri-qty" type="number" min="1" step="1" value="${it.quantity || 1}" title="qty" />
        <input class="ri-total" type="number" min="0" step="1" value="${it.lineTotal || 0}" title="line total" />
        <button type="button" class="ri-del" title="Remove">✕</button>`;
      row.querySelector(".ri-name").addEventListener("input", (e) => it.name = e.target.value);
      row.querySelector(".ri-qty").addEventListener("input", (e) => it.quantity = parseInt(e.target.value, 10) || 1);
      row.querySelector(".ri-total").addEventListener("input", (e) => it.lineTotal = parseInt(e.target.value, 10) || 0);
      row.querySelector(".ri-del").addEventListener("click", () => { rcItems.splice(idx, 1); renderRcItems(); });
      w.appendChild(row);
    });
  }
  function openReceipt(rc, draftWarnings) {
    rcEditing = rc && rc.id ? rc.id : null;
    $("#rcTitle").textContent = rcEditing ? "Edit receipt" : (rc ? "Confirm scanned receipt" : "Add receipt");
    $("#rcName").value = rc ? (rc.title || "") : "";
    $("#rcDate").value = rc && rc.date ? rc.date : "";
    $("#rcGrand").value = rc && rc.grandTotal ? rc.grandTotal : 0;
    payerOptions($("#rcPayer"), rc ? rc.payerId : "");
    rcItems = (rc && rc.items ? rc.items : []).map((it) => ({ id: it.id, name: it.name, quantity: it.quantity || 1, unitPrice: it.unitPrice || 0, lineTotal: it.lineTotal || 0, sharedBy: it.sharedBy || [] }));
    if (!rcItems.length) rcItems.push({ name: "", quantity: 1, unitPrice: 0, lineTotal: 0, sharedBy: [] });
    renderRcItems();
    const wEl = $("#rcWarnings");
    if (draftWarnings && draftWarnings.length) { wEl.hidden = false; wEl.innerHTML = "⚠ " + draftWarnings.map(esc).join("<br>⚠ "); }
    else wEl.hidden = true;
    $("#rcDelete").hidden = !rcEditing;
    receiptDialog.showModal();
  }
  $("#addReceiptBtn").addEventListener("click", () => openReceipt(null));
  $("#rcAddItem").addEventListener("click", () => { rcItems.push({ name: "", quantity: 1, unitPrice: 0, lineTotal: 0, sharedBy: [] }); renderRcItems(); });
  $("#rcCancel").addEventListener("click", () => receiptDialog.close());
  $("#receiptForm").addEventListener("submit", () => {
    const items = rcItems.filter((it) => (it.name || "").trim() || it.lineTotal)
      .map((it) => ({ id: it.id, name: it.name.trim() || "Item", quantity: it.quantity || 1, unitPrice: it.unitPrice || (it.quantity ? Math.round(it.lineTotal / it.quantity) : it.lineTotal), lineTotal: it.lineTotal || 0, sharedBy: it.sharedBy || [] }));
    const body = { title: $("#rcName").value.trim() || "Receipt", date: $("#rcDate").value || "", payerId: $("#rcPayer").value, items, grandTotal: parseInt($("#rcGrand").value, 10) || 0 };
    if (rcEditing) pushDoc(api(`/trips/${tripId}/receipts/${rcEditing}`, { method: "PUT", body }));
    else pushDoc(api(`/trips/${tripId}/receipts`, { method: "POST", body }));
  });
  $("#rcDelete").addEventListener("click", () => {
    if (!rcEditing || !confirm("Delete this receipt?")) return;
    receiptDialog.close();
    pushDoc(api(`/trips/${tripId}/receipts/${rcEditing}`, { method: "DELETE" }));
  });

  // ---------- expense dialog ----------
  const expenseDialog = $("#expenseDialog");
  let exEditing = null, exMode = "EVENLY", exShares = {};
  function setExMode(m) { exMode = m; document.querySelectorAll("#exSplitMode .seg__btn").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === m)); renderExParts(); }
  function renderExParts() {
    const w = $("#exParts"); w.innerHTML = "";
    $("#exPartLabel").textContent = exMode === "EVENLY" ? "Shared by" : exMode === "BY_PERCENTAGE" ? "Percent each" : exMode === "BY_AMOUNT" ? "Amount each" : "Shares each";
    doc.people.forEach((p) => {
      const on = exShares[p.id] !== undefined;
      const row = document.createElement("div"); row.className = "ex-part" + (on ? " is-on" : "");
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "chip"; chip.style.setProperty("--c", personColor[p.id]);
      chip.setAttribute("aria-pressed", on ? "true" : "false"); chip.textContent = p.name;
      chip.addEventListener("click", () => { if (exShares[p.id] !== undefined) delete exShares[p.id]; else exShares[p.id] = exMode === "EVENLY" ? 1 : (exMode === "BY_PERCENTAGE" ? 0 : 0); renderExParts(); });
      row.appendChild(chip);
      if (on && exMode !== "EVENLY") {
        const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.className = "ex-share"; inp.value = exShares[p.id] || 0;
        inp.addEventListener("input", (e) => exShares[p.id] = parseFloat(e.target.value) || 0);
        row.appendChild(inp);
      }
      w.appendChild(row);
    });
  }
  function openExpense(e) {
    exEditing = e ? e.id : null;
    $("#exTitle").textContent = e ? "Edit shared cost" : "Add shared cost";
    $("#exName").value = e ? e.title : "";
    $("#exAmount").value = e ? e.amount : "";
    payerOptions($("#exPayer"), e ? e.payerId : "");
    exShares = e && e.shares ? Object.assign({}, e.shares) : {};
    if (!e) doc.people.forEach((p) => exShares[p.id] = 1); // default: everyone
    setExMode(e && e.splitMode ? e.splitMode : "EVENLY");
    $("#exDelete").hidden = !e;
    expenseDialog.showModal();
  }
  document.querySelectorAll("#exSplitMode .seg__btn").forEach((b) => b.addEventListener("click", () => setExMode(b.dataset.mode)));
  $("#addExpenseBtn").addEventListener("click", () => openExpense(null));
  $("#exCancel").addEventListener("click", () => expenseDialog.close());
  $("#expenseForm").addEventListener("submit", () => {
    const shares = {}; Object.keys(exShares).forEach((id) => { if (personById[id]) shares[id] = exMode === "EVENLY" ? 1 : (exShares[id] || 0); });
    const body = { title: $("#exName").value.trim() || "Shared cost", amount: parseInt($("#exAmount").value, 10) || 0, payerId: $("#exPayer").value, splitMode: exMode, shares };
    if (exEditing) pushDoc(api(`/trips/${tripId}/expenses/${exEditing}`, { method: "PUT", body }));
    else pushDoc(api(`/trips/${tripId}/expenses`, { method: "POST", body }));
  });
  $("#exDelete").addEventListener("click", () => {
    if (!exEditing || !confirm("Delete this shared cost?")) return;
    expenseDialog.close();
    pushDoc(api(`/trips/${tripId}/expenses/${exEditing}`, { method: "DELETE" }));
  });

  // ---------- adjustment dialog ----------
  const adjustDialog = $("#adjustDialog");
  let adjKind = "debt";
  function fillPeopleSelect(sel, idx) {
    sel.innerHTML = "";
    doc.people.forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
    if (idx != null && sel.options[idx]) sel.selectedIndex = idx;
  }
  function setAdjKind(k) { adjKind = k; document.querySelectorAll("#adjKind .seg__btn").forEach((b) => b.classList.toggle("is-on", b.dataset.kind === k)); $("#adjFromLabel").textContent = k === "payment" ? "Who paid" : "Who owes"; }
  document.querySelectorAll("#adjKind .seg__btn").forEach((b) => b.addEventListener("click", () => setAdjKind(b.dataset.kind)));
  $("#addAdjustBtn").addEventListener("click", () => {
    if (!doc.people.length) { alert("Add people first."); return; }
    fillPeopleSelect($("#adjFrom"), 0); fillPeopleSelect($("#adjTo"), Math.min(1, doc.people.length - 1));
    $("#adjAmount").value = ""; $("#adjLabel").value = ""; setAdjKind("debt");
    adjustDialog.showModal();
  });
  $("#adjCancel").addEventListener("click", () => adjustDialog.close());
  $("#adjustForm").addEventListener("submit", () => {
    const fromId = $("#adjFrom").value, toId = $("#adjTo").value;
    const amount = Math.max(0, parseInt($("#adjAmount").value, 10) || 0);
    const label = $("#adjLabel").value.trim();
    if (fromId && toId && fromId !== toId && amount > 0)
      pushDoc(api(`/trips/${tripId}/adjustments`, { method: "POST", body: { kind: adjKind, fromId, toId, amount, label } }));
  });

  // ---------- OCR ----------
  $("#ocrBtn").addEventListener("click", () => $("#ocrFile").click());
  $("#ocrFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    $("#ocrSpinner").hidden = false;
    try {
      const fd = new FormData(); fd.append("image", file);
      const res = await api("/ocr", { method: "POST", body: fd });
      $("#ocrSpinner").hidden = true;
      openReceipt({ title: res.draft.title, date: res.draft.date, payerId: "", items: res.draft.items, grandTotal: res.draft.grandTotal }, res.warnings);
    } catch (err) {
      $("#ocrSpinner").hidden = true;
      if (err.code === 503) alert("OCR isn't configured on the server (needs OCR_API_BASE / OCR_API_KEY / OCR_MODEL).");
      else if (err.code === 422) alert("Couldn't read a receipt from that photo — try a clearer image or add it manually.");
      else if (err.code === 401 || err.code === 403) alert("Log in to use OCR.");
      else alert("OCR failed: " + (err.body && err.body.error ? err.body.error : err.message));
    }
  });

  // ---------- login / logout ----------
  const loginDialog = $("#loginDialog");
  $("#loginBtn").addEventListener("click", () => { $("#loginPassword").value = ""; $("#loginErr").textContent = ""; loginDialog.showModal(); });
  $("#loginCancel").addEventListener("click", () => loginDialog.close());
  $("#loginForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await api("/login", { method: "POST", body: { password: $("#loginPassword").value } });
      loginDialog.close();
      admin = true; applyAdminUI();
      await refreshTrip();
    } catch (err) {
      $("#loginErr").textContent = err.code === 429 ? "Too many attempts — wait a bit." : "Wrong password";
    }
  });
  $("#logoutBtn").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (_) {}
    admin = false; applyAdminUI(); render();
  });

  function applyAdminUI() {
    document.body.classList.toggle("is-admin", admin);
    document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !admin; });
    $("#loginBtn").hidden = admin || !loginEnabled;
    $("#logoutBtn").hidden = !admin;
  }

  // ---------- export PDF ----------
  function buildReport() {
    const c = compute(); const transfers = settle(c.net);
    const stamp = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const settleRows = transfers.length
      ? transfers.map((t) => `<tr><td>${esc(pname(t.from))}</td><td class="arrow">pays</td><td>${esc(pname(t.to))}</td><td class="num">${money(t.amount)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="center">All square — nothing to transfer.</td></tr>`;
    const personRows = doc.people.map((p) => {
      const n = c.net[p.id]; const verdict = n > 0.5 ? "gets back " + money(n) : n < -0.5 ? "pays " + money(-n) : "settled";
      return `<tr><td>${esc(p.name)}</td><td class="num">${money(c.consumed[p.id])}</td><td class="num">${money(c.paid[p.id])}</td><td class="num ${n < -0.5 ? "neg" : n > 0.5 ? "pos" : ""}">${money(n)}</td><td>${esc(verdict)}</td></tr>`;
    }).join("");
    const expHtml = doc.expenses.map((e) => {
      const keys = Object.keys(e.shares || {}).filter((id) => personById[id]);
      return `<tr><td>${esc(e.title)}</td><td class="num">${money(e.amount)}</td><td>paid by ${esc(pname(e.payerId))}</td><td>${esc(keys.map(pname).join(", ") || "—")}</td></tr>`;
    }).join("");
    const rcHtml = doc.receipts.slice().sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b))).map((rc) => {
      const grand = rc.grandTotal || sumItems(rc.items); const ratio = grand / (sumItems(rc.items) || 1);
      const rows = (rc.items || []).map((it) => {
        const sh = (it.sharedBy || []).filter((id) => personById[id]);
        const per = sh.length ? ((it.lineTotal || 0) * ratio) / sh.length : 0;
        return `<tr><td>${esc(it.name)}${it.quantity > 1 ? " ×" + it.quantity : ""}</td><td class="num">${money(it.lineTotal || 0)}</td><td>${esc(sh.map(pname).join(", ") || "— unassigned —")}</td><td class="num">${sh.length ? money(per) + " ea" : ""}</td></tr>`;
      }).join("");
      return `<div class="rep-group"><div class="rep-group__head"><b>${esc(rc.title)}</b><span>${esc([fmtWhen(rc.date, rc.time), "paid by " + pname(rc.payerId), money(grand)].filter(Boolean).join(" · "))}</span></div><table class="rep-table"><tbody>${rows}</tbody></table></div>`;
    }).join("");
    const adjHtml = doc.adjustments.length
      ? `<table class="rep-table"><tbody>${doc.adjustments.map((a) => `<tr><td>${esc(pname(a.fromId))} ${a.kind === "payment" ? "already paid" : "owes"} ${esc(pname(a.toId))}${a.label ? " (" + esc(a.label) + ")" : ""}</td><td class="num">${money(a.amount)}</td></tr>`).join("")}</tbody></table>`
      : "<p class='muted'>None.</p>";
    const unassigned = c.unassignedCount ? `<p class="warn">⚠ ${c.unassignedCount} line(s) (${money(c.unassignedTotal)}) still unassigned — provisional.</p>` : "";
    $("#report").innerHTML = `
      <div class="rep-head"><h1>${esc(doc.trip.name || "Split the Bill")}</h1>
        <div class="rep-meta">Generated ${stamp} · ${c.assignedLines}/${c.totalLines} lines assigned</div></div>
      ${unassigned}
      <h2>Who pays whom</h2><table class="rep-table rep-settle"><tbody>${settleRows}</tbody></table>
      <h2>Per person</h2><table class="rep-table"><thead><tr><th>Person</th><th class="num">Consumed</th><th class="num">Paid</th><th class="num">Net</th><th>Result</th></tr></thead><tbody>${personRows}</tbody></table>
      <h2>Manual adjustments</h2>${adjHtml}
      <h2>Shared costs</h2><table class="rep-table"><tbody>${expHtml || "<tr><td class='muted'>None.</td></tr>"}</tbody></table>
      <h2>Receipts</h2>${rcHtml || "<p class='muted'>None.</p>"}`;
  }
  $("#exportBtn").addEventListener("click", () => { if (!doc) return; buildReport(); window.print(); });

  // ---------- mobile sheet ----------
  const settleEl = $("#settle"); const fab = $("#settleFab");
  const scrim = document.createElement("div"); scrim.className = "scrim"; document.body.appendChild(scrim);
  function toggleSheet() { const open = settleEl.classList.toggle("open"); scrim.classList.toggle("show", open); fab.classList.toggle("up", open); }
  fab.addEventListener("click", toggleSheet);
  fab.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSheet(); } });
  scrim.addEventListener("click", toggleSheet);
  const grip = $("#sheetGrip");
  if (grip) grip.addEventListener("click", () => { if (settleEl.classList.contains("open")) toggleSheet(); });
  let touchY = null;
  settleEl.addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  settleEl.addEventListener("touchmove", (e) => {
    if (touchY == null || !settleEl.classList.contains("open")) return;
    const inner = settleEl.querySelector(".settle__inner");
    if (e.touches[0].clientY - touchY > 70 && inner && inner.scrollTop <= 0) { toggleSheet(); touchY = null; }
  }, { passive: true });
  settleEl.addEventListener("touchend", () => { touchY = null; });

  // ---------- passcode gate ----------
  function lock(msg) {
    const el = $("#lock"); const wasOpen = !el.hidden; el.hidden = false;
    if (msg) {
      $("#lockErr").textContent = msg;
      if (wasOpen) { const card = el.querySelector(".lock__card"); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); }
    }
    setTimeout(() => $("#lockInput").focus(), 60);
  }
  function unlock() { $("#lock").hidden = true; }
  $("#lockForm").addEventListener("submit", (e) => { e.preventDefault(); pass = $("#lockInput").value.trim(); tryLoad(); });

  // ---------- boot / polling ----------
  async function refreshTrip() {
    try { const d = await api("/trips/" + tripId); adoptDoc(d); render(); setSync("live"); } catch (e) { if (e.code === 401) lock("Enter passcode"); else setSync("offline"); }
  }
  async function tryLoad() {
    if (!tripId) return resolveTrip();
    try {
      const d = await api("/trips/" + tripId);
      try { localStorage.setItem(PASS_KEY, pass); } catch (_) {}
      unlock(); adoptDoc(d); render(); setSync("live"); startPolling();
    } catch (e) {
      if (e.code === 401) lock("Wrong passcode");
      else if (doc) { setSync("offline"); startPolling(); }
      else $("#receipts").innerHTML = `<p class="empty-hint">Couldn't load this trip (${esc(String(e.code || e.message))}).</p>`;
    }
  }
  async function resolveTrip() {
    try {
      const trips = await api("/trips");
      if (trips.length === 1) { tripId = trips[0].id; history.replaceState(null, "", "?t=" + tripId); unlock(); return tryLoad(); }
      location.replace("/");
    } catch (e) { if (e.code === 401) lock(); else location.replace("/"); }
  }
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      api("/trips/" + tripId).then((d) => { setSync("live"); if (d && d.rev !== (doc && doc.rev)) { adoptDoc(d); render(); } })
        .catch((e) => { if (e.code === 401) lock("Enter passcode"); else setSync("offline"); });
    }, 4000);
  }

  async function boot() {
    buildSwatches();
    try { const me = await api("/me"); admin = !!me.admin; loginEnabled = !!me.loginEnabled; } catch (_) {}
    applyAdminUI();
    pass = localStorage.getItem(PASS_KEY) || "";
    if (tripId) { const c = cacheLoad(); if (c) { adoptDoc(c); render(); } }
    tryLoad();
  }
  boot();
})();
