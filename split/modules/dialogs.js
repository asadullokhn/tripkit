import { state, saveQueue, PALETTE } from "./state.js";
import { $, api, toast, pushDoc, clone, esc, pname, pcol, initials, money, genColor, lock, bigMode } from "./core.js";
import { render, compute } from "./render.js";

// ---------- mutations: receipts / expenses (debounced + rollback) ----------
// scheduleSave debounces per entity and keeps the earliest pre-edit snapshot for rollback.
export function scheduleSave(key, snap, fire) {
  if (!saveQueue[key]) saveQueue[key] = { snap };
  clearTimeout(saveQueue[key].timer);
  saveQueue[key].timer = setTimeout(() => {
    const s = saveQueue[key].snap; delete saveQueue[key];
    fire(s);
  }, 250);
}
export function replaceReceipt(snap) { const i = state.doc.receipts.findIndex((r) => r.id === snap.id); if (i >= 0) state.doc.receipts[i] = snap; }
export function replaceExpense(snap) { const i = state.doc.expenses.findIndex((e) => e.id === snap.id); if (i >= 0) state.doc.expenses[i] = snap; }

export function saveReceiptDebounced(rc, snap) {
  scheduleSave("receipt:" + rc.id, snap, (s) =>
    pushDoc(api(`/trips/${state.tripId}/receipts/${rc.id}`, { method: "PUT", body: rc }), { rollback: () => replaceReceipt(s) }));
}
export function saveExpenseDebounced(e, snap) {
  scheduleSave("expense:" + e.id, snap, (s) =>
    pushDoc(api(`/trips/${state.tripId}/expenses/${e.id}`, { method: "PUT", body: e }), { rollback: () => replaceExpense(s) }));
}
export function snapFor(key, obj) { return saveQueue[key] ? null : clone(obj); } // earliest-in-burst snapshot

export function toggleItemSharer(rc, it, pid) {
  const snap = snapFor("receipt:" + rc.id, rc);
  const set = new Set(it.sharedBy || []);
  set.has(pid) ? set.delete(pid) : set.add(pid);
  it.sharedBy = state.doc.people.map((p) => p.id).filter((id) => set.has(id));
  render(); saveReceiptDebounced(rc, snap);
}
export function setItemSharers(rc, it, ids) {
  const snap = snapFor("receipt:" + rc.id, rc);
  it.sharedBy = ids.slice(); render(); saveReceiptDebounced(rc, snap);
}
export function toggleExpenseMember(e, pid) {
  const snap = snapFor("expense:" + e.id, e);
  e.shares = e.shares || {};
  if (e.shares[pid] !== undefined) delete e.shares[pid]; else e.shares[pid] = 1;
  render(); saveExpenseDebounced(e, snap);
}
export function setExpenseMembers(e, ids) {
  const snap = snapFor("expense:" + e.id, e);
  const s = {}; ids.forEach((id) => s[id] = 1); e.shares = s; render(); saveExpenseDebounced(e, snap);
}
export function deleteAdjustment(a) {
  const snap = clone(a);
  state.doc.adjustments = state.doc.adjustments.filter((x) => x.id !== a.id); render();
  pushDoc(api(`/trips/${state.tripId}/adjustments/${a.id}`, { method: "DELETE" }), {
    okMsg: undefined,
    rollback: () => { state.doc.adjustments.push(snap); },
  }).then(() => {
    toast(I18N.t("split.toast.adjustRemoved", "Adjustment removed"), { type: "ok", action: () => readjust(snap), actionLabel: I18N.t("common.undo", "Undo") });
  }).catch(() => {});
}
export function readjust(a) {
  pushDoc(api(`/trips/${state.tripId}/adjustments`, { method: "POST", body: { kind: a.kind, fromId: a.fromId, toId: a.toId, amount: a.amount, label: a.label } }), { okMsg: I18N.t("split.toast.restored", "Restored") });
}

