import { state } from "./state.js";
import { $, esc, t, I18N, api, tripId, days, dateKey, dayDate } from "./core.js";
import { setSheetState, map } from "./map.js";
import { renderAll, selectDay, startNowTicker, todayDayIndex, scrollToNow } from "./render.js";
import { initDialogs, buildStopSelects, buildDietChips, stopDlg, planDlg } from "./dialogs.js";

// ---------- load / poll ----------
function adopt(d) {
  state.data = d; state.itin = (d && d.itinerary) || { title: "", days: [] }; state.lastRev = d ? d.rev : -1;
  // authed full profile (incl dailyTarget) wins; else the sanitized public subset
  state.profile = (state.authed && state.fullDoc && state.fullDoc.profile) || (d && d.profile) || null;
  // public join wall: signups + capacity (authed full doc wins, else public subset)
  state.signups = (state.authed && state.fullDoc && Array.isArray(state.fullDoc.signups)) ? state.fullDoc.signups
    : (d && Array.isArray(d.signups)) ? d.signups : [];
  state.capacity = (state.authed && state.fullDoc && state.fullDoc.profile) ? (+state.fullDoc.profile.capacity || 0)
    : (d && +d.capacity) || 0;
  state._dateFmt = null;
}
export async function reload(silent) {
  try { const d = await api(`/trips/${tripId}/itinerary`); adopt(d); if (!silent) {} renderAll(); }
  catch (e) { if (!silent) $("#sheet-inner").innerHTML = `<div class="empty-itin"><p>${esc(t("trip.empty.loadFailed", "Couldn't load this trip."))}</p></div>`; }
}
function startDayFromHash() { if (/#all/i.test(location.hash)) return "all"; const m = (location.hash || "").match(/day(\d+)/i); return m ? Math.max(0, Number(m[1]) - 1) : 0; }
// with no #hash, land on today's day when today is within the trip's date range
function defaultDay() {
  const n = days().length; if (!n || !(state.profile && state.profile.startDate)) return 0;
  const today = dateKey(new Date());
  for (let i = 0; i < n; i++) if (dateKey(dayDate(i)) === today) return i;
  return 0;
}

async function boot() {
  if (!tripId) { location.replace("/"); return; }
  try {
    const d = await api(`/trips/${tripId}/itinerary`);   // PUBLIC — no passcode needed to view
    adopt(d);
    // if we already hold a passcode, silently promote to authed (enables edit + cost chips + full profile)
    if (state.pass) { try { state.fullDoc = await api(`/trips/${tripId}`); state.authed = true; if (state.fullDoc && state.fullDoc.profile) state.profile = state.fullDoc.profile; const me = await api("/me"); state.admin = !!me.admin; state.aiEnabled = !!me.aiEnabled; } catch (_) { state.pass = ""; } }
    state.currentDay = location.hash ? startDayFromHash() : defaultDay();
    renderAll();
    setSheetState("peek");
    setTimeout(() => map.invalidateSize(), 60);
    startNowTicker();
    if (!location.hash && todayDayIndex() >= 0) setTimeout(scrollToNow, 600);
  } catch (e) {
    $("#sheet-inner").innerHTML = `<div class="empty-itin"><div class="empty-emoji">🗺️</div><h2>${esc(t("trip.empty.notFoundTitle", "Trip not found"))}</h2><p>${t("trip.empty.notFoundBody", "Check the link, or go to {link}.", { link: '<a href="/">Tripkit</a>' })}</p></div>`;
    setSheetState("peek");
  }
  setInterval(async () => {
    if (state.editing || state.draft || document.querySelector("dialog[open]") || document.hidden) return;
    try { const d = await api(`/trips/${tripId}/itinerary`); if (d && d.rev !== state.lastRev) { adopt(d); renderAll(); } } catch (_) {}
  }, 6000);
}
window.addEventListener("hashchange", () => { const h = startDayFromHash(); if (h !== state.currentDay) selectDay(h); });

// ---------- i18n: mount switcher + live re-render ----------
{ const host = $("#lang-host"); if (host && window.I18N && I18N.mount) I18N.mount(host); }
window.addEventListener("i18n:change", () => {
  // rebuild dialog selects/chips only while their dialogs are closed (avoids wiping in-progress edits)
  if (!stopDlg.open) buildStopSelects();
  if (!planDlg.open) buildDietChips();
  if (state.data || state.itin) renderAll();
});

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
  offlineBanner.textContent = t("common.offline", "📴 Offline — showing your saved plan");
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

// Defer startup to a microtask so it runs AFTER the entire module graph has finished
// evaluating. Under the map<->render<->dialogs<->main import cycle the module bodies
// execute in an order where this entry module's body can run before map.js's body, so
// map.js consts (map, MODES, sheet) are still in their temporal dead zone here. A
// microtask drains only once the synchronous graph evaluation completes — by then every
// module body (incl. map.js) has run and all consts are initialized.
queueMicrotask(() => { initDialogs(); boot(); });
