import { state } from "./state.js";
import { $, money, esc, sumItems, bigMode, fmtWhen, dateSortKey, pname, pcol, initials, canEdit, copyText } from "./core.js";
import { openPerson, openPicker, setExpenseMembers, openExpense, toggleExpenseMember, openReceipt, setItemSharers, toggleItemSharer, deleteAdjustment } from "./dialogs.js";
import { openBank, publishSettlement, regenerateSettlement, unpublishSettlement, uploadProof, openProof, setVerify } from "./actions.js";

// ---------- settlement ----------
export function compute() {
  const consumed = {}, paid = {}, owes = {}, owed = {};
  (state.doc.people || []).forEach((p) => { consumed[p.id] = paid[p.id] = owes[p.id] = owed[p.id] = 0; });
  let unassignedTotal = 0, unassignedCount = 0, totalLines = 0, assignedLines = 0;

  (state.doc.receipts || []).forEach((rc) => {
    const grand = rc.grandTotal || sumItems(rc.items);
    if (rc.payerId && paid[rc.payerId] !== undefined) paid[rc.payerId] += grand;
    const ratio = grand / (sumItems(rc.items) || 1);
    (rc.items || []).forEach((it) => {
      totalLines++;
      const sh = (it.sharedBy || []).filter((id) => state.personById[id]);
      const scaled = (it.lineTotal || 0) * ratio;
      if (sh.length === 0) { unassignedTotal += scaled; unassignedCount++; }
      else { assignedLines++; const per = scaled / sh.length; sh.forEach((id) => consumed[id] += per); }
    });
  });

  (state.doc.expenses || []).forEach((e) => {
    if (e.payerId && paid[e.payerId] !== undefined) paid[e.payerId] += e.amount || 0;
    totalLines++;
    const keys = Object.keys(e.shares || {}).filter((id) => state.personById[id]);
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

  (state.doc.adjustments || []).forEach((a) => {
    if (!state.personById[a.fromId] || !state.personById[a.toId]) return;
    const amt = a.amount || 0;
    if (a.kind === "payment") { owed[a.fromId] += amt; owes[a.toId] += amt; }
    else { owes[a.fromId] += amt; owed[a.toId] += amt; }
  });

  const net = {};
  (state.doc.people || []).forEach((p) => net[p.id] = paid[p.id] - consumed[p.id] - owes[p.id] + owed[p.id]);
  return { consumed, paid, net, unassignedTotal, unassignedCount, totalLines, assignedLines };
}

export function settle(net) {
  const cr = [], db = [];
  (state.doc.people || []).forEach((p) => {
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

// ---------- chips / avatars ----------
export function personChip(pid, active, onClick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip" + (canEdit ? "" : " chip--ro");
  b.style.setProperty("--c", pcol(pid));
  b.dataset.pid = pid;
  b.setAttribute("aria-pressed", active ? "true" : "false");
  b.setAttribute("aria-label", (active ? I18N.t("split.chip.sharing", "Sharing: ") : I18N.t("split.chip.notSharing", "Not sharing: ")) + pname(pid));
  b.textContent = pname(pid);
  if (canEdit && onClick) b.addEventListener("click", onClick);
  return b;
}
export function mkMini(label, fn, aria) {
  const b = document.createElement("button");
  b.className = "mini-btn"; b.type = "button"; b.textContent = label;
  if (aria) b.setAttribute("aria-label", aria);
  b.addEventListener("click", fn); return b;
}
export function avatar(pid) {
  const s = document.createElement("span"); s.className = "avatar"; s.style.setProperty("--c", pcol(pid));
  s.textContent = initials(pname(pid)); s.title = pname(pid); s.setAttribute("aria-hidden", "true");
  return s;
}
// condensed assigner: stack of assigned avatars + a button that opens the picker
export function assignStack(ids, label, onOpen) {
  const wrap = document.createElement("button");
  wrap.type = "button"; wrap.className = "assign";
  wrap.setAttribute("aria-label", ids.length ? I18N.t("split.assign.changeAria", "{label}: {names} — tap to change", { label, names: ids.map(pname).join(", ") }) : I18N.t("split.assign.assignAria", "{label}: nobody — tap to assign", { label }));
  if (!ids.length) { wrap.classList.add("assign--empty"); wrap.textContent = I18N.t("split.assign.empty", "Assign people"); }
  else {
    const stack = document.createElement("span"); stack.className = "avatar-stack";
    ids.slice(0, 6).forEach((id) => stack.appendChild(avatar(id)));
    if (ids.length > 6) { const more = document.createElement("span"); more.className = "avatar avatar--more"; more.textContent = "+" + (ids.length - 6); more.setAttribute("aria-hidden", "true"); stack.appendChild(more); }
    wrap.appendChild(stack);
    const cap = document.createElement("span"); cap.className = "assign__cap"; cap.textContent = ids.length === 1 ? I18N.t("split.assign.countOne", "{n} person", { n: ids.length }) : I18N.t("split.assign.countMany", "{n} people", { n: ids.length });
    wrap.appendChild(cap);
  }
  if (canEdit && onOpen) wrap.addEventListener("click", onOpen);
  else wrap.disabled = true;
  return wrap;
}

// ---------- render: people bar ----------
export function renderPeopleBar() {
  const el = $("#peopleBar"); el.innerHTML = "";
  if (!state.doc.people.length) { el.innerHTML = `<span class="empty-hint">${esc(state.admin ? I18N.t("split.people.emptyAdmin", "No people yet — add some to start.") : I18N.t("split.people.empty", "No people yet."))}</span>`; return; }
  state.doc.people.forEach((p) => {
    const chip = document.createElement(state.admin ? "button" : "span");
    chip.className = "pbar-chip"; chip.style.setProperty("--c", state.personColor[p.id]);
    chip.innerHTML = `<span class="pbar-dot"></span>${esc(p.name)}`;
    if (state.admin) { chip.type = "button"; chip.setAttribute("aria-label", I18N.t("split.people.editAria", "Edit person: {name}", { name: p.name })); chip.addEventListener("click", () => openPerson(p)); }
    el.appendChild(chip);
  });
}

// ---------- render: shared costs ----------
export function expenseShareText(e) {
  const keys = Object.keys(e.shares || {}).filter((id) => state.personById[id]);
  if (!keys.length) return esc(I18N.t("split.notAssigned", "Not assigned yet"));
  const mode = e.splitMode || "EVENLY";
  const names = keys.map(pname).join(", ");
  if (mode === "EVENLY") return `${esc(names)} · ${esc(I18N.t("split.shareEach", "{amount} each", { amount: money((e.amount || 0) / keys.length) }))}`;
  return `${esc(names)} · ${esc(I18N.t("split.splitMode", "split {mode}", { mode: mode.replace("BY_", "by ").toLowerCase() }))}`;
}
// ---------- collapsible cards (progressive disclosure; per-trip view state, client-only) ----------
export function collapsedSet() { try { return new Set(JSON.parse(localStorage.getItem("tk-collapse-" + state.tripId) || "[]")); } catch (_) { return new Set(); } }
export function saveCollapsed(s) { try { localStorage.setItem("tk-collapse-" + state.tripId, JSON.stringify([...s])); } catch (_) {} }
export function statusPill(done, label) {
  return done ? `<span class="card-status done">✓ ${esc(I18N.t("split.collapse.done", "done"))}</span>`
              : `<span class="card-status">${esc(label)}</span>`;
}
export function makeCollapsible(card, head, cid, statusHtml) {
  card.dataset.cid = cid;
  const body = document.createElement("div"); body.className = "card-body";
  const inner = document.createElement("div"); inner.className = "card-body-inner";
  while (head.nextSibling) inner.appendChild(head.nextSibling);   // fold the details under the head
  body.appendChild(inner); card.appendChild(body);
  const tools = document.createElement("div"); tools.className = "card-tools";
  if (statusHtml) tools.innerHTML = statusHtml;
  const tg = document.createElement("button"); tg.type = "button"; tg.className = "card-collapse";
  tg.setAttribute("aria-label", I18N.t("split.collapse.aria", "Collapse or expand details"));
  tg.innerHTML = `<span class="chev" aria-hidden="true">▾</span>`;
  tools.appendChild(tg); head.appendChild(tools);
  const apply = (c) => { card.classList.toggle("is-collapsed", c); tg.setAttribute("aria-expanded", c ? "false" : "true"); };
  apply(collapsedSet().has(cid));
  tg.addEventListener("click", (ev) => { ev.stopPropagation(); const s = collapsedSet(); const c = !card.classList.contains("is-collapsed"); if (c) s.add(cid); else s.delete(cid); saveCollapsed(s); apply(c); });
}

export function renderShared() {
  const wrap = $("#shared"); wrap.innerHTML = "";
  if (!state.doc.expenses.length) { wrap.innerHTML = `<p class="empty-hint">${esc(canEdit ? I18N.t("split.shared.emptyEdit", "No shared costs — add one.") : I18N.t("split.shared.empty", "No shared costs."))}</p>`; return; }
  state.doc.expenses.forEach((e) => {
    const card = document.createElement("article"); card.className = "expense"; card.id = "expense-" + e.id;
    const head = document.createElement("div"); head.className = "expense__head";
    head.innerHTML = `
      <div>
        <h3 class="expense__name">${esc(e.title)}</h3>
        <div class="payer">${esc(I18N.t("split.paidBy", "paid by"))} <b style="color:${pcol(e.payerId)}">${esc(pname(e.payerId))}</b>
          ${(e.splitMode && e.splitMode !== "EVENLY") ? `<span class="tag">${esc(e.splitMode.replace("BY_", "").toLowerCase())}</span>` : ""}</div>
      </div>
      <div class="expense__amt">${money(e.amount)}</div>`;
    if (canEdit) head.appendChild(mkEdit(() => openExpense(e), I18N.t("split.shared.editAria", "Edit shared cost: {name}", { name: e.title })));
    card.appendChild(head);

    const evenly = (e.splitMode || "EVENLY") === "EVENLY";
    const memberIds = state.doc.people.filter((p) => (e.shares || {})[p.id] !== undefined).map((p) => p.id);

    if (bigMode() || !evenly) {
      // condensed: tap to open picker (evenly) or the expense dialog (weighted)
      const row = document.createElement("div"); row.className = "assign-row";
      row.appendChild(assignStack(memberIds, I18N.t("split.expense.sharedBy", "Shared by"), () => {
        if (evenly) openPicker({ title: e.title || I18N.t("split.expense.sharedBy", "Shared by"), selected: memberIds, onSave: (ids) => setExpenseMembers(e, ids) });
        else openExpense(e);
      }));
      card.appendChild(row);
    } else {
      const chips = document.createElement("div"); chips.className = "chips";
      state.doc.people.forEach((p) => {
        const active = (e.shares || {})[p.id] !== undefined;
        chips.appendChild(personChip(p.id, active, () => toggleExpenseMember(e, p.id)));
      });
      if (canEdit) {
        const q = document.createElement("span"); q.className = "chip-quick";
        q.append(mkMini(I18N.t("split.quick.everyone", "Everyone"), () => setExpenseMembers(e, state.doc.people.map((p) => p.id)), I18N.t("split.quick.shareEveryoneAria", "Share with everyone")),
                 mkMini(I18N.t("common.clear", "Clear"), () => setExpenseMembers(e, []), I18N.t("split.quick.clearSharersAria", "Clear sharers")));
        chips.appendChild(q);
      }
      card.appendChild(chips);
    }
    const note = document.createElement("div"); note.className = "split-note"; note.innerHTML = expenseShareText(e);
    card.appendChild(note);
    makeCollapsible(card, head, "e" + e.id, statusPill(memberIds.length > 0, I18N.t("split.collapse.unassigned", "unassigned")));
    wrap.appendChild(card);
  });
}

// ---------- render: receipts ----------
export function itemShareText(rc, it) {
  const sh = (it.sharedBy || []).filter((id) => state.personById[id]);
  if (!sh.length) return esc(I18N.t("split.notAssigned", "Not assigned yet"));
  const ratio = (rc.grandTotal || sumItems(rc.items)) / (sumItems(rc.items) || 1);
  const per = ((it.lineTotal || 0) * ratio) / sh.length;
  return `${esc(sh.map(pname).join(", "))} · ${I18N.t("split.shareEachBold", "<b>{amount}</b> each", { amount: money(per) })}`;
}
export function renderReceipts() {
  const wrap = $("#receipts"); wrap.innerHTML = "";
  if (!state.doc.receipts.length) { wrap.innerHTML = `<p class="empty-hint">${esc(canEdit ? I18N.t("split.receipts.emptyEdit", "No receipts — add one.") : I18N.t("split.receipts.empty", "No receipts."))}</p>`; return; }
  state.doc.receipts.slice().sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b))).forEach((rc) => {
    const grand = rc.grandTotal || sumItems(rc.items);
    const card = document.createElement("article"); card.className = "receipt";
    const head = document.createElement("div"); head.className = "receipt__head";
    const meta = [rc.sub, fmtWhen(rc.date, rc.time)].filter(Boolean).join("  ·  ");
    head.innerHTML = `
      <div>
        <h3 class="receipt__name">${esc(rc.title)}</h3>
        ${meta ? `<div class="receipt__meta">${esc(meta)}</div>` : ""}
        <div class="payer">${esc(I18N.t("split.paidBy", "paid by"))} <b style="color:${pcol(rc.payerId)}">${esc(pname(rc.payerId))}</b></div>
      </div>
      <div class="receipt__totals"><div class="receipt__grand">${money(grand)}</div></div>`;
    if (canEdit) head.appendChild(mkEdit(() => openReceipt(rc), I18N.t("split.receipts.editAria", "Edit receipt: {name}", { name: rc.title })));
    card.appendChild(head);

    const ul = document.createElement("ul"); ul.className = "items";
    (rc.items || []).forEach((it) => {
      const li = document.createElement("li"); li.className = "item";
      const top = document.createElement("div"); top.className = "item__top";
      const qty = it.quantity && it.quantity > 1 ? `<span class="item__qty">×${it.quantity}</span>` : "";
      const flag = it.needsReview ? `<span class="warn" title="${esc(it.note || I18N.t("split.item.needsReview", "Needs review"))}" aria-label="${esc(I18N.t("split.item.needsReview", "Needs review"))}">⚠</span>` : "";
      top.innerHTML = `<span class="item__name">${esc(it.name)}${qty}${flag}</span>
        <span class="item__price">${money(it.lineTotal || 0)}</span>`;
      li.appendChild(top);

      const sharers = (it.sharedBy || []).filter((id) => state.personById[id]);
      if (bigMode()) {
        const row = document.createElement("div"); row.className = "assign-row";
        row.appendChild(assignStack(sharers, I18N.t("split.expense.sharedBy", "Shared by"), () =>
          openPicker({ title: it.name || I18N.t("split.expense.sharedBy", "Shared by"), selected: sharers, onSave: (ids) => setItemSharers(rc, it, ids) })));
        li.appendChild(row);
      } else {
        const chips = document.createElement("div"); chips.className = "chips";
        state.doc.people.forEach((p) => chips.appendChild(personChip(p.id, (it.sharedBy || []).includes(p.id),
          () => toggleItemSharer(rc, it, p.id))));
        if (canEdit) {
          const q = document.createElement("span"); q.className = "chip-quick";
          q.append(mkMini(I18N.t("split.quick.everyone", "Everyone"), () => setItemSharers(rc, it, state.doc.people.map((p) => p.id)), I18N.t("split.quick.everyoneSharedAria", "Everyone shared this")),
                   mkMini(I18N.t("common.clear", "Clear"), () => setItemSharers(rc, it, []), I18N.t("split.quick.clearSharersAria", "Clear sharers")));
          chips.appendChild(q);
        }
        li.appendChild(chips);
      }
      const note = document.createElement("div"); note.className = "split-note"; note.innerHTML = itemShareText(rc, it);
      li.appendChild(note);
      ul.appendChild(li);
    });
    card.appendChild(ul);
    const unassigned = (rc.items || []).filter((it) => !(it.sharedBy || []).filter((id) => state.personById[id]).length).length;
    makeCollapsible(card, head, "r" + rc.id, statusPill(unassigned === 0, I18N.t("split.collapse.toAssign", "{n} to assign", { n: unassigned })));
    wrap.appendChild(card);
  });
}

export function mkEdit(fn, aria) {
  const b = document.createElement("button");
  b.className = "edit-btn"; b.type = "button"; b.setAttribute("aria-label", aria || I18N.t("common.edit", "Edit")); b.title = I18N.t("common.edit", "Edit");
  b.innerHTML = `<span aria-hidden="true">✎</span>`;
  b.addEventListener("click", fn); return b;
}

// ---------- render: settle panel + final ----------
export function fillTransfers(el, transfers, big) {
  el.innerHTML = "";
  if (!transfers.length) { el.innerHTML = `<li class="${big ? "ftransfer" : "transfer"} empty">${esc(I18N.t("split.allSquare", "All square"))} 🎉</li>`; return; }
  transfers.forEach((t) => {
    const li = document.createElement("li");
    li.setAttribute("aria-label", I18N.t("split.transfer.aria", "{from} pays {to} {amount}", { from: pname(t.from), to: pname(t.to), amount: money(t.amount) }));
    if (big) {
      li.className = "ftransfer";
      li.innerHTML = `<span class="ftransfer__who">
          <span class="person__dot" style="--c:${pcol(t.from)}" aria-hidden="true"></span>
          <b style="color:${pcol(t.from)}">${esc(pname(t.from))}</b>
          <span class="ftransfer__verb" aria-hidden="true">${esc(I18N.t("split.pays", "pays"))}</span>
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

export function personRow(p, c) {
  const n = c.net[p.id];
  const sign = n > 0.5 ? "pos" : n < -0.5 ? "neg" : "";
  const label = n > 0.5 ? I18N.t("split.net.getsBack", "gets back") : n < -0.5 ? I18N.t("split.net.owes", "owes") : I18N.t("split.net.settled", "settled");
  const row = document.createElement("div"); row.className = "person";
  row.setAttribute("aria-label", I18N.t("split.person.aria", "{name} {label} {net}; consumed {consumed}, paid {paid}", { name: p.name, label, net: money(Math.abs(n)), consumed: money(c.consumed[p.id]), paid: money(c.paid[p.id]) }));
  row.innerHTML = `
    <span class="person__dot" style="--c:${state.personColor[p.id]}" aria-hidden="true"></span>
    <span><span class="person__name">${esc(p.name)}</span>
      <span class="person__sub">${esc(I18N.t("split.person.hadPaid", "had {consumed} · paid {paid}", { consumed: money(c.consumed[p.id]), paid: money(c.paid[p.id]) }))}</span></span>
    <span class="person__net ${sign}">${money(Math.abs(n))}<small>${esc(label)}</small></span>`;
  // payout / bank details — only meaningful for receivers (net > 0), or anyone who already set one
  const val = state.personById[p.id] && state.personById[p.id].bankAccount;
  if (n > 0 || val) {
    const mid = row.querySelector(".person__sub").parentNode;
    const pay = document.createElement("span"); pay.className = "person__payout";
    pay.innerHTML = `<span class="person__payout-label">${esc(I18N.t("split.payout.label", "payout"))}</span><span class="person__payout-val${val ? "" : " muted"}">${esc(val || I18N.t("split.payout.notSet", "not set"))}</span>`;
    if (canEdit) {
      const e = document.createElement("button"); e.type = "button"; e.className = "payout-edit";
      e.setAttribute("aria-label", I18N.t("split.payout.editAria", "Edit payout for {name}", { name: p.name })); e.innerHTML = `<span aria-hidden="true">✎</span>`;
      e.addEventListener("click", () => openBank(p)); pay.appendChild(e);
    }
    mid.appendChild(pay);
  }
  return row;
}

export function renderSettle() {
  const c = compute();
  const peopleEl = $("#people"); peopleEl.innerHTML = "";

  if (bigMode()) {
    // scale: actionable first, collapse the settled
    const owing = [], getting = [], settled = [];
    state.doc.people.forEach((p) => { const n = c.net[p.id]; (n < -0.5 ? owing : n > 0.5 ? getting : settled).push(p); });
    owing.sort((a, b) => c.net[a.id] - c.net[b.id]);
    getting.sort((a, b) => c.net[b.id] - c.net[a.id]);
    owing.concat(getting).forEach((p) => peopleEl.appendChild(personRow(p, c)));
    if (settled.length) {
      const det = document.createElement("details"); det.className = "settled-group";
      const sum = document.createElement("summary"); sum.textContent = I18N.t("split.allSettled", "All settled ({n})", { n: settled.length }); det.appendChild(sum);
      settled.forEach((p) => det.appendChild(personRow(p, c))); peopleEl.appendChild(det);
    }
  } else {
    state.doc.people.forEach((p) => peopleEl.appendChild(personRow(p, c)));
  }

  const adjEl = $("#adjustList"); adjEl.innerHTML = "";
  if (!state.doc.adjustments.length) adjEl.innerHTML = `<li class="empty-hint">${esc(I18N.t("split.adjust.empty", "No manual adjustments."))}</li>`;
  else state.doc.adjustments.forEach((a) => {
    const verb = a.kind === "payment" ? I18N.t("split.adjust.paid", "paid") : "→";
    const li = document.createElement("li"); li.className = "adjust__item" + (a.kind === "payment" ? " is-payment" : "");
    li.innerHTML = `<span><b style="color:${pcol(a.fromId)}">${esc(pname(a.fromId))}</b>
      <span class="verb">${esc(verb)}</span> <b style="color:${pcol(a.toId)}">${esc(pname(a.toId))}</b>
      ${a.label ? `<span class="lbl">${esc(a.label)}</span>` : ""}</span>
      <span class="amt">${money(a.amount)}</span>`;
    if (canEdit) {
      const del = document.createElement("button");
      del.className = "adjust__del"; del.type = "button"; del.setAttribute("aria-label", I18N.t("split.adjust.removeAria", "Remove adjustment"));
      del.innerHTML = `<span aria-hidden="true">✕</span>`;
      del.addEventListener("click", () => deleteAdjustment(a));
      li.appendChild(del);
    }
    adjEl.appendChild(li);
  });

  renderSettlement(c); // #finalTransfers, #settleAdmin, #planStale, #fabLabel (published plan vs live)
  const fn = $("#finalNote");
  if (fn) fn.textContent = c.unassignedCount
    ? (c.unassignedCount > 1
        ? I18N.t("split.finalNote.many", "Note: {n} lines ({amount}) still unassigned — assign them for an exact split.", { n: c.unassignedCount, amount: money(c.unassignedTotal) })
        : I18N.t("split.finalNote.one", "Note: {n} line ({amount}) still unassigned — assign them for an exact split.", { n: c.unassignedCount, amount: money(c.unassignedTotal) }))
    : "";

  const pct = c.totalLines ? Math.round((c.assignedLines / c.totalLines) * 100) : 0;
  $("#progressFill").style.width = pct + "%";
  $("#progressLabel").textContent = I18N.t("split.progress.label", "{done} of {total} lines assigned", { done: c.assignedLines, total: c.totalLines });
}

// ---------- settlement plan (publish / proof / verify) ----------
export const txSig = (t) => [t.from || t.fromId, t.to || t.toId, t.amount];
export const planSig = (list) => JSON.stringify(list.map(txSig).sort());
export function statusBadge(st) {
  const map = {
    pending: ["badge--pending", I18N.t("split.badge.pending", "pending")],
    submitted: ["badge--submitted", I18N.t("split.badge.submitted", "proof uploaded")],
    verified: ["badge--verified", I18N.t("split.badge.verified", "✓ paid")],
  };
  const [cls, label] = map[st] || map.pending;
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
export function renderSettlement(c) {
  const live = settle(c.net);
  const pub = state.doc.settlement && state.doc.settlement.published ? state.doc.settlement : null;
  renderSettleAdmin(pub, live);
  const planStale = $("#planStale");
  if (pub) {
    renderPlanCards($("#finalTransfers"), pub.transfers);
    const liveAsPlan = live.map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount }));
    if (planStale) planStale.hidden = (planSig(live) === planSig(pub.transfers));
    const pend = pub.transfers.filter((t) => t.status !== "verified").length;
    $("#fabLabel").textContent = pend ? I18N.t("split.fab.toPay", "Settle up · {n} to pay", { n: pend }) : I18N.t("split.fab.allSettled", "All settled ✓");
    void liveAsPlan;
  } else {
    fillTransfers($("#finalTransfers"), live, true);
    if (planStale) planStale.hidden = true;
    $("#fabLabel").textContent = live.length ? (live.length > 1 ? I18N.t("split.fab.paymentsMany", "Settle up · {n} payments", { n: live.length }) : I18N.t("split.fab.paymentsOne", "Settle up · {n} payment", { n: live.length })) : I18N.t("split.fab.allSquare", "All square");
  }
}
export function renderSettleAdmin(pub, live) {
  const el = $("#settleAdmin"); if (!el) return; el.innerHTML = "";
  if (!state.admin) return;
  if (!pub) {
    if (!live.length) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "solid-btn"; b.textContent = I18N.t("split.settle.publish", "Publish settlement plan");
    b.addEventListener("click", publishSettlement); el.appendChild(b);
  } else {
    const rg = document.createElement("button"); rg.type = "button"; rg.className = "ghost-btn ghost-btn--sm"; rg.textContent = I18N.t("split.settle.regenerate", "Re-generate from balances");
    rg.addEventListener("click", regenerateSettlement); el.appendChild(rg);
    const un = document.createElement("button"); un.type = "button"; un.className = "ghost-btn ghost-btn--sm"; un.textContent = I18N.t("split.settle.unpublish", "Unpublish");
    un.addEventListener("click", unpublishSettlement); el.appendChild(un);
  }
}
export function renderPlanCards(el, transfers) {
  el.innerHTML = "";
  if (!transfers.length) { el.innerHTML = `<li class="ftransfer empty">${esc(I18N.t("split.allSquare", "All square"))} 🎉</li>`; return; }
  transfers.forEach((t) => {
    const payee = state.personById[t.toId];
    const bank = payee && payee.bankAccount ? payee.bankAccount : "";
    const li = document.createElement("li"); li.className = "plan-card status-" + (t.status || "pending");
    li.setAttribute("aria-label", I18N.t("split.planCard.aria", "{from} pays {to} {amount} — {status}", { from: pname(t.fromId), to: pname(t.toId), amount: money(t.amount), status: t.status || "pending" }));

    const top = document.createElement("div"); top.className = "plan-card__top";
    top.innerHTML = `<span class="plan-who">
        <span class="person__dot" style="--c:${pcol(t.fromId)}" aria-hidden="true"></span>
        <b style="color:${pcol(t.fromId)}">${esc(pname(t.fromId))}</b>
        <span class="ftransfer__verb" aria-hidden="true">${esc(I18N.t("split.pays", "pays"))}</span>
        <b style="color:${pcol(t.toId)}">${esc(pname(t.toId))}</b></span>
      <span class="plan-amt">${money(t.amount)}</span>`;
    li.appendChild(top);

    const bankRow = document.createElement("div"); bankRow.className = "plan-bank";
    if (bank) {
      bankRow.innerHTML = `<span class="plan-bank__label">${esc(I18N.t("split.planCard.payTo", "pay to"))}</span><span class="plan-bank__val">${esc(bank)}</span>`;
      const cp = document.createElement("button"); cp.type = "button"; cp.className = "copy-btn"; cp.setAttribute("aria-label", I18N.t("split.planCard.copyAria", "Copy payout details")); cp.innerHTML = `<span aria-hidden="true">📋</span>`;
      cp.addEventListener("click", () => copyText(bank, cp)); bankRow.appendChild(cp);
    } else {
      bankRow.innerHTML = `<span class="plan-bank__label">${esc(I18N.t("split.planCard.payTo", "pay to"))}</span><span class="plan-bank__val muted">${esc(I18N.t("split.planCard.noPayout", "{name} hasn’t added payout details", { name: pname(t.toId) }))}</span>`;
      if (payee && canEdit) { const add = document.createElement("button"); add.type = "button"; add.className = "link-btn"; add.textContent = I18N.t("split.planCard.add", "add"); add.addEventListener("click", () => openBank(payee)); bankRow.appendChild(add); }
    }
    li.appendChild(bankRow);

    const foot = document.createElement("div"); foot.className = "plan-card__foot";
    foot.innerHTML = statusBadge(t.status);
    const acts = document.createElement("span"); acts.className = "plan-actions";
    const up = document.createElement("button"); up.type = "button"; up.className = "mini-btn"; up.textContent = t.proofRef ? I18N.t("split.proof.replace", "Replace proof") : I18N.t("split.proof.upload", "Upload proof");
    up.addEventListener("click", () => uploadProof(t.id)); acts.appendChild(up);
    if (t.proofRef) { const vw = document.createElement("button"); vw.type = "button"; vw.className = "mini-btn"; vw.textContent = I18N.t("split.proof.view", "View proof"); vw.addEventListener("click", () => openProof(t.id)); acts.appendChild(vw); }
    if (state.admin) {
      if (t.status === "verified") { const un = document.createElement("button"); un.type = "button"; un.className = "mini-btn"; un.textContent = I18N.t("split.proof.unverify", "Unverify"); un.addEventListener("click", () => setVerify(t.id, false)); acts.appendChild(un); }
      else { const vf = document.createElement("button"); vf.type = "button"; vf.className = "mini-btn verify-btn"; vf.textContent = I18N.t("split.proof.verify", "Verify"); vf.addEventListener("click", () => setVerify(t.id, true)); acts.appendChild(vf); }
    }
    foot.appendChild(acts); li.appendChild(foot);
    el.appendChild(li);
  });
}

export function render() {
  if (!state.doc) return;
  $("#tripName").textContent = state.doc.trip.name || I18N.t("split.appTitle", "Split the Bill");
  if ($("#planLink") && state.tripId) $("#planLink").href = "/trip/?t=" + encodeURIComponent(state.tripId);
  document.title = (state.doc.trip.name ? state.doc.trip.name + " · " : "") + I18N.t("split.appTitle", "Split the Bill");
  document.body.classList.toggle("is-admin", state.admin);
  renderPeopleBar();
  renderShared();
  renderReceipts();
  renderSettle();
}