// ---------- generic dialog helpers (focus model, validation) ----------
let lastFocus = null;
export function openDialog(dlg, focusSel) {
  lastFocus = document.activeElement;
  dlg.returnValue = "";
  dlg.showModal();
  setTimeout(() => { const f = focusSel && dlg.querySelector(focusSel); if (f) f.focus(); }, 30);
}
export function closeDialog(dlg) {
  dlg.close();
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) {} }
  lastFocus = null;
}
export function clearErr(dlg) { dlg.querySelectorAll(".field__err").forEach((e) => { e.textContent = ""; e.hidden = true; }); }
export function showErr(el, msg, focusEl) {
  if (el) { el.textContent = msg; el.hidden = false; }
  if (focusEl) focusEl.focus();
}
export function busy(btn, on) {
  if (!btn) return;
  btn.disabled = on; btn.setAttribute("aria-busy", on ? "true" : "false");
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = I18N.t("common.saving", "Saving…"); }
  else if (btn.dataset.label) { btn.textContent = btn.dataset.label; delete btn.dataset.label; }
}
// submit helper: validate() -> if string returned, show error; else run save() (returns promise) and close on success.
export function wireForm(form, dlg, validate, save, primaryBtn) {
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
export function confirmAsk({ title, body, okLabel, danger = false }) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    $("#confirmTitle").textContent = title || I18N.t("split.confirm.title", "Are you sure?");
    okLabel = okLabel || I18N.t("common.confirm", "Confirm");
    $("#confirmBody").innerHTML = body || "";
    const ok = $("#confirmOk"); ok.textContent = okLabel; ok.classList.toggle("danger-solid", danger);
    openDialog(confirmDialog, danger ? "#confirmCancel" : "#confirmOk");
  });
}
export function resolveConfirm(v) { if (confirmResolve) { confirmResolve(v); confirmResolve = null; } closeDialog(confirmDialog); }
$("#confirmOk").addEventListener("click", () => resolveConfirm(true));
$("#confirmCancel").addEventListener("click", () => resolveConfirm(false));
confirmDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); resolveConfirm(false); });

// ---------- reusable person picker (searchable) ----------
const pickerDialog = $("#pickerDialog");
let pickerSel = new Set(), pickerOnSave = null;
function renderPickerList(filter) {
  const list = $("#pickerList"); list.innerHTML = "";
  const f = (filter || "").trim().toLowerCase();
  const ppl = state.doc.people.filter((p) => !f || p.name.toLowerCase().includes(f));
  ppl.sort((a, b) => { const sa = pickerSel.has(a.id), sb = pickerSel.has(b.id); if (sa !== sb) return sa ? -1 : 1; return a.name.localeCompare(b.name); });
  if (!ppl.length) { list.innerHTML = `<p class="empty-hint">${esc(I18N.t("split.picker.noMatches", "No matches."))}</p>`; }
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
function updatePickerCount() { $("#pickerCount").textContent = I18N.t("split.picker.selected", "{n} selected", { n: pickerSel.size }); }
export function openPicker({ title, selected, onSave }) {
  pickerSel = new Set(selected || []); pickerOnSave = onSave;
  $("#pickerTitle").textContent = title || I18N.t("split.picker.title", "Who shared this?");
  $("#pickerSearch").value = "";
  renderPickerList(""); updatePickerCount();
  openDialog(pickerDialog, "#pickerSearch");
}
$("#pickerSearch").addEventListener("input", (e) => renderPickerList(e.target.value));
$("#pickerAll").addEventListener("click", () => { state.doc.people.forEach((p) => pickerSel.add(p.id)); renderPickerList($("#pickerSearch").value); updatePickerCount(); });
$("#pickerNone").addEventListener("click", () => { pickerSel.clear(); renderPickerList($("#pickerSearch").value); updatePickerCount(); });
$("#pickerCancel").addEventListener("click", () => closeDialog(pickerDialog));
$("#pickerSave").addEventListener("click", () => {
  const ids = state.doc.people.map((p) => p.id).filter((id) => pickerSel.has(id));
  closeDialog(pickerDialog); if (pickerOnSave) pickerOnSave(ids);
});
pickerDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(pickerDialog); });

