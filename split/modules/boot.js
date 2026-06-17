import { state, PASS_KEY } from "./state.js";
import { $, api, toast, esc, pname, money, fmtWhen, dateSortKey, sumItems, lock, setSync, adoptDoc, cacheLoad, flushPending, refreshTrip, setRender } from "./core.js";
import { render, compute, settle } from "./render.js";
import { showErr, clearErr, openDialog, closeDialog, busy, buildSwatches } from "./dialogs.js";

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
    state.admin = true; applyAdminUI(); toast(I18N.t("split.toast.loggedIn", "Logged in"), { type: "ok" });
    await refreshTrip();
  } catch (err) {
    showErr($("#loginErr"), err.code === 429 ? I18N.t("split.err.tooManyAttempts", "Too many attempts — wait a bit.") : I18N.t("split.err.wrongPassword", "Wrong password"));
    const card = loginDialog.querySelector(".dialog__form"); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
    $("#loginPassword").select();
  } finally { busy(btn, false); }
});
loginDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(loginDialog); });
$("#logoutBtn").addEventListener("click", async () => {
  try { await api("/logout", { method: "POST" }); } catch (_) {}
  state.admin = false; applyAdminUI(); render(); toast(I18N.t("split.toast.loggedOut", "Logged out"), { type: "ok" });
});

function applyAdminUI() {
  document.body.classList.toggle("is-admin", state.admin);
  document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !state.admin; });
  $("#loginBtn").hidden = state.admin || !state.loginEnabled;
  $("#logoutBtn").hidden = !state.admin;
  // OCR upload is editor-tier (any passcode user) — show only when configured server-side.
  if ($("#ocrBtn")) $("#ocrBtn").hidden = !state.ocrEnabled;
  if ($("#ocrPrivacy")) $("#ocrPrivacy").hidden = !state.ocrEnabled;
}

