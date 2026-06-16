/* ============================================================
   Split the Bill — multi-trip, backend-synced.
   Reads gated by passcode; editing requires admin login.
   Robustness (toasts/rollback/poll-guard), world-class dialogs,
   and 10+ people scaling (condensed UI gated at >8) layered in.
   ============================================================ */
(() => {
  "use strict";

  const API = "/api";
  const PASS_KEY = "balitrip-pass";
  const PALETTE = ["#ff6f59", "#2fd6c3", "#ffb454", "#c08cff", "#7bd88f", "#ff8fc7", "#ffd66b", "#6cb8ff"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const BIG = 8; // >BIG people switches to condensed (avatar + picker) UI
  const grp = new Intl.NumberFormat("en-US");

  // --- state ---
  let tripId = new URLSearchParams(location.search).get("t") || "";
  let doc = null;
  let pass = "";
  let admin = false, loginEnabled = false, ocrEnabled = false;
  const canEdit = true;   // any passcode user can edit money entries (editor tier); admin adds people/trip
  let CUR = "IDR";
  let personById = {}, personColor = {};
  let pollTimer = null;
  let inflight = 0;          // in-flight writes
  let sheetDragging = false; // bottom-sheet mid-gesture
  let pendingDoc = null;     // doc from poll deferred while busy/dialog-open
  const saveQueue = {};      // entityKey -> { timer, snap } (debounced writes + rollback snapshot)

  const $ = (s) => document.querySelector(s);
  const money = (n) => (CUR === "IDR" ? "Rp " : CUR + " ") + grp.format(Math.round(n || 0));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cacheKey = () => "balitrip-trip-" + tripId;
  const sumItems = (items) => (items || []).reduce((s, it) => s + (it.lineTotal || 0), 0);
  const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const bigMode = () => (doc && doc.people && doc.people.length > BIG);

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

  // distinct color for any index (palette first 8 — unchanged; golden-angle HSL beyond)
  function genColor(i) { return i < PALETTE.length ? PALETTE[i] : `hsl(${Math.round((i * 137.508) % 360)} 65% 62%)`; }

  // ---------- toasts (aria-live, framework-free) ----------
  let toastWrap = null;
  function ensureToasts() {
    if (toastWrap) return toastWrap;
    toastWrap = document.createElement("div");
    toastWrap.className = "toasts"; toastWrap.setAttribute("aria-live", "polite"); toastWrap.setAttribute("aria-atomic", "false");
    document.body.appendChild(toastWrap);
    return toastWrap;
  }
  function toast(msg, opts = {}) {
    const w = ensureToasts();
    const t = document.createElement("div");
    t.className = "toast" + (opts.type === "err" ? " toast--err" : opts.type === "ok" ? " toast--ok" : "");
    t.setAttribute("role", opts.type === "err" ? "alert" : "status");
    const span = document.createElement("span"); span.textContent = msg; t.appendChild(span);
    if (opts.action && opts.actionLabel) {
      const b = document.createElement("button"); b.type = "button"; b.className = "toast__action"; b.textContent = opts.actionLabel;
      b.addEventListener("click", () => { remove(); opts.action(); });
      t.appendChild(b);
    }
    w.appendChild(t);
    let done = false;
    function remove() { if (done) return; done = true; t.classList.add("toast--out"); setTimeout(() => t.remove(), 200); }
    setTimeout(remove, opts.ms || (opts.action ? 6000 : 2600));
    return remove;
  }

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
    (d.people || []).forEach((p, i) => { personById[p.id] = p; personColor[p.id] = p.color || genColor(i); });
    cacheStore(d);
  }
  function cacheStore(d) {
    try { localStorage.setItem(cacheKey(), JSON.stringify(d)); }
    catch (_) {
      try { // quota: drop other trips' caches and retry once
        Object.keys(localStorage).forEach((k) => { if (k.startsWith("balitrip-trip-") && k !== cacheKey()) localStorage.removeItem(k); });
        localStorage.setItem(cacheKey(), JSON.stringify(d));
      } catch (_2) {}
    }
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

  // A write returns the full doc; adopt + re-render. opts: { rollback, okMsg, errMsg }
  function pushDoc(promise, opts = {}) {
    inflight++;
    return promise
      .then((d) => { adoptDoc(d); render(); setSync("live"); if (opts.okMsg) toast(opts.okMsg, { type: "ok" }); return d; })
      .catch((e) => {
        if (e.code === 401) { lock("Session expired — enter passcode"); }
        else if (e.code === 403) { setSync("offline"); if (opts.rollback) { opts.rollback(); render(); } toast("Log in to make changes", { type: "err" }); refreshTrip(); }
        else {
          setSync("offline");
          if (opts.rollback) { opts.rollback(); render(); }
          toast(opts.errMsg || "Couldn't save — change undone", { type: "err", action: opts.retry, actionLabel: opts.retry ? "Retry" : undefined });
        }
        throw e;
      })
      .finally(() => { inflight = Math.max(0, inflight - 1); if (inflight === 0) flushPending(); });
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
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

  // ---------- chips / avatars ----------
  function personChip(pid, active, onClick) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip" + (canEdit ? "" : " chip--ro");
    b.style.setProperty("--c", pcol(pid));
    b.dataset.pid = pid;
    b.setAttribute("aria-pressed", active ? "true" : "false");
    b.setAttribute("aria-label", (active ? "Sharing: " : "Not sharing: ") + pname(pid));
    b.textContent = pname(pid);
    if (canEdit && onClick) b.addEventListener("click", onClick);
    return b;
  }
  function mkMini(label, fn, aria) {
    const b = document.createElement("button");
    b.className = "mini-btn"; b.type = "button"; b.textContent = label;
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", fn); return b;
  }
  function avatar(pid) {
    const s = document.createElement("span"); s.className = "avatar"; s.style.setProperty("--c", pcol(pid));
    s.textContent = initials(pname(pid)); s.title = pname(pid); s.setAttribute("aria-hidden", "true");
    return s;
  }
  // condensed assigner: stack of assigned avatars + a button that opens the picker
  function assignStack(ids, label, onOpen) {
    const wrap = document.createElement("button");
    wrap.type = "button"; wrap.className = "assign";
    wrap.setAttribute("aria-label", ids.length ? `${label}: ${ids.map(pname).join(", ")} — tap to change` : `${label}: nobody — tap to assign`);
    if (!ids.length) { wrap.classList.add("assign--empty"); wrap.textContent = "Assign people"; }
    else {
      const stack = document.createElement("span"); stack.className = "avatar-stack";
      ids.slice(0, 6).forEach((id) => stack.appendChild(avatar(id)));
      if (ids.length > 6) { const more = document.createElement("span"); more.className = "avatar avatar--more"; more.textContent = "+" + (ids.length - 6); more.setAttribute("aria-hidden", "true"); stack.appendChild(more); }
      wrap.appendChild(stack);
      const cap = document.createElement("span"); cap.className = "assign__cap"; cap.textContent = ids.length + (ids.length === 1 ? " person" : " people");
      wrap.appendChild(cap);
    }
    if (canEdit && onOpen) wrap.addEventListener("click", onOpen);
    else wrap.disabled = true;
    return wrap;
  }

  // ---------- render: people bar ----------
  function renderPeopleBar() {
    const el = $("#peopleBar"); el.innerHTML = "";
    if (!doc.people.length) { el.innerHTML = `<span class="empty-hint">No people yet${admin ? " — add some to start." : "."}</span>`; return; }
    doc.people.forEach((p) => {
      const chip = document.createElement(admin ? "button" : "span");
      chip.className = "pbar-chip"; chip.style.setProperty("--c", personColor[p.id]);
      chip.innerHTML = `<span class="pbar-dot"></span>${esc(p.name)}`;
      if (admin) { chip.type = "button"; chip.setAttribute("aria-label", "Edit person: " + p.name); chip.addEventListener("click", () => openPerson(p)); }
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
      const card = document.createElement("article"); card.className = "expense"; card.id = "expense-" + e.id;
      const head = document.createElement("div"); head.className = "expense__head";
      head.innerHTML = `
        <div>
          <h3 class="expense__name">${esc(e.title)}</h3>
          <div class="payer">paid by <b style="color:${pcol(e.payerId)}">${esc(pname(e.payerId))}</b>
            ${(e.splitMode && e.splitMode !== "EVENLY") ? `<span class="tag">${esc(e.splitMode.replace("BY_", "").toLowerCase())}</span>` : ""}</div>
        </div>
        <div class="expense__amt">${money(e.amount)}</div>`;
      if (canEdit) head.appendChild(mkEdit(() => openExpense(e), "Edit shared cost: " + e.title));
      card.appendChild(head);

      const evenly = (e.splitMode || "EVENLY") === "EVENLY";
      const memberIds = doc.people.filter((p) => (e.shares || {})[p.id] !== undefined).map((p) => p.id);

      if (bigMode() || !evenly) {
        // condensed: tap to open picker (evenly) or the expense dialog (weighted)
        const row = document.createElement("div"); row.className = "assign-row";
        row.appendChild(assignStack(memberIds, "Shared by", () => {
          if (evenly) openPicker({ title: e.title || "Shared by", selected: memberIds, onSave: (ids) => setExpenseMembers(e, ids) });
          else openExpense(e);
        }));
        card.appendChild(row);
      } else {
        const chips = document.createElement("div"); chips.className = "chips";
        doc.people.forEach((p) => {
          const active = (e.shares || {})[p.id] !== undefined;
          chips.appendChild(personChip(p.id, active, () => toggleExpenseMember(e, p.id)));
        });
        if (canEdit) {
          const q = document.createElement("span"); q.className = "chip-quick";
          q.append(mkMini("Everyone", () => setExpenseMembers(e, doc.people.map((p) => p.id)), "Share with everyone"),
                   mkMini("Clear", () => setExpenseMembers(e, []), "Clear sharers"));
          chips.appendChild(q);
        }
        card.appendChild(chips);
      }
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
      if (canEdit) head.appendChild(mkEdit(() => openReceipt(rc), "Edit receipt: " + rc.title));
      card.appendChild(head);

      const ul = document.createElement("ul"); ul.className = "items";
      (rc.items || []).forEach((it) => {
        const li = document.createElement("li"); li.className = "item";
        const top = document.createElement("div"); top.className = "item__top";
        const qty = it.quantity && it.quantity > 1 ? `<span class="item__qty">×${it.quantity}</span>` : "";
        const flag = it.needsReview ? `<span class="warn" title="${esc(it.note || "Needs review")}" aria-label="Needs review">⚠</span>` : "";
        top.innerHTML = `<span class="item__name">${esc(it.name)}${qty}${flag}</span>
          <span class="item__price">${money(it.lineTotal || 0)}</span>`;
        li.appendChild(top);

        const sharers = (it.sharedBy || []).filter((id) => personById[id]);
        if (bigMode()) {
          const row = document.createElement("div"); row.className = "assign-row";
          row.appendChild(assignStack(sharers, "Shared by", () =>
            openPicker({ title: it.name || "Shared by", selected: sharers, onSave: (ids) => setItemSharers(rc, it, ids) })));
          li.appendChild(row);
        } else {
          const chips = document.createElement("div"); chips.className = "chips";
          doc.people.forEach((p) => chips.appendChild(personChip(p.id, (it.sharedBy || []).includes(p.id),
            () => toggleItemSharer(rc, it, p.id))));
          if (canEdit) {
            const q = document.createElement("span"); q.className = "chip-quick";
            q.append(mkMini("Everyone", () => setItemSharers(rc, it, doc.people.map((p) => p.id)), "Everyone shared this"),
                     mkMini("Clear", () => setItemSharers(rc, it, []), "Clear sharers"));
            chips.appendChild(q);
          }
          li.appendChild(chips);
        }
        const note = document.createElement("div"); note.className = "split-note"; note.innerHTML = itemShareText(rc, it);
        li.appendChild(note);
        ul.appendChild(li);
      });
      card.appendChild(ul);
      wrap.appendChild(card);
    });
  }

  function mkEdit(fn, aria) {
    const b = document.createElement("button");
    b.className = "edit-btn"; b.type = "button"; b.setAttribute("aria-label", aria || "Edit"); b.title = "Edit";
    b.innerHTML = `<span aria-hidden="true">✎</span>`;
    b.addEventListener("click", fn); return b;
  }

  // ---------- render: settle panel + final ----------
  function fillTransfers(el, transfers, big) {
    el.innerHTML = "";
    if (!transfers.length) { el.innerHTML = `<li class="${big ? "ftransfer" : "transfer"} empty">All square 🎉</li>`; return; }
    transfers.forEach((t) => {
      const li = document.createElement("li");
      li.setAttribute("aria-label", `${pname(t.from)} pays ${pname(t.to)} ${money(t.amount)}`);
      if (big) {
        li.className = "ftransfer";
        li.innerHTML = `<span class="ftransfer__who">
            <span class="person__dot" style="--c:${pcol(t.from)}" aria-hidden="true"></span>
            <b style="color:${pcol(t.from)}">${esc(pname(t.from))}</b>
            <span class="ftransfer__verb" aria-hidden="true">pays</span>
            <b style="color:${pcol(t.to)}">${esc(pname(t.to))}</b>
          </span><span class="ftransfer__amt">${money(t.amount)}</span>`;
      } else {
        li.className = "transfer";
        li.innerHTML = `<b style="color:${pcol(t.from)}">${esc(pname(t.from))}</b>
          <span class="arrow" aria-hidden="true">→</span><b style="color:${pcol(t.to)}">${esc(pname(t.to))}</b>
          <span class="amt">${money(t.amount)}</span>`;
      }
      el.appendChild(li);
    });
  }

  function personRow(p, c) {
    const n = c.net[p.id];
    const sign = n > 0.5 ? "pos" : n < -0.5 ? "neg" : "";
    const label = n > 0.5 ? "gets back" : n < -0.5 ? "owes" : "settled";
    const row = document.createElement("div"); row.className = "person";
    row.setAttribute("aria-label", `${p.name} ${label} ${money(Math.abs(n))}; consumed ${money(c.consumed[p.id])}, paid ${money(c.paid[p.id])}`);
    row.innerHTML = `
      <span class="person__dot" style="--c:${personColor[p.id]}" aria-hidden="true"></span>
      <span><span class="person__name">${esc(p.name)}</span>
        <span class="person__sub">had ${money(c.consumed[p.id])} · paid ${money(c.paid[p.id])}</span></span>
      <span class="person__net ${sign}">${money(Math.abs(n))}<small>${label}</small></span>`;
    // payout / bank details (editor tier — anyone with passcode can set their own)
    const mid = row.querySelector(".person__sub").parentNode;
    const pay = document.createElement("span"); pay.className = "person__payout";
    const val = personById[p.id] && personById[p.id].bankAccount;
    pay.innerHTML = `<span class="person__payout-label">payout</span><span class="person__payout-val${val ? "" : " muted"}">${esc(val || "not set")}</span>`;
    if (canEdit) {
      const e = document.createElement("button"); e.type = "button"; e.className = "payout-edit";
      e.setAttribute("aria-label", "Edit payout for " + p.name); e.innerHTML = `<span aria-hidden="true">✎</span>`;
      e.addEventListener("click", () => openBank(p)); pay.appendChild(e);
    }
    mid.appendChild(pay);
    return row;
  }

  function renderSettle() {
    const c = compute();
    const peopleEl = $("#people"); peopleEl.innerHTML = "";

    if (bigMode()) {
      // scale: actionable first, collapse the settled
      const owing = [], getting = [], settled = [];
      doc.people.forEach((p) => { const n = c.net[p.id]; (n < -0.5 ? owing : n > 0.5 ? getting : settled).push(p); });
      owing.sort((a, b) => c.net[a.id] - c.net[b.id]);
      getting.sort((a, b) => c.net[b.id] - c.net[a.id]);
      owing.concat(getting).forEach((p) => peopleEl.appendChild(personRow(p, c)));
      if (settled.length) {
        const det = document.createElement("details"); det.className = "settled-group";
        const sum = document.createElement("summary"); sum.textContent = `All settled (${settled.length})`; det.appendChild(sum);
        settled.forEach((p) => det.appendChild(personRow(p, c))); peopleEl.appendChild(det);
      }
    } else {
      doc.people.forEach((p) => peopleEl.appendChild(personRow(p, c)));
    }

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
        del.className = "adjust__del"; del.type = "button"; del.setAttribute("aria-label", "Remove adjustment");
        del.innerHTML = `<span aria-hidden="true">✕</span>`;
        del.addEventListener("click", () => deleteAdjustment(a));
        li.appendChild(del);
      }
      adjEl.appendChild(li);
    });

    renderSettlement(c); // #transfers, #finalTransfers, #settleAdmin, #planStale, #fabLabel (published plan vs live)
    const fn = $("#finalNote");
    if (fn) fn.textContent = c.unassignedCount
      ? `Note: ${c.unassignedCount} line${c.unassignedCount > 1 ? "s" : ""} (${money(c.unassignedTotal)}) still unassigned — assign them for an exact split.` : "";

    const pct = c.totalLines ? Math.round((c.assignedLines / c.totalLines) * 100) : 0;
    $("#progressFill").style.width = pct + "%";
    $("#progressLabel").textContent = `${c.assignedLines} of ${c.totalLines} lines assigned`;
    $("#unassignedNote").textContent = c.unassignedCount
      ? `${c.unassignedCount} line${c.unassignedCount > 1 ? "s" : ""} (${money(c.unassignedTotal)}) still unassigned — not included above.` : "";
  }

  // ---------- settlement plan (publish / proof / verify) ----------
  const txSig = (t) => [t.from || t.fromId, t.to || t.toId, t.amount];
  const planSig = (list) => JSON.stringify(list.map(txSig).sort());
  function statusBadge(st) {
    const map = { pending: ["badge--pending", "pending"], submitted: ["badge--submitted", "proof uploaded"], verified: ["badge--verified", "✓ paid"] };
    const [cls, label] = map[st] || map.pending;
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }
  function renderSettlement(c) {
    const live = settle(c.net);
    const pub = doc.settlement && doc.settlement.published ? doc.settlement : null;
    renderSettleAdmin(pub, live);
    const planStale = $("#planStale");
    if (pub) {
      renderPlanCards($("#finalTransfers"), pub.transfers);
      renderPlanMirror($("#transfers"), pub.transfers);
      const liveAsPlan = live.map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount }));
      if (planStale) planStale.hidden = (planSig(live) === planSig(pub.transfers));
      const pend = pub.transfers.filter((t) => t.status !== "verified").length;
      $("#fabLabel").textContent = pend ? `Settle up · ${pend} to pay` : "All settled ✓";
      void liveAsPlan;
    } else {
      fillTransfers($("#transfers"), live, false);
      fillTransfers($("#finalTransfers"), live, true);
      if (planStale) planStale.hidden = true;
      $("#fabLabel").textContent = live.length ? `Settle up · ${live.length} payment${live.length > 1 ? "s" : ""}` : "All square";
    }
  }
  function renderSettleAdmin(pub, live) {
    const el = $("#settleAdmin"); if (!el) return; el.innerHTML = "";
    if (!admin) return;
    if (!pub) {
      if (!live.length) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "solid-btn"; b.textContent = "Publish settlement plan";
      b.addEventListener("click", publishSettlement); el.appendChild(b);
    } else {
      const rg = document.createElement("button"); rg.type = "button"; rg.className = "ghost-btn ghost-btn--sm"; rg.textContent = "Re-generate from balances";
      rg.addEventListener("click", regenerateSettlement); el.appendChild(rg);
      const un = document.createElement("button"); un.type = "button"; un.className = "ghost-btn ghost-btn--sm"; un.textContent = "Unpublish";
      un.addEventListener("click", unpublishSettlement); el.appendChild(un);
    }
  }
  function renderPlanCards(el, transfers) {
    el.innerHTML = "";
    if (!transfers.length) { el.innerHTML = `<li class="ftransfer empty">All square 🎉</li>`; return; }
    transfers.forEach((t) => {
      const payee = personById[t.toId];
      const bank = payee && payee.bankAccount ? payee.bankAccount : "";
      const li = document.createElement("li"); li.className = "plan-card status-" + (t.status || "pending");
      li.setAttribute("aria-label", `${pname(t.fromId)} pays ${pname(t.toId)} ${money(t.amount)} — ${t.status || "pending"}`);

      const top = document.createElement("div"); top.className = "plan-card__top";
      top.innerHTML = `<span class="plan-who">
          <span class="person__dot" style="--c:${pcol(t.fromId)}" aria-hidden="true"></span>
          <b style="color:${pcol(t.fromId)}">${esc(pname(t.fromId))}</b>
          <span class="ftransfer__verb" aria-hidden="true">pays</span>
          <b style="color:${pcol(t.toId)}">${esc(pname(t.toId))}</b></span>
        <span class="plan-amt">${money(t.amount)}</span>`;
      li.appendChild(top);

      const bankRow = document.createElement("div"); bankRow.className = "plan-bank";
      if (bank) {
        bankRow.innerHTML = `<span class="plan-bank__label">pay to</span><span class="plan-bank__val">${esc(bank)}</span>`;
        const cp = document.createElement("button"); cp.type = "button"; cp.className = "copy-btn"; cp.setAttribute("aria-label", "Copy payout details"); cp.innerHTML = `<span aria-hidden="true">📋</span>`;
        cp.addEventListener("click", () => copyText(bank, cp)); bankRow.appendChild(cp);
      } else {
        bankRow.innerHTML = `<span class="plan-bank__label">pay to</span><span class="plan-bank__val muted">${esc(pname(t.toId))} hasn’t added payout details</span>`;
        if (payee && canEdit) { const add = document.createElement("button"); add.type = "button"; add.className = "link-btn"; add.textContent = "add"; add.addEventListener("click", () => openBank(payee)); bankRow.appendChild(add); }
      }
      li.appendChild(bankRow);

      const foot = document.createElement("div"); foot.className = "plan-card__foot";
      foot.innerHTML = statusBadge(t.status);
      const acts = document.createElement("span"); acts.className = "plan-actions";
      const up = document.createElement("button"); up.type = "button"; up.className = "mini-btn"; up.textContent = t.proofRef ? "Replace proof" : "Upload proof";
      up.addEventListener("click", () => uploadProof(t.id)); acts.appendChild(up);
      if (t.proofRef) { const vw = document.createElement("button"); vw.type = "button"; vw.className = "mini-btn"; vw.textContent = "View proof"; vw.addEventListener("click", () => openProof(t.id)); acts.appendChild(vw); }
      if (admin) {
        if (t.status === "verified") { const un = document.createElement("button"); un.type = "button"; un.className = "mini-btn"; un.textContent = "Unverify"; un.addEventListener("click", () => setVerify(t.id, false)); acts.appendChild(un); }
        else { const vf = document.createElement("button"); vf.type = "button"; vf.className = "mini-btn verify-btn"; vf.textContent = "Verify"; vf.addEventListener("click", () => setVerify(t.id, true)); acts.appendChild(vf); }
      }
      foot.appendChild(acts); li.appendChild(foot);
      el.appendChild(li);
    });
  }
  function renderPlanMirror(el, transfers) {
    el.innerHTML = "";
    if (!transfers.length) { el.innerHTML = `<li class="transfer empty">All square 🎉</li>`; return; }
    transfers.forEach((t) => {
      const li = document.createElement("li"); li.className = "transfer transfer--plan";
      li.setAttribute("aria-label", `${pname(t.fromId)} pays ${pname(t.toId)} ${money(t.amount)} — ${t.status || "pending"}`);
      li.innerHTML = `<b style="color:${pcol(t.fromId)}">${esc(pname(t.fromId))}</b>
        <span class="arrow" aria-hidden="true">→</span><b style="color:${pcol(t.toId)}">${esc(pname(t.toId))}</b>
        ${statusBadge(t.status)}<span class="amt">${money(t.amount)}</span>`;
      el.appendChild(li);
    });
  }
  async function publishSettlement() {
    const live = settle(compute().net);
    if (!live.length) { toast("Nothing to settle", { type: "err" }); return; }
    const ok = await confirmAsk({ title: "Publish settlement plan?", okLabel: "Publish",
      body: "This freezes the current “who pays whom” as the official plan. Friends pay against it, and recording payments won’t reshuffle it." });
    if (!ok) return;
    const transfers = live.map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount }));
    pushDoc(api(`/trips/${tripId}/settlement`, { method: "PUT", body: { transfers } }), { okMsg: "Settlement published" });
  }
  async function regenerateSettlement() {
    const live = settle(compute().net);
    const ok = await confirmAsk({ title: "Re-generate the plan?", danger: true, okLabel: "Re-generate",
      body: "Recompute who-pays-whom from current balances. Unchanged transfers keep their proof and verified status; changed ones reset." });
    if (!ok) return;
    const transfers = live.map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount }));
    pushDoc(api(`/trips/${tripId}/settlement`, { method: "PUT", body: { transfers } }), { okMsg: "Plan re-generated" });
  }
  async function unpublishSettlement() {
    const ok = await confirmAsk({ title: "Unpublish the plan?", danger: true, okLabel: "Unpublish",
      body: "Settlement goes back to live auto-calculation. Uploaded proofs and verifications on the plan are discarded." });
    if (!ok) return;
    pushDoc(api(`/trips/${tripId}/settlement`, { method: "DELETE" }), { okMsg: "Plan unpublished" });
  }
  function setVerify(tid, on) {
    pushDoc(api(`/trips/${tripId}/settlement/${tid}/${on ? "verify" : "unverify"}`, { method: "POST" }), { okMsg: on ? "Verified ✓" : "Re-opened" });
  }
  // proof upload (shared hidden input; editor tier)
  let proofTid = null;
  function uploadProof(tid) { proofTid = tid; $("#proofFile").click(); }
  $("#proofFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file || !proofTid) return;
    const tid = proofTid; proofTid = null;
    showSpinner("Uploading proof…");
    const fd = new FormData(); fd.append("image", file);
    pushDoc(api(`/trips/${tripId}/settlement/${tid}/proof`, { method: "POST", body: fd }), { okMsg: "Proof uploaded", errMsg: "Upload failed — try a smaller jpg/png" })
      .catch(() => {}).finally(() => hideSpinner());
  });
  function showSpinner(msg) { const s = $("#ocrSpinner"); if (!s) return; const sp = s.querySelector("span"); if (sp) sp.textContent = msg || "Working…"; s.hidden = false; }
  function hideSpinner() { const s = $("#ocrSpinner"); if (s) s.hidden = true; }
  // proof lightbox
  function openProof(tid) {
    const img = $("#lightboxImg");
    img.src = `${API}/trips/${tripId}/settlement/${tid}/proof?pass=${encodeURIComponent(pass)}`;
    $("#lightbox").hidden = false;
  }
  function closeLightbox() { $("#lightbox").hidden = true; $("#lightboxImg").src = ""; }
  $("#lightbox").addEventListener("click", closeLightbox);
  $("#lightboxClose").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#lightbox").hidden) closeLightbox(); });
  // copy to clipboard
  function copyText(text, btn) {
    const done = () => { if (btn) { const o = btn.innerHTML; btn.innerHTML = `<span aria-hidden="true">✓</span>`; setTimeout(() => { btn.innerHTML = o; }, 1200); } toast("Copied", { type: "ok", ms: 1200 }); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand("copy"); ta.remove(); done(); }
    catch (_) { toast("Couldn't copy", { type: "err" }); }
  }
  // bank/payout dialog (editor tier)
  const bankDialog = $("#bankDialog");
  let bankPid = null;
  function openBank(p) {
    if (!p) return; bankPid = p.id;
    $("#bankTitle").textContent = "Payout details — " + p.name;
    $("#bankInput").value = p.bankAccount || "";
    clearErr(bankDialog); openDialog(bankDialog, "#bankInput");
  }
  $("#bankCancel").addEventListener("click", () => closeDialog(bankDialog));
  bankDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(bankDialog); });
  $("#bankForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!bankPid) return;
    const v = $("#bankInput").value.trim(); const btn = $("#bankSave"); busy(btn, true);
    pushDoc(api(`/trips/${tripId}/people/${bankPid}/bank`, { method: "PUT", body: { bankAccount: v } }), { okMsg: "Payout saved" })
      .then(() => closeDialog(bankDialog)).catch(() => {}).finally(() => busy(btn, false));
  });

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

  // ---------- mutations: receipts / expenses (debounced + rollback) ----------
  // scheduleSave debounces per entity and keeps the earliest pre-edit snapshot for rollback.
  function scheduleSave(key, snap, fire) {
    if (!saveQueue[key]) saveQueue[key] = { snap };
    clearTimeout(saveQueue[key].timer);
    saveQueue[key].timer = setTimeout(() => {
      const s = saveQueue[key].snap; delete saveQueue[key];
      fire(s);
    }, 250);
  }
  function replaceReceipt(snap) { const i = doc.receipts.findIndex((r) => r.id === snap.id); if (i >= 0) doc.receipts[i] = snap; }
  function replaceExpense(snap) { const i = doc.expenses.findIndex((e) => e.id === snap.id); if (i >= 0) doc.expenses[i] = snap; }

  function saveReceiptDebounced(rc, snap) {
    scheduleSave("receipt:" + rc.id, snap, (s) =>
      pushDoc(api(`/trips/${tripId}/receipts/${rc.id}`, { method: "PUT", body: rc }), { rollback: () => replaceReceipt(s) }));
  }
  function saveExpenseDebounced(e, snap) {
    scheduleSave("expense:" + e.id, snap, (s) =>
      pushDoc(api(`/trips/${tripId}/expenses/${e.id}`, { method: "PUT", body: e }), { rollback: () => replaceExpense(s) }));
  }
  function snapFor(key, obj) { return saveQueue[key] ? null : clone(obj); } // earliest-in-burst snapshot

  function toggleItemSharer(rc, it, pid) {
    const snap = snapFor("receipt:" + rc.id, rc);
    const set = new Set(it.sharedBy || []);
    set.has(pid) ? set.delete(pid) : set.add(pid);
    it.sharedBy = doc.people.map((p) => p.id).filter((id) => set.has(id));
    render(); saveReceiptDebounced(rc, snap);
  }
  function setItemSharers(rc, it, ids) {
    const snap = snapFor("receipt:" + rc.id, rc);
    it.sharedBy = ids.slice(); render(); saveReceiptDebounced(rc, snap);
  }
  function toggleExpenseMember(e, pid) {
    const snap = snapFor("expense:" + e.id, e);
    e.shares = e.shares || {};
    if (e.shares[pid] !== undefined) delete e.shares[pid]; else e.shares[pid] = 1;
    render(); saveExpenseDebounced(e, snap);
  }
  function setExpenseMembers(e, ids) {
    const snap = snapFor("expense:" + e.id, e);
    const s = {}; ids.forEach((id) => s[id] = 1); e.shares = s; render(); saveExpenseDebounced(e, snap);
  }
  function deleteAdjustment(a) {
    const snap = clone(a);
    doc.adjustments = doc.adjustments.filter((x) => x.id !== a.id); render();
    pushDoc(api(`/trips/${tripId}/adjustments/${a.id}`, { method: "DELETE" }), {
      okMsg: undefined,
      rollback: () => { doc.adjustments.push(snap); },
    }).then(() => {
      toast("Adjustment removed", { type: "ok", action: () => readjust(snap), actionLabel: "Undo" });
    }).catch(() => {});
  }
  function readjust(a) {
    pushDoc(api(`/trips/${tripId}/adjustments`, { method: "POST", body: { kind: a.kind, fromId: a.fromId, toId: a.toId, amount: a.amount, label: a.label } }), { okMsg: "Restored" });
  }

  // ---------- generic dialog helpers (focus model, validation) ----------
  let lastFocus = null;
  function openDialog(dlg, focusSel) {
    lastFocus = document.activeElement;
    dlg.returnValue = "";
    dlg.showModal();
    setTimeout(() => { const f = focusSel && dlg.querySelector(focusSel); if (f) f.focus(); }, 30);
  }
  function closeDialog(dlg) {
    dlg.close();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) {} }
    lastFocus = null;
  }
  function clearErr(dlg) { dlg.querySelectorAll(".field__err").forEach((e) => { e.textContent = ""; e.hidden = true; }); }
  function showErr(el, msg, focusEl) {
    if (el) { el.textContent = msg; el.hidden = false; }
    if (focusEl) focusEl.focus();
  }
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on; btn.setAttribute("aria-busy", on ? "true" : "false");
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = "Saving…"; }
    else if (btn.dataset.label) { btn.textContent = btn.dataset.label; delete btn.dataset.label; }
  }
  // submit helper: validate() -> if string returned, show error; else run save() (returns promise) and close on success.
  function wireForm(form, dlg, validate, save, primaryBtn) {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      clearErr(dlg);
      const err = validate();
      if (err) { showErr($("#" + err.el), err.msg, err.focus && $("#" + err.focus)); return; }
      const btn = primaryBtn ? $(primaryBtn) : null; busy(btn, true);
      Promise.resolve(save())
        .then(() => { closeDialog(dlg); })
        .catch(() => { /* toast already fired by pushDoc */ })
        .finally(() => busy(btn, false));
    });
    dlg.addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(dlg); });
  }

  // themed confirm() replacement -> Promise<bool>
  const confirmDialog = $("#confirmDialog");
  let confirmResolve = null;
  function confirmAsk({ title, body, okLabel = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $("#confirmTitle").textContent = title || "Are you sure?";
      $("#confirmBody").innerHTML = body || "";
      const ok = $("#confirmOk"); ok.textContent = okLabel; ok.classList.toggle("danger-solid", danger);
      openDialog(confirmDialog, danger ? "#confirmCancel" : "#confirmOk");
    });
  }
  function resolveConfirm(v) { if (confirmResolve) { confirmResolve(v); confirmResolve = null; } closeDialog(confirmDialog); }
  $("#confirmOk").addEventListener("click", () => resolveConfirm(true));
  $("#confirmCancel").addEventListener("click", () => resolveConfirm(false));
  confirmDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); resolveConfirm(false); });

  // ---------- reusable person picker (searchable) ----------
  const pickerDialog = $("#pickerDialog");
  let pickerSel = new Set(), pickerOnSave = null;
  function renderPickerList(filter) {
    const list = $("#pickerList"); list.innerHTML = "";
    const f = (filter || "").trim().toLowerCase();
    const ppl = doc.people.filter((p) => !f || p.name.toLowerCase().includes(f));
    ppl.sort((a, b) => { const sa = pickerSel.has(a.id), sb = pickerSel.has(b.id); if (sa !== sb) return sa ? -1 : 1; return a.name.localeCompare(b.name); });
    if (!ppl.length) { list.innerHTML = `<p class="empty-hint">No matches.</p>`; }
    ppl.forEach((p) => {
      const on = pickerSel.has(p.id);
      const row = document.createElement("button"); row.type = "button"; row.className = "picker-row" + (on ? " is-on" : "");
      row.setAttribute("aria-pressed", on ? "true" : "false");
      row.innerHTML = `<span class="avatar" style="--c:${pcol(p.id)}" aria-hidden="true">${esc(initials(p.name))}</span>
        <span class="picker-name">${esc(p.name)}</span><span class="picker-check" aria-hidden="true">${on ? "✓" : ""}</span>`;
      row.addEventListener("click", () => { if (pickerSel.has(p.id)) pickerSel.delete(p.id); else pickerSel.add(p.id); renderPickerList($("#pickerSearch").value); updatePickerCount(); });
      list.appendChild(row);
    });
  }
  function updatePickerCount() { $("#pickerCount").textContent = pickerSel.size + " selected"; }
  function openPicker({ title, selected, onSave }) {
    pickerSel = new Set(selected || []); pickerOnSave = onSave;
    $("#pickerTitle").textContent = title || "Who shared this?";
    $("#pickerSearch").value = "";
    renderPickerList(""); updatePickerCount();
    openDialog(pickerDialog, "#pickerSearch");
  }
  $("#pickerSearch").addEventListener("input", (e) => renderPickerList(e.target.value));
  $("#pickerAll").addEventListener("click", () => { doc.people.forEach((p) => pickerSel.add(p.id)); renderPickerList($("#pickerSearch").value); updatePickerCount(); });
  $("#pickerNone").addEventListener("click", () => { pickerSel.clear(); renderPickerList($("#pickerSearch").value); updatePickerCount(); });
  $("#pickerCancel").addEventListener("click", () => closeDialog(pickerDialog));
  $("#pickerSave").addEventListener("click", () => {
    const ids = doc.people.map((p) => p.id).filter((id) => pickerSel.has(id));
    closeDialog(pickerDialog); if (pickerOnSave) pickerOnSave(ids);
  });
  pickerDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(pickerDialog); });

  // ---------- person dialog ----------
  const personDialog = $("#personDialog");
  let pnEditing = null, pnColor = PALETTE[0];
  function buildSwatches() {
    const w = $("#pnSwatches"); w.innerHTML = "";
    PALETTE.forEach((c, i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "swatch"; b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", "false"); b.setAttribute("aria-label", "Colour " + (i + 1));
      b.style.background = c; b.dataset.c = c;
      b.addEventListener("click", () => selectSwatch(c));
      w.appendChild(b);
    });
  }
  function selectSwatch(c) { pnColor = c; $("#pnSwatches").querySelectorAll(".swatch").forEach((s) => { const on = s.dataset.c === c; s.classList.toggle("is-on", on); s.setAttribute("aria-checked", on ? "true" : "false"); }); }
  function openPerson(p) {
    pnEditing = p ? p.id : null;
    $("#pnTitle").textContent = p ? "Edit person" : "Add person";
    $("#pnName").value = p ? p.name : "";
    selectSwatch(p && p.color ? p.color : genColor(doc.people.length));
    $("#pnDelete").hidden = !p;
    clearErr(personDialog);
    openDialog(personDialog, "#pnName");
  }
  $("#addPersonBtn").addEventListener("click", () => openPerson(null));
  $("#pnCancel").addEventListener("click", () => closeDialog(personDialog));
  wireForm($("#personForm"), personDialog,
    () => { const name = $("#pnName").value.trim(); if (!name) return { el: "pnErr", msg: "Name is required", focus: "pnName" }; return null; },
    () => {
      const body = { name: $("#pnName").value.trim(), color: pnColor };
      return pnEditing
        ? pushDoc(api(`/trips/${tripId}/people/${pnEditing}`, { method: "PUT", body }), { okMsg: "Saved" })
        : pushDoc(api(`/trips/${tripId}/people`, { method: "POST", body }), { okMsg: "Person added" });
    }, "#pnSave");
  $("#pnDelete").addEventListener("click", async () => {
    if (!pnEditing) return;
    const c = compute();
    const onItems = (doc.receipts || []).reduce((n, rc) => n + (rc.items || []).filter((it) => (it.sharedBy || []).includes(pnEditing)).length, 0);
    const ok = await confirmAsk({ title: "Delete this person?", danger: true, okLabel: "Delete",
      body: `<b>${esc(pname(pnEditing))}</b> will be removed from all splits${onItems ? ` (${onItems} item${onItems > 1 ? "s" : ""})` : ""}. Their share is redistributed to the others.` });
    if (!ok) return;
    closeDialog(personDialog);
    pushDoc(api(`/trips/${tripId}/people/${pnEditing}`, { method: "DELETE" }), { okMsg: "Person removed" });
  });

  // ---------- receipt dialog (manual + OCR draft) ----------
  const receiptDialog = $("#receiptDialog");
  let rcEditing = null, rcItems = [];
  function payerOptions(sel, selected) {
    sel.innerHTML = "";
    const none = document.createElement("option"); none.value = ""; none.textContent = "— nobody —"; sel.appendChild(none);
    doc.people.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; if (p.id === selected) o.selected = true; sel.appendChild(o); });
  }
  function addRcItem(focus) {
    rcItems.push({ name: "", quantity: 1, unitPrice: 0, lineTotal: 0, sharedBy: [] });
    appendRcRow(rcItems[rcItems.length - 1], rcItems.length - 1, focus);
  }
  function appendRcRow(it, idx, focus) {
    const w = $("#rcItems");
    const row = document.createElement("div"); row.className = "rc-item";
    row.innerHTML = `
      <input class="ri-name" aria-label="Item name" placeholder="Item" value="${esc(it.name || "")}" />
      <input class="ri-qty" type="number" min="1" step="1" inputmode="numeric" aria-label="Quantity" value="${it.quantity || 1}" />
      <input class="ri-total" type="number" min="0" step="1" inputmode="numeric" aria-label="Line total" value="${it.lineTotal || 0}" />
      <button type="button" class="ri-del" aria-label="Remove item"><span aria-hidden="true">✕</span></button>`;
    row.querySelector(".ri-name").addEventListener("input", (e) => it.name = e.target.value);
    row.querySelector(".ri-qty").addEventListener("input", (e) => it.quantity = parseInt(e.target.value, 10) || 1);
    row.querySelector(".ri-total").addEventListener("input", (e) => it.lineTotal = parseInt(e.target.value, 10) || 0);
    row.querySelector(".ri-del").addEventListener("click", () => { const i = rcItems.indexOf(it); if (i >= 0) rcItems.splice(i, 1); row.remove(); });
    w.appendChild(row);
    if (focus) row.querySelector(".ri-name").focus();
  }
  function renderRcItems() { const w = $("#rcItems"); w.innerHTML = ""; rcItems.forEach((it, i) => appendRcRow(it, i)); }
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
    clearErr(receiptDialog);
    openDialog(receiptDialog, "#rcName");
  }
  $("#addReceiptBtn").addEventListener("click", () => openReceipt(null));
  $("#rcAddItem").addEventListener("click", () => addRcItem(true));
  $("#rcCancel").addEventListener("click", () => closeDialog(receiptDialog));
  wireForm($("#receiptForm"), receiptDialog,
    () => { if (!$("#rcName").value.trim()) return { el: "rcErr", msg: "Title is required", focus: "rcName" };
            if (!rcItems.some((it) => (it.name || "").trim() || it.lineTotal)) return { el: "rcErr", msg: "Add at least one item" }; return null; },
    () => {
      const items = rcItems.filter((it) => (it.name || "").trim() || it.lineTotal)
        .map((it) => ({ id: it.id, name: (it.name || "").trim() || "Item", quantity: it.quantity || 1, unitPrice: it.unitPrice || (it.quantity ? Math.round(it.lineTotal / it.quantity) : it.lineTotal), lineTotal: it.lineTotal || 0, sharedBy: it.sharedBy || [] }));
      const body = { title: $("#rcName").value.trim() || "Receipt", date: $("#rcDate").value || "", payerId: $("#rcPayer").value, items, grandTotal: parseInt($("#rcGrand").value, 10) || 0 };
      return rcEditing
        ? pushDoc(api(`/trips/${tripId}/receipts/${rcEditing}`, { method: "PUT", body }), { okMsg: "Saved" })
        : pushDoc(api(`/trips/${tripId}/receipts`, { method: "POST", body }), { okMsg: "Receipt added" });
    }, "#rcSave");
  $("#rcDelete").addEventListener("click", async () => {
    if (!rcEditing) return;
    const ok = await confirmAsk({ title: "Delete this receipt?", danger: true, okLabel: "Delete", body: "This removes the receipt and its items from the split." });
    if (!ok) return;
    closeDialog(receiptDialog);
    pushDoc(api(`/trips/${tripId}/receipts/${rcEditing}`, { method: "DELETE" }), { okMsg: "Receipt deleted" });
  });

  // ---------- expense dialog ----------
  const expenseDialog = $("#expenseDialog");
  let exEditing = null, exMode = "EVENLY", exShares = {};
  function applyMode(m, reseed) {
    exMode = m;
    document.querySelectorAll("#exSplitMode .seg__btn").forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false"); });
    if (reseed) {
      const ids = Object.keys(exShares).filter((id) => personById[id]);
      const amt = parseInt($("#exAmount").value, 10) || 0;
      const n = ids.length || 1;
      if (m === "EVENLY") ids.forEach((id) => exShares[id] = 1);
      else if (m === "BY_SHARES") ids.forEach((id) => exShares[id] = 1);
      else if (m === "BY_PERCENTAGE") ids.forEach((id) => exShares[id] = Math.round(100 / n));
      else if (m === "BY_AMOUNT") ids.forEach((id) => exShares[id] = Math.floor(amt / n));
    }
    renderExParts();
  }
  function exSummary() {
    const el = $("#exSummary"); if (!el) return;
    const ids = Object.keys(exShares).filter((id) => personById[id]);
    const amt = parseInt($("#exAmount").value, 10) || 0;
    if (!ids.length) { el.className = "ex-summary warn-text"; el.textContent = "Pick at least one person."; return; }
    if (exMode === "EVENLY") { el.className = "ex-summary"; el.textContent = `${money(amt / ids.length)} each · ${ids.length} ${ids.length === 1 ? "person" : "people"}`; return; }
    if (exMode === "BY_SHARES") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); el.className = "ex-summary" + (t > 0 ? "" : " warn-text"); el.textContent = t > 0 ? `${t} shares total` : "Shares must be > 0"; return; }
    if (exMode === "BY_PERCENTAGE") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); const ok = Math.abs(t - 100) < 0.5; el.className = "ex-summary" + (ok ? " ok-text" : " warn-text"); el.textContent = ok ? `Σ 100% ✓` : `Σ ${t}% — ${t < 100 ? (100 - t) + "% unallocated" : (t - 100) + "% over"}`; return; }
    if (exMode === "BY_AMOUNT") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); const ok = t === amt; el.className = "ex-summary" + (ok ? " ok-text" : " warn-text"); el.textContent = `Σ ${money(t)} of ${money(amt)}` + (ok ? " ✓" : ""); return; }
  }
  function distributeEvenly() {
    const ids = Object.keys(exShares).filter((id) => personById[id]); if (!ids.length) return;
    const amt = parseInt($("#exAmount").value, 10) || 0; const n = ids.length;
    if (exMode === "BY_PERCENTAGE") { const base = Math.floor(100 / n); ids.forEach((id) => exShares[id] = base); exShares[ids[0]] += 100 - base * n; }
    else if (exMode === "BY_AMOUNT") { const base = Math.floor(amt / n); ids.forEach((id) => exShares[id] = base); exShares[ids[0]] += amt - base * n; }
    else ids.forEach((id) => exShares[id] = 1);
    renderExParts();
  }
  function renderExParts() {
    const w = $("#exParts"); w.innerHTML = "";
    $("#exPartLabel").textContent = exMode === "EVENLY" ? "Shared by" : exMode === "BY_PERCENTAGE" ? "Percent each" : exMode === "BY_AMOUNT" ? "Amount each" : "Shares each";
    w.classList.toggle("ex-parts--col", exMode !== "EVENLY" || bigMode());
    doc.people.forEach((p) => {
      const on = exShares[p.id] !== undefined;
      const row = document.createElement("div"); row.className = "ex-part" + (on ? " is-on" : "");
      const chip = document.createElement("button"); chip.type = "button"; chip.className = "chip"; chip.style.setProperty("--c", personColor[p.id]);
      chip.setAttribute("aria-pressed", on ? "true" : "false"); chip.setAttribute("aria-label", (on ? "Sharing: " : "Not sharing: ") + p.name); chip.textContent = p.name;
      chip.addEventListener("click", () => { if (exShares[p.id] !== undefined) delete exShares[p.id]; else exShares[p.id] = exMode === "EVENLY" ? 1 : (exMode === "BY_PERCENTAGE" ? 0 : 0); renderExParts(); });
      row.appendChild(chip);
      if (on && exMode !== "EVENLY") {
        const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.inputMode = "numeric"; inp.className = "ex-share";
        inp.setAttribute("aria-label", p.name + " " + (exMode === "BY_PERCENTAGE" ? "percent" : exMode === "BY_AMOUNT" ? "amount" : "shares")); inp.value = exShares[p.id] || 0;
        inp.addEventListener("input", (e) => { exShares[p.id] = parseFloat(e.target.value) || 0; exSummary(); });
        row.appendChild(inp);
      }
      w.appendChild(row);
    });
    exSummary();
  }
  function openExpense(e, prefill) {
    exEditing = e ? e.id : null;
    $("#exTitle").textContent = e ? "Edit shared cost" : "Add shared cost";
    $("#exName").value = e ? e.title : (prefill && prefill.title || "");
    $("#exAmount").value = e ? e.amount : (prefill && prefill.amount || "");
    payerOptions($("#exPayer"), e ? e.payerId : "");
    exShares = e && e.shares ? Object.assign({}, e.shares) : {};
    if (!e) doc.people.forEach((p) => exShares[p.id] = 1); // default: everyone
    applyMode(e && e.splitMode ? e.splitMode : "EVENLY", false);
    $("#exDelete").hidden = !e;
    clearErr(expenseDialog);
    openDialog(expenseDialog, "#exName");
  }
  document.querySelectorAll("#exSplitMode .seg__btn").forEach((b) => b.addEventListener("click", () => applyMode(b.dataset.mode, true)));
  $("#exAmount").addEventListener("input", exSummary);
  $("#exDistribute").addEventListener("click", distributeEvenly);
  $("#addExpenseBtn").addEventListener("click", () => openExpense(null));
  $("#exCancel").addEventListener("click", () => closeDialog(expenseDialog));
  wireForm($("#expenseForm"), expenseDialog,
    () => {
      if (!$("#exName").value.trim()) return { el: "exErr", msg: "Title is required", focus: "exName" };
      const amt = parseInt($("#exAmount").value, 10) || 0; if (amt <= 0) return { el: "exErr", msg: "Amount must be more than 0", focus: "exAmount" };
      const ids = Object.keys(exShares).filter((id) => personById[id]); if (!ids.length) return { el: "exErr", msg: "Pick at least one person" };
      if (exMode === "BY_PERCENTAGE") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); if (Math.abs(t - 100) >= 0.5) return { el: "exErr", msg: `Percentages must total 100% (now ${t}%)` }; }
      if (exMode === "BY_AMOUNT") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); if (t !== amt) return { el: "exErr", msg: `Amounts must total ${money(amt)} (now ${money(t)})` }; }
      if (exMode === "BY_SHARES") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); if (t <= 0) return { el: "exErr", msg: "Shares must be greater than 0" }; }
      return null;
    },
    () => {
      const shares = {}; Object.keys(exShares).forEach((id) => { if (personById[id]) shares[id] = exMode === "EVENLY" ? 1 : (exShares[id] || 0); });
      const body = { title: $("#exName").value.trim() || "Shared cost", amount: parseInt($("#exAmount").value, 10) || 0, payerId: $("#exPayer").value, splitMode: exMode, shares };
      return exEditing
        ? pushDoc(api(`/trips/${tripId}/expenses/${exEditing}`, { method: "PUT", body }), { okMsg: "Saved" })
        : pushDoc(api(`/trips/${tripId}/expenses`, { method: "POST", body }), { okMsg: "Cost added" });
    }, "#exSave");
  $("#exDelete").addEventListener("click", async () => {
    if (!exEditing) return;
    const ok = await confirmAsk({ title: "Delete this shared cost?", danger: true, okLabel: "Delete", body: "" });
    if (!ok) return;
    closeDialog(expenseDialog);
    pushDoc(api(`/trips/${tripId}/expenses/${exEditing}`, { method: "DELETE" }), { okMsg: "Cost deleted" });
  });

  // ---------- adjustment dialog ----------
  const adjustDialog = $("#adjustDialog");
  let adjKind = "debt";
  function fillPeopleSelect(sel, idx) {
    sel.innerHTML = "";
    doc.people.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
    if (idx != null && sel.options[idx]) sel.selectedIndex = idx;
  }
  function setAdjKind(k) { adjKind = k; document.querySelectorAll("#adjKind .seg__btn").forEach((b) => { const on = b.dataset.kind === k; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false"); }); $("#adjFromLabel").textContent = k === "payment" ? "Who paid" : "Who owes"; }
  document.querySelectorAll("#adjKind .seg__btn").forEach((b) => b.addEventListener("click", () => setAdjKind(b.dataset.kind)));
  $("#addAdjustBtn").addEventListener("click", () => {
    if (doc.people.length < 2) { toast("Add at least two people first", { type: "err" }); return; }
    fillPeopleSelect($("#adjFrom"), 0); fillPeopleSelect($("#adjTo"), Math.min(1, doc.people.length - 1));
    $("#adjAmount").value = ""; $("#adjLabel").value = ""; setAdjKind("debt");
    clearErr(adjustDialog);
    openDialog(adjustDialog, "#adjFrom");
  });
  $("#adjCancel").addEventListener("click", () => closeDialog(adjustDialog));
  wireForm($("#adjustForm"), adjustDialog,
    () => {
      const fromId = $("#adjFrom").value, toId = $("#adjTo").value;
      const amount = Math.max(0, parseInt($("#adjAmount").value, 10) || 0);
      if (!fromId || !toId) return { el: "adjErr", msg: "Pick both people" };
      if (fromId === toId) return { el: "adjErr", msg: "Pick two different people" };
      if (amount <= 0) return { el: "adjErr", msg: "Amount must be more than 0", focus: "adjAmount" };
      return null;
    },
    () => {
      const body = { kind: adjKind, fromId: $("#adjFrom").value, toId: $("#adjTo").value, amount: Math.max(0, parseInt($("#adjAmount").value, 10) || 0), label: $("#adjLabel").value.trim() };
      return pushDoc(api(`/trips/${tripId}/adjustments`, { method: "POST", body }), { okMsg: "Adjustment added" });
    }, "#adjSave");

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
      if (err.code === 503) toast("Photo scanning isn't set up on the server yet.", { type: "err" });
      else if (err.code === 422) toast("Couldn't read a receipt — try a clearer photo or add it manually.", { type: "err" });
      else if (err.code === 429) toast("Too many uploads — try again in a bit.", { type: "err" });
      else if (err.code === 401) { toast("Enter the passcode to upload.", { type: "err" }); lock(); }
      else toast("Scan failed: " + (err.body && err.body.error ? err.body.error : err.message), { type: "err" });
    }
  });

  // ---------- login / logout ----------
  const loginDialog = $("#loginDialog");
  $("#loginBtn").addEventListener("click", () => { $("#loginPassword").value = ""; clearErr(loginDialog); openDialog(loginDialog, "#loginPassword"); });
  $("#loginCancel").addEventListener("click", () => closeDialog(loginDialog));
  $("#loginForm").addEventListener("submit", async (ev) => {
    ev.preventDefault(); clearErr(loginDialog);
    const btn = $("#loginSubmit"); busy(btn, true);
    try {
      await api("/login", { method: "POST", body: { password: $("#loginPassword").value } });
      closeDialog(loginDialog);
      admin = true; applyAdminUI(); toast("Logged in", { type: "ok" });
      await refreshTrip();
    } catch (err) {
      showErr($("#loginErr"), err.code === 429 ? "Too many attempts — wait a bit." : "Wrong password");
      const card = loginDialog.querySelector(".dialog__form"); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
      $("#loginPassword").select();
    } finally { busy(btn, false); }
  });
  loginDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(loginDialog); });
  $("#logoutBtn").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (_) {}
    admin = false; applyAdminUI(); render(); toast("Logged out", { type: "ok" });
  });

  function applyAdminUI() {
    document.body.classList.toggle("is-admin", admin);
    document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !admin; });
    $("#loginBtn").hidden = admin || !loginEnabled;
    $("#logoutBtn").hidden = !admin;
    // OCR upload is editor-tier (any passcode user) — show only when configured server-side.
    if ($("#ocrBtn")) $("#ocrBtn").hidden = !ocrEnabled;
    if ($("#ocrPrivacy")) $("#ocrPrivacy").hidden = !ocrEnabled;
  }

  // ---------- export PDF ----------
  function allOrExcept(ids) {
    const all = doc.people.map((p) => p.id);
    const set = new Set(ids);
    if (ids.length === all.length && all.every((id) => set.has(id))) return "Everyone";
    const missing = all.filter((id) => !set.has(id));
    if (ids.length && missing.length && missing.length <= 2) return "Everyone except " + missing.map(pname).join(", ");
    return ids.map(pname).join(", ");
  }
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
      return `<tr><td>${esc(e.title)}</td><td class="num">${money(e.amount)}</td><td>paid by ${esc(pname(e.payerId))}</td><td>${esc(allOrExcept(keys) || "—")}</td></tr>`;
    }).join("");
    const rcHtml = doc.receipts.slice().sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b))).map((rc) => {
      const grand = rc.grandTotal || sumItems(rc.items); const ratio = grand / (sumItems(rc.items) || 1);
      const rows = (rc.items || []).map((it) => {
        const sh = (it.sharedBy || []).filter((id) => personById[id]);
        const per = sh.length ? ((it.lineTotal || 0) * ratio) / sh.length : 0;
        return `<tr><td>${esc(it.name)}${it.quantity > 1 ? " ×" + it.quantity : ""}</td><td class="num">${money(it.lineTotal || 0)}</td><td>${esc(sh.length ? allOrExcept(sh) : "— unassigned —")}</td><td class="num">${sh.length ? money(per) + " ea" : ""}</td></tr>`;
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

  // ---------- mobile sheet (a11y: button FAB, aria-expanded, Esc, focus, inert) ----------
  const settleEl = $("#settle"); const fab = $("#settleFab");
  const scrim = document.createElement("div"); scrim.className = "scrim"; document.body.appendChild(scrim);
  const inertEls = () => [$(".topbar"), $(".main-col")].filter(Boolean);
  function sheetIsMobile() { return window.matchMedia("(max-width: 919px)").matches; }
  function openSheet() {
    settleEl.classList.add("open"); scrim.classList.add("show"); fab.classList.add("up");
    fab.setAttribute("aria-expanded", "true");
    if (sheetIsMobile()) {
      settleEl.setAttribute("role", "dialog"); settleEl.setAttribute("aria-modal", "true");
      inertEls().forEach((e) => e.setAttribute("inert", ""));
      setTimeout(() => { const g = $("#sheetGrip"); if (g) g.focus(); }, 30);
    }
  }
  function closeSheet() {
    settleEl.classList.remove("open"); scrim.classList.remove("show"); fab.classList.remove("up");
    fab.setAttribute("aria-expanded", "false");
    settleEl.removeAttribute("role"); settleEl.removeAttribute("aria-modal");
    inertEls().forEach((e) => e.removeAttribute("inert"));
    if (sheetIsMobile()) fab.focus();
  }
  function toggleSheet() { settleEl.classList.contains("open") ? closeSheet() : openSheet(); }
  fab.addEventListener("click", toggleSheet);
  scrim.addEventListener("click", closeSheet);
  const grip = $("#sheetGrip");
  if (grip) grip.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && settleEl.classList.contains("open") && !document.querySelector("dialog[open]")) closeSheet(); });
  let touchY = null;
  settleEl.addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; sheetDragging = true; }, { passive: true });
  settleEl.addEventListener("touchmove", (e) => {
    if (touchY == null || !settleEl.classList.contains("open")) return;
    const inner = settleEl.querySelector(".settle__inner");
    if (e.touches[0].clientY - touchY > 70 && inner && inner.scrollTop <= 0) { closeSheet(); touchY = null; }
  }, { passive: true });
  settleEl.addEventListener("touchend", () => { touchY = null; sheetDragging = false; flushPending(); });

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
  $("#lockForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#lockInput").value.trim(); if (!v) return; pass = v; tryLoad(); });

  // ---------- poll guard ----------
  function flushPending() {
    if (!pendingDoc) return;
    if (inflight > 0 || document.querySelector("dialog[open]") || (sheetDragging)) return;
    const d = pendingDoc; pendingDoc = null;
    const y = window.scrollY; adoptDoc(d); render(); window.scrollTo(0, y);
    toast("Updated — refreshed", { type: "ok", ms: 1800 });
  }
  function pollApply(d) {
    if (!d || d.rev === (doc && doc.rev)) { setSync("live"); return; }
    if (inflight > 0 || document.querySelector("dialog[open]") || sheetDragging) { pendingDoc = d; setSync("live"); return; }
    const y = window.scrollY; adoptDoc(d); render(); window.scrollTo(0, y); setSync("live");
  }

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
      api("/trips/" + tripId).then((d) => pollApply(d))
        .catch((e) => { if (e.code === 401) lock("Enter passcode"); else setSync("offline"); });
    }, 4000);
  }

  async function boot() {
    buildSwatches();
    try { const me = await api("/me"); admin = !!me.admin; loginEnabled = !!me.loginEnabled; ocrEnabled = !!me.ocrEnabled; } catch (_) {}
    applyAdminUI();
    pass = localStorage.getItem(PASS_KEY) || "";
    if (tripId) { const cc = cacheLoad(); if (cc) { adoptDoc(cc); render(); } }
    tryLoad();
  }
  boot();
})();