// ---------- person dialog ----------
const personDialog = $("#personDialog");
let pnEditing = null, pnColor = PALETTE[0];
export function buildSwatches() {
  const w = $("#pnSwatches"); w.innerHTML = "";
  PALETTE.forEach((c, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "swatch"; b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false"); b.setAttribute("aria-label", I18N.t("split.person.colourN", "Colour {n}", { n: i + 1 }));
    b.style.background = c; b.dataset.c = c;
    b.addEventListener("click", () => selectSwatch(c));
    w.appendChild(b);
  });
}
function selectSwatch(c) { pnColor = c; $("#pnSwatches").querySelectorAll(".swatch").forEach((s) => { const on = s.dataset.c === c; s.classList.toggle("is-on", on); s.setAttribute("aria-checked", on ? "true" : "false"); }); }
export function openPerson(p) {
  pnEditing = p ? p.id : null;
  $("#pnTitle").textContent = p ? I18N.t("split.person.editTitle", "Edit person") : I18N.t("split.person.addTitle", "Add person");
  $("#pnName").value = p ? p.name : "";
  selectSwatch(p && p.color ? p.color : genColor(state.doc.people.length));
  $("#pnDelete").hidden = !p;
  clearErr(personDialog);
  openDialog(personDialog, "#pnName");
}
$("#addPersonBtn").addEventListener("click", () => openPerson(null));
$("#pnCancel").addEventListener("click", () => closeDialog(personDialog));
wireForm($("#personForm"), personDialog,
  () => { const name = $("#pnName").value.trim(); if (!name) return { el: "pnErr", msg: I18N.t("split.err.nameRequired", "Name is required"), focus: "pnName" }; return null; },
  () => {
    const body = { name: $("#pnName").value.trim(), color: pnColor };
    return pnEditing
      ? pushDoc(api(`/trips/${state.tripId}/people/${pnEditing}`, { method: "PUT", body }), { okMsg: I18N.t("common.saved", "Saved") })
      : pushDoc(api(`/trips/${state.tripId}/people`, { method: "POST", body }), { okMsg: I18N.t("split.toast.personAdded", "Person added") });
  }, "#pnSave");
$("#pnDelete").addEventListener("click", async () => {
  if (!pnEditing) return;
  const c = compute();
  const onItems = (state.doc.receipts || []).reduce((n, rc) => n + (rc.items || []).filter((it) => (it.sharedBy || []).includes(pnEditing)).length, 0);
  const itemsNote = onItems ? (onItems > 1 ? I18N.t("split.confirm.deletePersonItemsMany", " ({n} items)", { n: onItems }) : I18N.t("split.confirm.deletePersonItemsOne", " ({n} item)", { n: onItems })) : "";
  const pid = pnEditing;
  closeDialog(personDialog);   // avoid modal-on-modal: close the editor before confirming
  const ok = await confirmAsk({ title: I18N.t("split.confirm.deletePersonTitle", "Delete this person?"), danger: true, okLabel: I18N.t("common.delete", "Delete"),
    body: I18N.t("split.confirm.deletePersonBody", "<b>{name}</b> will be removed from all splits{items}. Their share is redistributed to the others.", { name: esc(pname(pid)), items: itemsNote }) });
  if (!ok) return;
  pushDoc(api(`/trips/${state.tripId}/people/${pid}`, { method: "DELETE" }), { okMsg: I18N.t("split.toast.personRemoved", "Person removed") });
});