// ---------- export PDF ----------
function allOrExcept(ids) {
  const all = state.doc.people.map((p) => p.id);
  const set = new Set(ids);
  if (ids.length === all.length && all.every((id) => set.has(id))) return I18N.t("split.report.everyone", "Everyone");
  const missing = all.filter((id) => !set.has(id));
  if (ids.length && missing.length && missing.length <= 2) return I18N.t("split.report.everyoneExcept", "Everyone except {names}", { names: missing.map(pname).join(", ") });
  return ids.map(pname).join(", ");
}
function buildReport() {
  const c = compute(); const transfers = settle(c.net);
  const stamp = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const settleRows = transfers.length
    ? transfers.map((t) => `<tr><td>${esc(pname(t.from))}</td><td class="arrow">${esc(I18N.t("split.pays", "pays"))}</td><td>${esc(pname(t.to))}</td><td class="num">${money(t.amount)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="center">${esc(I18N.t("split.report.allSquare", "All square — nothing to transfer."))}</td></tr>`;
  const personRows = state.doc.people.map((p) => {
    const n = c.net[p.id]; const verdict = n > 0.5 ? I18N.t("split.report.getsBack", "gets back {amount}", { amount: money(n) }) : n < -0.5 ? I18N.t("split.report.pays", "pays {amount}", { amount: money(-n) }) : I18N.t("split.net.settled", "settled");
    return `<tr><td>${esc(p.name)}</td><td class="num">${money(c.consumed[p.id])}</td><td class="num">${money(c.paid[p.id])}</td><td class="num ${n < -0.5 ? "neg" : n > 0.5 ? "pos" : ""}">${money(n)}</td><td>${esc(verdict)}</td></tr>`;
  }).join("");
  const expHtml = state.doc.expenses.map((e) => {
    const keys = Object.keys(e.shares || {}).filter((id) => state.personById[id]);
    return `<tr><td>${esc(e.title)}</td><td class="num">${money(e.amount)}</td><td>${esc(I18N.t("split.paidBy", "paid by"))} ${esc(pname(e.payerId))}</td><td>${esc(allOrExcept(keys) || "—")}</td></tr>`;
  }).join("");
  const rcHtml = state.doc.receipts.slice().sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b))).map((rc) => {
    const grand = rc.grandTotal || sumItems(rc.items); const ratio = grand / (sumItems(rc.items) || 1);
    const rows = (rc.items || []).map((it) => {
      const sh = (it.sharedBy || []).filter((id) => state.personById[id]);
      const per = sh.length ? ((it.lineTotal || 0) * ratio) / sh.length : 0;
      return `<tr><td>${esc(it.name)}${it.quantity > 1 ? " ×" + it.quantity : ""}</td><td class="num">${money(it.lineTotal || 0)}</td><td>${esc(sh.length ? allOrExcept(sh) : I18N.t("split.report.unassigned", "— unassigned —"))}</td><td class="num">${sh.length ? esc(I18N.t("split.report.ea", "{amount} ea", { amount: money(per) })) : ""}</td></tr>`;
    }).join("");
    return `<div class="rep-group"><div class="rep-group__head"><b>${esc(rc.title)}</b><span>${esc([fmtWhen(rc.date, rc.time), I18N.t("split.report.paidByName", "paid by {name}", { name: pname(rc.payerId) }), money(grand)].filter(Boolean).join(" · "))}</span></div><table class="rep-table"><tbody>${rows}</tbody></table></div>`;
  }).join("");
  const adjHtml = state.doc.adjustments.length
    ? `<table class="rep-table"><tbody>${state.doc.adjustments.map((a) => `<tr><td>${esc(I18N.t(a.kind === "payment" ? "split.report.adjPaid" : "split.report.adjOwes", a.kind === "payment" ? "{from} already paid {to}" : "{from} owes {to}", { from: pname(a.fromId), to: pname(a.toId) }))}${a.label ? " (" + esc(a.label) + ")" : ""}</td><td class="num">${money(a.amount)}</td></tr>`).join("")}</tbody></table>`
    : `<p class='muted'>${esc(I18N.t("split.report.none", "None."))}</p>`;
  const unassigned = c.unassignedCount ? `<p class="warn">⚠ ${esc(I18N.t("split.report.unassignedWarn", "{n} line(s) ({amount}) still unassigned — provisional.", { n: c.unassignedCount, amount: money(c.unassignedTotal) }))}</p>` : "";
  $("#report").innerHTML = `
    <div class="rep-head"><h1>${esc(state.doc.trip.name || I18N.t("split.appTitle", "Split the Bill"))}</h1>
      <div class="rep-meta">${esc(I18N.t("split.report.generated", "Generated {stamp} · {done}/{total} lines assigned", { stamp, done: c.assignedLines, total: c.totalLines }))}</div></div>
    ${unassigned}
    <h2>${esc(I18N.t("split.report.whoPaysWhom", "Who pays whom"))}</h2><table class="rep-table rep-settle"><tbody>${settleRows}</tbody></table>
    <h2>${esc(I18N.t("split.report.perPerson", "Per person"))}</h2><table class="rep-table"><thead><tr><th>${esc(I18N.t("split.report.thPerson", "Person"))}</th><th class="num">${esc(I18N.t("split.report.thConsumed", "Consumed"))}</th><th class="num">${esc(I18N.t("split.report.thPaid", "Paid"))}</th><th class="num">${esc(I18N.t("split.report.thNet", "Net"))}</th><th>${esc(I18N.t("split.report.thResult", "Result"))}</th></tr></thead><tbody>${personRows}</tbody></table>
    <h2>${esc(I18N.t("split.report.hAdjustments", "Manual adjustments"))}</h2>${adjHtml}
    <h2>${esc(I18N.t("split.report.hSharedCosts", "Shared costs"))}</h2><table class="rep-table"><tbody>${expHtml || `<tr><td class='muted'>${esc(I18N.t("split.report.none", "None."))}</td></tr>`}</tbody></table>
    <h2>${esc(I18N.t("split.report.hReceipts", "Receipts"))}</h2>${rcHtml || `<p class='muted'>${esc(I18N.t("split.report.none", "None."))}</p>`}`;
}
$("#exportBtn").addEventListener("click", () => { if (!state.doc) return; buildReport(); window.print(); });

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
settleEl.addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; state.sheetDragging = true; }, { passive: true });
settleEl.addEventListener("touchmove", (e) => {
  if (touchY == null || !settleEl.classList.contains("open")) return;
  const inner = settleEl.querySelector(".settle__inner");
  if (e.touches[0].clientY - touchY > 70 && inner && inner.scrollTop <= 0) { closeSheet(); touchY = null; }
}, { passive: true });
settleEl.addEventListener("touchend", () => { touchY = null; state.sheetDragging = false; flushPending(); });