// ---------- receipt dialog (manual + OCR draft) ----------
const receiptDialog = $("#receiptDialog");
let rcEditing = null, rcItems = [];
function payerOptions(sel, selected) {
  sel.innerHTML = "";
  const none = document.createElement("option"); none.value = ""; none.textContent = I18N.t("split.receipt.nobody", "— nobody —"); sel.appendChild(none);
  state.doc.people.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; if (p.id === selected) o.selected = true; sel.appendChild(o); });
}
function addRcItem(focus) {
  rcItems.push({ name: "", quantity: 1, unitPrice: 0, lineTotal: 0, sharedBy: [] });
  appendRcRow(rcItems[rcItems.length - 1], rcItems.length - 1, focus);
}
function appendRcRow(it, idx, focus) {
  const w = $("#rcItems");
  const row = document.createElement("div"); row.className = "rc-item";
  row.innerHTML = `
    <input class="ri-name" aria-label="${esc(I18N.t("split.rcItem.nameAria", "Item name"))}" placeholder="${esc(I18N.t("split.rcItem.namePh", "Item"))}" value="${esc(it.name || "")}" />
    <input class="ri-qty" type="number" min="1" step="1" inputmode="numeric" aria-label="${esc(I18N.t("split.rcItem.qtyAria", "Quantity"))}" value="${it.quantity || 1}" />
    <input class="ri-total" type="number" min="0" step="1" inputmode="numeric" aria-label="${esc(I18N.t("split.rcItem.totalAria", "Line total"))}" value="${it.lineTotal || 0}" />
    <button type="button" class="ri-del" aria-label="${esc(I18N.t("split.rcItem.removeAria", "Remove item"))}"><span aria-hidden="true">✕</span></button>`;
  row.querySelector(".ri-name").addEventListener("input", (e) => it.name = e.target.value);
  row.querySelector(".ri-qty").addEventListener("input", (e) => it.quantity = parseInt(e.target.value, 10) || 1);
  row.querySelector(".ri-total").addEventListener("input", (e) => it.lineTotal = parseInt(e.target.value, 10) || 0);
  row.querySelector(".ri-del").addEventListener("click", () => { const i = rcItems.indexOf(it); if (i >= 0) rcItems.splice(i, 1); row.remove(); });
  w.appendChild(row);
  if (focus) row.querySelector(".ri-name").focus();
}
function renderRcItems() { const w = $("#rcItems"); w.innerHTML = ""; rcItems.forEach((it, i) => appendRcRow(it, i)); }
export function openReceipt(rc, draftWarnings) {
  rcEditing = rc && rc.id ? rc.id : null;
  $("#rcTitle").textContent = rcEditing ? I18N.t("split.receipt.editTitle", "Edit receipt") : (rc ? I18N.t("split.receipt.confirmTitle", "Confirm scanned receipt") : I18N.t("split.receipt.addTitle", "Add receipt"));
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
  () => { if (!$("#rcName").value.trim()) return { el: "rcErr", msg: I18N.t("split.err.titleRequired", "Title is required"), focus: "rcName" };
          if (!rcItems.some((it) => (it.name || "").trim() || it.lineTotal)) return { el: "rcErr", msg: I18N.t("split.err.addOneItem", "Add at least one item") }; return null; },
  () => {
    const items = rcItems.filter((it) => (it.name || "").trim() || it.lineTotal)
      .map((it) => ({ id: it.id, name: (it.name || "").trim() || "Item", quantity: it.quantity || 1, unitPrice: it.unitPrice || (it.quantity ? Math.round(it.lineTotal / it.quantity) : it.lineTotal), lineTotal: it.lineTotal || 0, sharedBy: it.sharedBy || [] }));
    const body = { title: $("#rcName").value.trim() || "Receipt", date: $("#rcDate").value || "", payerId: $("#rcPayer").value, items, grandTotal: parseInt($("#rcGrand").value, 10) || 0 };
    return rcEditing
      ? pushDoc(api(`/trips/${state.tripId}/receipts/${rcEditing}`, { method: "PUT", body }), { okMsg: I18N.t("common.saved", "Saved") })
      : pushDoc(api(`/trips/${state.tripId}/receipts`, { method: "POST", body }), { okMsg: I18N.t("split.toast.receiptAdded", "Receipt added") });
  }, "#rcSave");
$("#rcDelete").addEventListener("click", async () => {
  if (!rcEditing) return;
  const rid = rcEditing;
  closeDialog(receiptDialog);   // avoid modal-on-modal: close the editor before confirming
  const ok = await confirmAsk({ title: I18N.t("split.confirm.deleteReceiptTitle", "Delete this receipt?"), danger: true, okLabel: I18N.t("common.delete", "Delete"), body: I18N.t("split.confirm.deleteReceiptBody", "This removes the receipt and its items from the split.") });
  if (!ok) return;
  pushDoc(api(`/trips/${state.tripId}/receipts/${rid}`, { method: "DELETE" }), { okMsg: I18N.t("split.toast.receiptDeleted", "Receipt deleted") });
});