// ---------- passcode gate ----------
function unlock() { $("#lock").hidden = true; }
$("#lockForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#lockInput").value.trim(); if (!v) return; state.pass = v; tryLoad(); });

function pollApply(d) {
  if (!d || d.rev === (state.doc && state.doc.rev)) { setSync("live"); return; }
  if (state.inflight > 0 || document.querySelector("dialog[open]") || state.sheetDragging) { state.pendingDoc = d; setSync("live"); return; }
  const y = window.scrollY; adoptDoc(d); render(); window.scrollTo(0, y); setSync("live");
}

// ---------- boot / polling ----------
let pollTimer = null;
async function tryLoad() {
  if (!state.tripId) return resolveTrip();
  try {
    const d = await api("/trips/" + state.tripId);
    try { localStorage.setItem(PASS_KEY, state.pass); } catch (_) {}
    unlock(); adoptDoc(d); render(); setSync("live"); startPolling();
  } catch (e) {
    if (e.code === 401) lock(I18N.t("split.lock.wrongPasscode", "Wrong passcode"));
    else if (state.doc) { setSync("offline"); startPolling(); }
    else $("#receipts").innerHTML = `<p class="empty-hint">${esc(I18N.t("split.err.loadFailed", "Couldn't load this trip ({code}).", { code: String(e.code || e.message) }))}</p>`;
  }
}
async function resolveTrip() {
  try {
    const trips = await api("/trips");
    if (trips.length === 1) { state.tripId = trips[0].id; history.replaceState(null, "", "?t=" + state.tripId); unlock(); return tryLoad(); }
    location.replace("/");
  } catch (e) { if (e.code === 401) lock(); else location.replace("/"); }
}
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    api("/trips/" + state.tripId).then((d) => pollApply(d))
      .catch((e) => { if (e.code === 401) lock(I18N.t("split.lock.enterPasscode", "Enter passcode")); else setSync("offline"); });
  }, 4000);
}

// ---------- i18n: language switcher + live re-render ----------
if (window.I18N) {
  const host = $("#langHost"); if (host) I18N.mount(host);
  window.addEventListener("i18n:change", () => { applyAdminUI(); setSync(state.lastSyncStatus); if (state.doc) render(); });
}

// ---------- service worker + offline banner ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (sessionStorage.getItem("tk-sw-reloaded")) return;
    sessionStorage.setItem("tk-sw-reloaded", "1");
    location.reload();
  });
}
let offlineBanner = null;
function showOffline() {
  if (offlineBanner) return;
  offlineBanner = document.createElement("div");
  offlineBanner.className = "offline-banner"; offlineBanner.setAttribute("role", "status"); offlineBanner.setAttribute("aria-live", "polite");
  offlineBanner.textContent = I18N.t("common.offline", "📴 Offline — showing your saved plan");
  document.body.appendChild(offlineBanner);
  requestAnimationFrame(() => offlineBanner && offlineBanner.classList.add("in"));
}
function hideOffline() {
  if (!offlineBanner) return;
  const b = offlineBanner; offlineBanner = null; b.classList.remove("in");
  setTimeout(() => b.remove(), 300);
}
window.addEventListener("offline", showOffline);
window.addEventListener("online", hideOffline);
if (!navigator.onLine) showOffline();

async function boot() {
  buildSwatches();
  try { const me = await api("/me"); state.admin = !!me.admin; state.loginEnabled = !!me.loginEnabled; state.ocrEnabled = !!me.ocrEnabled; } catch (_) {}
  applyAdminUI();
  state.pass = localStorage.getItem(PASS_KEY) || "";
  if (state.tripId) { const cc = cacheLoad(); if (cc) { adoptDoc(cc); render(); } }
  tryLoad();
}
setRender(render);
boot();