// ---------- expense dialog ----------
const expenseDialog = $("#expenseDialog");
let exEditing = null, exMode = "EVENLY", exShares = {};
function applyMode(m, reseed) {
  exMode = m;
  document.querySelectorAll("#exSplitMode .seg__btn").forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false"); });
  if (reseed) {
    const ids = Object.keys(exShares).filter((id) => state.personById[id]);
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
  const ids = Object.keys(exShares).filter((id) => state.personById[id]);
  const amt = parseInt($("#exAmount").value, 10) || 0;
  if (!ids.length) { el.className = "ex-summary warn-text"; el.textContent = I18N.t("split.ex.pickOne", "Pick at least one person."); return; }
  if (exMode === "EVENLY") { el.className = "ex-summary"; el.textContent = I18N.t("split.ex.evenlySummary", "{amount} each · {n} {who}", { amount: money(amt / ids.length), n: ids.length, who: ids.length === 1 ? I18N.t("split.person", "person") : I18N.t("split.people.word", "people") }); return; }
  if (exMode === "BY_SHARES") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); el.className = "ex-summary" + (t > 0 ? "" : " warn-text"); el.textContent = t > 0 ? I18N.t("split.ex.sharesTotal", "{n} shares total", { n: t }) : I18N.t("split.ex.sharesPositive", "Shares must be > 0"); return; }
  if (exMode === "BY_PERCENTAGE") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); const ok = Math.abs(t - 100) < 0.5; el.className = "ex-summary" + (ok ? " ok-text" : " warn-text"); el.textContent = ok ? I18N.t("split.ex.pctOk", "Σ 100% ✓") : I18N.t("split.ex.pctOff", "Σ {t}% — {detail}", { t, detail: t < 100 ? I18N.t("split.ex.pctUnder", "{x}% unallocated", { x: 100 - t }) : I18N.t("split.ex.pctOver", "{x}% over", { x: t - 100 }) }); return; }
  if (exMode === "BY_AMOUNT") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); const ok = t === amt; el.className = "ex-summary" + (ok ? " ok-text" : " warn-text"); el.textContent = I18N.t("split.ex.amtSummary", "Σ {sum} of {total}", { sum: money(t), total: money(amt) }) + (ok ? " ✓" : ""); return; }
}
function distributeEvenly() {
  const ids = Object.keys(exShares).filter((id) => state.personById[id]); if (!ids.length) return;
  const amt = parseInt($("#exAmount").value, 10) || 0; const n = ids.length;
  if (exMode === "BY_PERCENTAGE") { const base = Math.floor(100 / n); ids.forEach((id) => exShares[id] = base); exShares[ids[0]] += 100 - base * n; }
  else if (exMode === "BY_AMOUNT") { const base = Math.floor(amt / n); ids.forEach((id) => exShares[id] = base); exShares[ids[0]] += amt - base * n; }
  else ids.forEach((id) => exShares[id] = 1);
  renderExParts();
}
function renderExParts() {
  const w = $("#exParts"); w.innerHTML = "";
  $("#exPartLabel").textContent = exMode === "EVENLY" ? I18N.t("split.expense.sharedBy", "Shared by") : exMode === "BY_PERCENTAGE" ? I18N.t("split.ex.percentEach", "Percent each") : exMode === "BY_AMOUNT" ? I18N.t("split.ex.amountEach", "Amount each") : I18N.t("split.ex.sharesEach", "Shares each");
  w.classList.toggle("ex-parts--col", exMode !== "EVENLY" || bigMode());
  state.doc.people.forEach((p) => {
    const on = exShares[p.id] !== undefined;
    const row = document.createElement("div"); row.className = "ex-part" + (on ? " is-on" : "");
    const chip = document.createElement("button"); chip.type = "button"; chip.className = "chip"; chip.style.setProperty("--c", state.personColor[p.id]);
    chip.setAttribute("aria-pressed", on ? "true" : "false"); chip.setAttribute("aria-label", (on ? I18N.t("split.chip.sharing", "Sharing: ") : I18N.t("split.chip.notSharing", "Not sharing: ")) + p.name); chip.textContent = p.name;
    chip.addEventListener("click", () => { if (exShares[p.id] !== undefined) delete exShares[p.id]; else exShares[p.id] = exMode === "EVENLY" ? 1 : (exMode === "BY_PERCENTAGE" ? 0 : 0); renderExParts(); });
    row.appendChild(chip);
    if (on && exMode !== "EVENLY") {
      const inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.step = "1"; inp.inputMode = "numeric"; inp.className = "ex-share";
      inp.setAttribute("aria-label", p.name + " " + (exMode === "BY_PERCENTAGE" ? I18N.t("split.ex.percentWord", "percent") : exMode === "BY_AMOUNT" ? I18N.t("split.ex.amountWord", "amount") : I18N.t("split.ex.sharesWord", "shares"))); inp.value = exShares[p.id] || 0;
      inp.addEventListener("input", (e) => { exShares[p.id] = parseFloat(e.target.value) || 0; exSummary(); });
      row.appendChild(inp);
    }
    w.appendChild(row);
  });
  exSummary();
}
export function openExpense(e, prefill) {
  exEditing = e ? e.id : null;
  $("#exTitle").textContent = e ? I18N.t("split.expense.editTitle", "Edit shared cost") : I18N.t("split.expense.addTitle", "Add shared cost");
  $("#exName").value = e ? e.title : (prefill && prefill.title || "");
  $("#exAmount").value = e ? e.amount : (prefill && prefill.amount || "");
  payerOptions($("#exPayer"), e ? e.payerId : "");
  exShares = e && e.shares ? Object.assign({}, e.shares) : {};
  if (!e) state.doc.people.forEach((p) => exShares[p.id] = 1); // default: everyone
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
    if (!$("#exName").value.trim()) return { el: "exErr", msg: I18N.t("split.err.titleRequired", "Title is required"), focus: "exName" };
    const amt = parseInt($("#exAmount").value, 10) || 0; if (amt <= 0) return { el: "exErr", msg: I18N.t("split.err.amountPositive", "Amount must be more than 0"), focus: "exAmount" };
    const ids = Object.keys(exShares).filter((id) => state.personById[id]); if (!ids.length) return { el: "exErr", msg: I18N.t("split.err.pickOne", "Pick at least one person") };
    if (exMode === "BY_PERCENTAGE") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); if (Math.abs(t - 100) >= 0.5) return { el: "exErr", msg: I18N.t("split.err.pctTotal", "Percentages must total 100% (now {t}%)", { t }) }; }
    if (exMode === "BY_AMOUNT") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); if (t !== amt) return { el: "exErr", msg: I18N.t("split.err.amtTotal", "Amounts must total {total} (now {sum})", { total: money(amt), sum: money(t) }) }; }
    if (exMode === "BY_SHARES") { const t = ids.reduce((s, id) => s + (exShares[id] || 0), 0); if (t <= 0) return { el: "exErr", msg: I18N.t("split.err.sharesPositive", "Shares must be greater than 0") }; }
    return null;
  },
  () => {
    const shares = {}; Object.keys(exShares).forEach((id) => { if (state.personById[id]) shares[id] = exMode === "EVENLY" ? 1 : (exShares[id] || 0); });
    const body = { title: $("#exName").value.trim() || "Shared cost", amount: parseInt($("#exAmount").value, 10) || 0, payerId: $("#exPayer").value, splitMode: exMode, shares };
    return exEditing
      ? pushDoc(api(`/trips/${state.tripId}/expenses/${exEditing}`, { method: "PUT", body }), { okMsg: I18N.t("common.saved", "Saved") })
      : pushDoc(api(`/trips/${state.tripId}/expenses`, { method: "POST", body }), { okMsg: I18N.t("split.toast.costAdded", "Cost added") });
  }, "#exSave");
$("#exDelete").addEventListener("click", async () => {
  if (!exEditing) return;
  const eid = exEditing;
  closeDialog(expenseDialog);   // avoid modal-on-modal: close the editor before confirming
  const ok = await confirmAsk({ title: I18N.t("split.confirm.deleteCostTitle", "Delete this shared cost?"), danger: true, okLabel: I18N.t("common.delete", "Delete"), body: I18N.t("split.confirm.deleteCostBody", "This removes the cost from the split.") });
  if (!ok) return;
  pushDoc(api(`/trips/${state.tripId}/expenses/${eid}`, { method: "DELETE" }), { okMsg: I18N.t("split.toast.costDeleted", "Cost deleted") });
});

// ---------- adjustment dialog ----------
const adjustDialog = $("#adjustDialog");
let adjKind = "debt";
function fillPeopleSelect(sel, idx) {
  sel.innerHTML = "";
  state.doc.people.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
  if (idx != null && sel.options[idx]) sel.selectedIndex = idx;
}
function setAdjKind(k) { adjKind = k; document.querySelectorAll("#adjKind .seg__btn").forEach((b) => { const on = b.dataset.kind === k; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", on ? "true" : "false"); }); $("#adjFromLabel").textContent = k === "payment" ? I18N.t("split.adjust.whoPaid", "Who paid") : I18N.t("split.adjust.whoOwes", "Who owes"); }
document.querySelectorAll("#adjKind .seg__btn").forEach((b) => b.addEventListener("click", () => setAdjKind(b.dataset.kind)));
$("#addAdjustBtn").addEventListener("click", () => {
  if (state.doc.people.length < 2) { toast(I18N.t("split.toast.needTwoPeople", "Add at least two people first"), { type: "err" }); return; }
  fillPeopleSelect($("#adjFrom"), 0); fillPeopleSelect($("#adjTo"), Math.min(1, state.doc.people.length - 1));
  $("#adjAmount").value = ""; $("#adjLabel").value = ""; setAdjKind("debt");
  clearErr(adjustDialog);
  openDialog(adjustDialog, "#adjFrom");
});
$("#adjCancel").addEventListener("click", () => closeDialog(adjustDialog));
wireForm($("#adjustForm"), adjustDialog,
  () => {
    const fromId = $("#adjFrom").value, toId = $("#adjTo").value;
    const amount = Math.max(0, parseInt($("#adjAmount").value, 10) || 0);
    if (!fromId || !toId) return { el: "adjErr", msg: I18N.t("split.err.pickBoth", "Pick both people") };
    if (fromId === toId) return { el: "adjErr", msg: I18N.t("split.err.pickDifferent", "Pick two different people") };
    if (amount <= 0) return { el: "adjErr", msg: I18N.t("split.err.amountPositive", "Amount must be more than 0"), focus: "adjAmount" };
    return null;
  },
  () => {
    const body = { kind: adjKind, fromId: $("#adjFrom").value, toId: $("#adjTo").value, amount: Math.max(0, parseInt($("#adjAmount").value, 10) || 0), label: $("#adjLabel").value.trim() };
    return pushDoc(api(`/trips/${state.tripId}/adjustments`, { method: "POST", body }), { okMsg: I18N.t("split.toast.adjustAdded", "Adjustment added") });
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
    if (err.code === 503) toast(I18N.t("split.ocr.notSetUp", "Photo scanning isn't set up on the server yet."), { type: "err" });
    else if (err.code === 422) toast(I18N.t("split.ocr.cantRead", "Couldn't read a receipt — try a clearer photo or add it manually."), { type: "err" });
    else if (err.code === 429) toast(I18N.t("split.ocr.tooMany", "Too many uploads — try again in a bit."), { type: "err" });
    else if (err.code === 401) { toast(I18N.t("split.ocr.needPasscode", "Enter the passcode to upload."), { type: "err" }); lock(); }
    else toast(I18N.t("split.ocr.scanFailed", "Scan failed: {error}", { error: (err.body && err.body.error ? err.body.error : err.message) }), { type: "err" });
  }
});
