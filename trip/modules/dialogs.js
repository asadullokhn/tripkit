import { state } from "./state.js";
import { $, esc, t, api, tripId, toast, TYPE, typeLabel, DIET_OPTS, dietLabel, days, PASS_KEY } from "./core.js";
import { map, MODES, modeLabel, renderMap } from "./map.js";
import { renderSheet, renderAll, applyAuthUI, datesSummary, signupTotal } from "./render.js";
import { reload } from "./main.js";

// ---------- editing ----------
export function requireAuth(fn) { if (state.authed) return fn(); state.lockIntent = fn; showLock(); }
export async function saveItin(optimisticMsg) {
  try { await api(`/trips/${tripId}/itinerary`, { method: "PUT", body: { title: state.itin.title || "", days: state.itin.days } });
    if (optimisticMsg) toast(optimisticMsg); await reload(true); }
  catch (e) { toast(e.code === 401 ? t("trip.toast.enterPasscode", "Enter the passcode to edit") : t("trip.toast.saveFailed", "Save failed"), "err"); if (e.code === 401) { state.authed = false; showLock(); } reload(true); }
}
export function onEditAct(act, di, si) {
  if (act === "done") return toggleDone(di, si);
  if (act === "up" || act === "down") return moveStop(di, si, act === "up" ? -1 : 1);
  if (act === "dayup" || act === "daydown") return moveDay(di, act === "dayup" ? -1 : 1);
  if (act === "edit") return openStop(di, si);
  if (act === "addstop") return openStop(di, null);
  if (act === "addday") return openDay(null);
  if (act === "editday") return openDay(di);
  if (act === "cost") return openCost(di, si);
  if (act === "shareday") return shareTrip(di);
}
export function moveStop(di, si, d) { const a = days()[di].stops; const j = si + d; if (j < 0 || j >= a.length) return; [a[si], a[j]] = [a[j], a[si]]; renderSheet(); renderMap(); saveItin(); }
export function toggleDone(di, si) {
  if (!state.authed) return requireAuth(() => toggleDone(di, si));
  const s = days()[di].stops[si]; s.done = !s.done;
  renderSheet(); renderMap(); saveItin(s.done ? t("trip.toast.markedDone", "Marked done") : t("trip.toast.markedNotDone", "Marked not done"));
}
export function moveDay(di, d) { const a = days(); const j = di + d; if (j < 0 || j >= a.length) return; [a[di], a[j]] = [a[j], a[di]]; state.currentDay = j; renderAll(); saveItin(); }

// stop dialog
const stopDlg = $("#stopDialog"); let stopEdit = null, stopPrefill = null, pickMode = false;
// build the Type <select> from the TYPE catalogue so labels never drift from the map
export function buildStopSelects() {
  const tv = $("#stType").value, mv = $("#stMode").value;
  $("#stType").innerHTML = Object.keys(TYPE).map((k) => `<option value="${k}">${TYPE[k].icon} ${esc(typeLabel(k))}</option>`).join("");
  $("#stMode").innerHTML = Object.keys(MODES).map((k) => `<option value="${k}">${MODES[k].icon} ${esc(modeLabel(k))}</option>`).join("");
  if (tv) $("#stType").value = tv; if (mv) $("#stMode").value = mv;
}
function setCoords(c) {
  $("#stLat").value = c ? c.lat : ""; $("#stLng").value = c ? c.lng : "";
  const el = $("#stCoords"); el.textContent = c ? `📍 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}` : t("trip.stop.noPin", "No pin yet"); el.classList.toggle("set", !!c);
}
// pull lat,lng out of a pasted Google/Apple Maps link or a raw "lat, lng"
function parseCoords(s) {
  if (!s) return null;
  const m = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ||
            s.match(/[?&](?:q|ll|center|destination|sll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ||
            s.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
function captureStop() {
  const lk = { maps: $("#stUrl").value.trim(), booking: $("#stLinkBooking").value.trim(), tickets: $("#stLinkTickets").value.trim() };
  return { name: $("#stName").value, type: $("#stType").value, mode: $("#stMode").value, time: $("#stTime").value,
    url: $("#stUrl").value, links: lk, durationMin: Math.max(0, parseInt($("#stDuration").value, 10) || 0), note: $("#stNote").value,
    lat: parseFloat($("#stLat").value) || 0, lng: parseFloat($("#stLng").value) || 0 };
}
export function openStop(di, si, prefill) {
  stopEdit = { di, si };
  const s = prefill || (si != null ? days()[di].stops[si] : {});
  const lk = s.links || {};
  $("#stopTitle").textContent = si != null ? t("trip.stop.editTitle", "Edit stop") : t("trip.stop.addTitle", "Add stop");
  $("#stName").value = s.name || ""; $("#stType").value = s.type || "activity"; $("#stMode").value = s.mode || "car";
  $("#stTime").value = s.time || ""; $("#stUrl").value = lk.maps || s.url || "";
  $("#stLinkBooking").value = lk.booking || ""; $("#stLinkTickets").value = lk.tickets || "";
  $("#stDuration").value = (s.durationMin > 0) ? s.durationMin : "";
  $("#stNote").value = s.note || ""; $("#stPlace").value = "";
  setCoords((Number.isFinite(s.lat) && (s.lat !== 0 || s.lng !== 0)) ? { lat: s.lat, lng: s.lng } : null);
  $("#stErr").hidden = true; $("#stDelete").hidden = si == null;
  stopDlg.showModal(); setTimeout(() => $("#stName").focus(), 30);
}
$("#stPlace").addEventListener("input", () => { const c = parseCoords($("#stPlace").value); if (c) setCoords(c); });
$("#stPick").addEventListener("click", () => {
  stopPrefill = captureStop(); stopDlg.close();
  pickMode = true; document.body.classList.add("picking"); toast(t("trip.toast.tapToPin", "Tap the map to place the pin"));
});
$("#stCancel").addEventListener("click", () => stopDlg.close());
stopDlg.addEventListener("cancel", (e) => { e.preventDefault(); stopDlg.close(); });
$("#stDelete").addEventListener("click", async () => {
  const { di, si } = stopEdit; const nm = (days()[di].stops[si] && days()[di].stops[si].name) || t("trip.stop.thisStop", "this stop");
  stopDlg.close();
  if (!(await confirmAsk(t("trip.stop.deleteConfirmTitle", "Delete stop?"), t("trip.stop.deleteConfirmBody", "“{name}” will be removed from the day.", { name: nm }), t("common.delete", "Delete"), true))) return;
  days()[di].stops.splice(si, 1); renderSheet(); renderMap(); saveItin(t("trip.toast.stopRemoved", "Stop removed"));
});
$("#stopForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#stName").value.trim();
  if (!name) { $("#stErr").textContent = t("trip.stop.nameRequired", "Name is required"); $("#stErr").hidden = false; $("#stName").focus(); return; }
  const lat = parseFloat($("#stLat").value), lng = parseFloat($("#stLng").value);
  const mapsUrl = $("#stUrl").value.trim();
  const links = { maps: mapsUrl, booking: $("#stLinkBooking").value.trim(), tickets: $("#stLinkTickets").value.trim() };
  const s = { name, type: $("#stType").value, mode: $("#stMode").value, time: $("#stTime").value.trim(), url: mapsUrl,
    links, durationMin: Math.max(0, parseInt($("#stDuration").value, 10) || 0),
    note: $("#stNote").value.trim(), lat: Number.isFinite(lat) ? lat : 0, lng: Number.isFinite(lng) ? lng : 0 };
  const { di, si } = stopEdit;
  if (si != null) { const o = days()[di].stops[si]; s.id = o.id; s.linkedExpenseId = o.linkedExpenseId; s.done = o.done; s.cost = o.cost; days()[di].stops[si] = s; }
  else days()[di].stops.push(s);
  stopDlg.close(); renderSheet(); renderMap(); saveItin(t("common.saved", "Saved"));
});

// day dialog
const dayDlg = $("#dayDialog"); let dayEdit = null;
export function openDay(di) {
  dayEdit = di;
  const d = di != null ? days()[di] : {};
  $("#dayTitle").textContent = di != null ? t("trip.day.editTitle", "Edit day") : t("trip.day.addTitle", "Add day");
  $("#dyTitle").value = d.title || ""; $("#dyLabel").value = d.label || ""; $("#dyDate").value = d.dateLabel || "";
  $("#dyDelete").hidden = di == null;
  dayDlg.showModal(); setTimeout(() => $("#dyTitle").focus(), 30);
}
$("#dyCancel").addEventListener("click", () => dayDlg.close());
dayDlg.addEventListener("cancel", (e) => { e.preventDefault(); dayDlg.close(); });
$("#dyDelete").addEventListener("click", async () => {
  if (dayEdit == null) return;
  const d = state.itin.days[dayEdit]; const nm = (d && (d.title || d.label)) || t("trip.day.thisDay", "this day"); const n = (d && d.stops) ? d.stops.length : 0;
  dayDlg.close();
  const stopsClause = n ? (n > 1 ? t("trip.day.andItsStops", " and its {n} stops", { n }) : t("trip.day.andItsStop", " and its {n} stop", { n })) : "";
  if (!(await confirmAsk(t("trip.day.deleteConfirmTitle", "Delete day?"), t("trip.day.deleteConfirmBody", "“{name}”{stops} will be removed.", { name: nm, stops: stopsClause }), t("common.delete", "Delete"), true))) return;
  state.itin.days.splice(dayEdit, 1); state.currentDay = state.itin.days.length ? 0 : "all"; renderAll(); saveItin(t("trip.toast.dayRemoved", "Day removed"));
});
$("#dayForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = $("#dyTitle").value.trim(); if (!title) return;
  const d = { label: $("#dyLabel").value.trim() || t("trip.day.dayN", "Day {n}", { n: (dayEdit != null ? dayEdit : state.itin.days.length) + 1 }), dateLabel: $("#dyDate").value.trim(), title };
  if (dayEdit != null) { d.id = state.itin.days[dayEdit].id; d.stops = state.itin.days[dayEdit].stops; state.itin.days[dayEdit] = d; }
  else { d.stops = []; state.itin.days.push(d); state.currentDay = state.itin.days.length - 1; }
  dayDlg.close(); renderAll(); saveItin(t("common.saved", "Saved"));
});

// ---------- combined plan dialog (AI generate + trip preferences) ----------
const planDlg = $("#planDialog");
// build dietary chips from the vocab
export function buildDietChips() { $("#pfDietary").innerHTML = DIET_OPTS.map((k) => `<button type="button" class="chip" data-diet="${k}">${esc(dietLabel(k))}</button>`).join(""); }
$("#pfDietary").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) b.classList.toggle("on"); });

// populate the preference fields from the best profile we hold
function fillPrefs(p) {
  p = p || {};
  $("#pfStartDate").value = p.startDate || "";
  $("#pfPace").value = p.pace || ""; $("#pfBudgetLevel").value = p.budgetLevel || "";
  $("#pfDailyTarget").value = p.dailyTarget > 0 ? p.dailyTarget : "";
  $("#pfCapacity").value = p.capacity > 0 ? p.capacity : "";
  $("#pfInterests").value = (p.interests || []).join(", ");
  const diet = new Set(p.dietary || []);
  $("#pfDietary").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", diet.has(c.dataset.diet)));
  $("#pfAdults").value = p.adults > 0 ? p.adults : ""; $("#pfKids").value = p.kids > 0 ? p.kids : "";
  $("#pfMobility").value = p.mobility || ""; $("#pfHomeCurrency").value = p.homeCurrency || "";
}
// read the preference fields into a profile body
function capturePrefs() {
  const interests = $("#pfInterests").value.split(",").map((s) => s.trim()).filter(Boolean);
  const dietary = [...$("#pfDietary").querySelectorAll(".chip.on")].map((c) => c.dataset.diet);
  return {
    startDate: $("#pfStartDate").value || "",
    pace: $("#pfPace").value || "", budgetLevel: $("#pfBudgetLevel").value || "",
    dailyTarget: Math.max(0, parseInt($("#pfDailyTarget").value, 10) || 0),
    capacity: Math.min(200, Math.max(0, parseInt($("#pfCapacity").value, 10) || 0)),
    interests, dietary,
    adults: Math.max(0, parseInt($("#pfAdults").value, 10) || 0),
    kids: Math.max(0, parseInt($("#pfKids").value, 10) || 0),
    mobility: $("#pfMobility").value || "", homeCurrency: $("#pfHomeCurrency").value.trim(),
  };
}
// toggle the in-modal progress row + disable/enable the action buttons (≤100ms feedback)
function planBusy(on, msg) {
  const prog = $("#planProgress");
  if (msg) $("#planProgressText").textContent = msg;
  prog.hidden = !on;
  [$("#planCancel"), $("#planSavePrefs"), $("#planGo")].forEach((b) => { b.disabled = on; });
  $("#aiDest").disabled = on; $("#aiDays").disabled = on;
}
function planErr(msg) { const el = $("#planErr"); el.textContent = msg; el.hidden = !msg; }
export function openPlan() {
  requireAuth(async () => {
    // make sure we have the FULL profile (incl. dailyTarget/homeCurrency) before editing
    if (!state.fullDoc) { try { state.fullDoc = await api(`/trips/${tripId}`); } catch (_) {} }
    const p = (state.fullDoc && state.fullDoc.profile) || state.profile || {};
    $("#aiDest").value = (state.data && state.data.trip && state.data.trip.name) || "";
    $("#aiDays").value = days().length ? Math.min(14, Math.max(1, days().length)) : 3;
    fillPrefs(p);
    planBusy(false); planErr("");
    $("#aiProviderHint").hidden = !(state.admin && state.aiEnabled);
    planDlg.showModal(); setTimeout(() => $("#aiDest").focus(), 30);
  });
}
function closePlan() { if (!$("#planGo").disabled) planDlg.close(); }   // never close mid-generate
$("#planCancel").addEventListener("click", closePlan);
planDlg.addEventListener("cancel", (e) => { e.preventDefault(); closePlan(); });
// backdrop tap-to-dismiss (don't dismiss while a generate is in flight)
planDlg.addEventListener("click", (e) => { if (e.target === planDlg && !$("#planGo").disabled) planDlg.close(); });

// Save preferences (ghost) — PUT /profile then close + toast
async function savePrefs() {
  const go = $("#planSavePrefs"); go.disabled = true; planErr("");
  try {
    state.fullDoc = await api(`/trips/${tripId}/profile`, { method: "PUT", body: capturePrefs() });
    planDlg.close(); state._dateFmt = null; await reload(true); toast(t("trip.toast.profileSaved", "Trip profile saved"));
  } catch (err) {
    planErr(err.code === 401 ? t("trip.toast.enterPasscode", "Enter the passcode to edit") : t("trip.toast.saveFailed", "Save failed"));
    if (err.code === 401) { state.authed = false; planDlg.close(); showLock(); }
  } finally { go.disabled = false; }
}
$("#planSavePrefs").addEventListener("click", savePrefs);

// Generate (primary) — save prefs AND call generate, with in-modal progress; keep form on failure
$("#planForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dest = $("#aiDest").value.trim();
  if (!dest) { planErr(t("trip.plan.destRequired", "Destination is required")); $("#aiDest").focus(); return; }
  planBusy(true, t("trip.plan.drafting", "✨ Drafting your itinerary…")); planErr("");
  const prefs = capturePrefs();
  try {
    // persist the preferences first so the draft is tailored by them (best-effort; never blocks generate)
    try { state.fullDoc = await api(`/trips/${tripId}/profile`, { method: "PUT", body: prefs }); state._dateFmt = null; } catch (_) {}
    const out = await api(`/trips/${tripId}/itinerary/generate`, { method: "POST", body: { destination: dest, days: parseInt($("#aiDays").value, 10) || 3, notes: (prefs.interests || []).join(", ") } });
    state.draft = out.draft; planBusy(false); planDlg.close();
    state.itin = JSON.parse(JSON.stringify(state.draft)); state.currentDay = 0; state.editing = false; renderAll();
    $("#draftBanner").hidden = false;
  } catch (err) {
    planBusy(false);   // re-enable; keeps the populated form intact
    planErr(err.code === 503 ? t("trip.ai.errNotConfigured", "AI isn't configured on the server.")
      : (err.code === 504 || err.code === 408) ? t("trip.ai.errTimeout", "Timed out — try again.")
      : err.code === 401 ? t("trip.ai.errAdmin", "Log in as admin.")
      : t("trip.ai.errFailed", "Generation failed."));
    if (err.code === 401) { state.authed = false; planDlg.close(); showLock(); }
  }
});

$("#profileBtn").addEventListener("click", openPlan);
$("#aiBtn").addEventListener("click", openPlan);

// ---------- share ----------
export function shareTrip(di) {
  const name = (state.data && state.data.trip && state.data.trip.name) || state.itin.title || t("trip.share.ourTrip", "Our trip");
  const n = days().length;
  let url = location.origin + location.pathname + location.search;
  let text = name;
  const dates = datesSummary();
  if (di != null && days()[di]) {
    const d = days()[di];
    url += "#day" + (di + 1);
    text = `${name} — ${d.title || d.label || t("trip.day.dayN", "Day {n}", { n: di + 1 })}`;
  } else {
    const parts = [];
    if (n) parts.push(n > 1 ? t("trip.chip.days", "{n} days", { n }) : t("trip.chip.day", "{n} day", { n }));
    if (dates) parts.push(dates);
    if (parts.length) text += " · " + parts.join(" · ");
  }
  const payload = { title: name, text, url };
  if (navigator.share) { navigator.share(payload).catch(() => {}); return; }
  const copy = `${text}\n${url}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(copy).then(() => toast(t("trip.toast.linkCopied", "Link copied")), () => toast(t("trip.toast.copyFailed", "Couldn't copy"), "err"));
  } else { toast(copy); }
}
$("#shareBtn").addEventListener("click", () => shareTrip(null));

// ---------- RSVP "I'm in" join wall (public) ----------
const rsvpDlg = $("#rsvpDialog"); let rsvpBusy = false;
function rsvpErr(msg) { const el = $("#rsvpErr"); el.textContent = msg || ""; el.hidden = !msg; }
export function openRsvp() {
  if (state.capacity > 0 && signupTotal() >= state.capacity) { toast(t("trip.rsvp.fullToast", "This trip is full"), "err"); return; }
  rsvpErr(""); $("#rsvpName").value = ""; $("#rsvpCount").value = "1"; rsvpBusy = false;
  $("#rsvpGo").disabled = false;
  rsvpDlg.showModal(); setTimeout(() => $("#rsvpName").focus(), 30);
}
$("#rsvpCancel").addEventListener("click", () => { if (!rsvpBusy) rsvpDlg.close(); });
rsvpDlg.addEventListener("cancel", (e) => { e.preventDefault(); if (!rsvpBusy) rsvpDlg.close(); });
rsvpDlg.addEventListener("click", (e) => { if (e.target === rsvpDlg && !rsvpBusy) rsvpDlg.close(); });
$("#rsvpForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#rsvpName").value.trim();
  if (!name) { rsvpErr(t("trip.rsvp.nameRequired", "Please enter your name")); $("#rsvpName").focus(); return; }
  let count = parseInt($("#rsvpCount").value, 10); if (!(count >= 1)) count = 1; if (count > 10) count = 10;
  rsvpBusy = true; $("#rsvpGo").disabled = true; rsvpErr("");
  try {
    await api(`/trips/${tripId}/rsvp`, { method: "POST", body: { name, count } });
    rsvpDlg.close(); toast(t("trip.rsvp.joined", "You're in! See you there 🎉"));
    await reload(true);
  } catch (err) {
    rsvpBusy = false; $("#rsvpGo").disabled = false;
    rsvpErr(err.code === 429 ? t("trip.rsvp.tooMany", "Too many requests — try again later.")
      : err.code === 400 ? t("trip.rsvp.invalid", "Check your name and try again.")
      : t("trip.rsvp.failed", "Couldn't join — try again."));
  }
});
// admin: remove a signup
export async function removeSignup(idx) {
  if (!state.authed) return requireAuth(() => removeSignup(idx));
  const s = state.signups[idx]; const nm = (s && s.name) || t("trip.rsvp.thisPerson", "this person");
  if (!(await confirmAsk(t("trip.rsvp.removeTitle", "Remove from the list?"), t("trip.rsvp.removeBody", "“{name}” will be removed from the join list.", { name: nm }), t("trip.rsvp.remove", "Remove"), true))) return;
  try { await api(`/trips/${tripId}/rsvp/${idx}`, { method: "DELETE" }); await reload(true); toast(t("trip.rsvp.removed", "Removed")); }
  catch (err) { toast(err.code === 401 ? t("trip.toast.enterPasscode", "Enter the passcode to edit") : t("trip.rsvp.removeFailed", "Couldn't remove"), "err"); }
}

// edit toggle + login
$("#editToggle").addEventListener("click", () => { if (!state.editing) return requireAuth(() => { state.editing = true; renderAll(); }); state.editing = false; renderAll(); });
$("#logoutBtn").addEventListener("click", async () => { try { await api("/logout", { method: "POST" }); } catch (_) {} state.admin = false; applyAuthUI(); toast(t("trip.toast.loggedOut", "Logged out")); });

// ---------- cost link ----------
const costDlg = $("#costDialog"); let costEdit = null;
export function openCost(di, si) {
  requireAuth(async () => {
    if (!state.fullDoc) { try { state.fullDoc = await api(`/trips/${tripId}`); } catch (_) {} }
    costEdit = { di, si };
    const stop = days()[di].stops[si];
    const sel = $("#costSelect"); sel.innerHTML = `<option value="">${esc(t("trip.cost.none", "— none —"))}</option>`;
    (state.fullDoc ? state.fullDoc.expenses || [] : []).forEach((e) => { const o = document.createElement("option"); o.value = e.id; o.textContent = `${e.title} · Rp ${Number(e.amount).toLocaleString("en-US")}`; sel.appendChild(o); });
    (state.fullDoc ? state.fullDoc.receipts || [] : []).forEach((r) => { const o = document.createElement("option"); o.value = r.id; o.textContent = `${r.title} · Rp ${Number(r.grandTotal).toLocaleString("en-US")}`; sel.appendChild(o); });
    sel.value = stop.linkedExpenseId || ""; $("#costAmount").value = ""; $("#costErr").hidden = true;
    $("#costUnlink").hidden = !stop.linkedExpenseId;
    costDlg.showModal();
  });
}
$("#costCancel").addEventListener("click", () => costDlg.close());
costDlg.addEventListener("cancel", (e) => { e.preventDefault(); costDlg.close(); });
$("#costUnlink").addEventListener("click", () => { const { di, si } = costEdit; days()[di].stops[si].linkedExpenseId = ""; costDlg.close(); renderSheet(); saveItin(t("trip.toast.unlinked", "Unlinked")); });
$("#costForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { di, si } = costEdit; const stop = days()[di].stops[si];
  const sel = $("#costSelect").value; const amt = Math.max(0, parseInt($("#costAmount").value, 10) || 0);
  try {
    let linkId = sel;
    if (!sel && amt > 0) {
      const ppl = (state.fullDoc ? state.fullDoc.people || [] : []);
      const shares = {}; ppl.forEach((p) => shares[p.id] = 1);
      const payer = ppl[0] ? ppl[0].id : "";
      const out = await api(`/trips/${tripId}/expenses`, { method: "POST", body: { title: stop.name, amount: amt, payerId: payer, splitMode: "EVENLY", shares } });
      state.fullDoc = out; linkId = out.expenses[out.expenses.length - 1].id;
    }
    stop.linkedExpenseId = linkId || "";
    costDlg.close(); renderSheet(); saveItin(t("trip.toast.costLinked", "Cost linked"));
  } catch (err) { $("#costErr").textContent = err.code === 401 ? t("trip.cost.passcodeNeeded", "Passcode needed") : t("trip.cost.couldntLink", "Couldn't link"); $("#costErr").hidden = false; }
});

// ---------- AI draft review (banner) ----------
export function endDraft() { state.draft = null; $("#draftBanner").hidden = true; }
$("#draftDiscard").addEventListener("click", () => { endDraft(); reload(true); });
$("#draftRegen").addEventListener("click", () => { endDraft(); openPlan(); });
$("#draftReplace").addEventListener("click", async () => {
  if (!(await confirmAsk(t("trip.draft.replaceConfirmTitle", "Replace itinerary?"), t("trip.draft.replaceConfirmBody", "This overwrites the entire saved plan with the AI draft."), t("trip.draft.replace", "Replace"), true))) return;
  state.itin = JSON.parse(JSON.stringify(state.draft)); endDraft(); await saveItin(t("trip.toast.itinSaved", "Itinerary saved"));
});
$("#draftAppend").addEventListener("click", async () => {
  try { const cur = await api(`/trips/${tripId}/itinerary`); const base = (cur && cur.itinerary) || { title: "", days: [] };
    base.days = (base.days || []).concat(state.draft.days); if (!base.title) base.title = state.draft.title;
    state.itin = base; endDraft(); await saveItin(t("trip.toast.daysAppended", "Days appended")); } catch (_) { toast(t("trip.toast.appendFailed", "Append failed"), "err"); }
});

// ---------- confirm ----------
const cfDlg = $("#confirmDialog"); let cfResolve = null;
export function confirmAsk(title, body, okLabel, danger) {
  return new Promise((res) => { cfResolve = res; $("#cfTitle").textContent = title; $("#cfBody").textContent = body || ""; const ok = $("#cfOk"); ok.textContent = okLabel || t("common.confirm", "Confirm"); ok.classList.toggle("danger", !!danger); cfDlg.showModal(); });
}
$("#cfOk").addEventListener("click", () => { cfDlg.close(); if (cfResolve) cfResolve(true); cfResolve = null; });
$("#cfCancel").addEventListener("click", () => { cfDlg.close(); if (cfResolve) cfResolve(false); cfResolve = null; });
cfDlg.addEventListener("cancel", (e) => { e.preventDefault(); cfDlg.close(); if (cfResolve) cfResolve(false); cfResolve = null; });

// ---------- lock ----------
export function showLock(msg) { const el = $("#lock"); el.hidden = false; if (msg) $("#lockErr").textContent = msg; setTimeout(() => $("#lockInput").focus(), 50); }
$("#lockForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const v = $("#lockInput").value.trim(); if (!v) return;
  state.pass = v;
  try {
    state.fullDoc = await api(`/trips/${tripId}`);   // verifies passcode
    localStorage.setItem(PASS_KEY, state.pass); state.authed = true;
    if (state.fullDoc && state.fullDoc.profile) state.profile = state.fullDoc.profile;   // promote to full profile (incl dailyTarget)
    try { const me = await api("/me"); state.admin = !!me.admin; state.aiEnabled = !!me.aiEnabled; } catch (_) {}
    $("#lock").hidden = true; $("#lockErr").textContent = "";
    renderSheet(); applyAuthUI();
    const fn = state.lockIntent; state.lockIntent = null; if (typeof fn === "function") fn();
  } catch (err) {
    state.pass = ""; const c = $("#lockForm"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
    $("#lockErr").textContent = t("trip.lock.wrong", "Wrong passcode"); $("#lockInput").select();
  }
});

// startup bootstrap — called by main.js AFTER the whole module graph has initialized,
// so map.js consts (map, MODES) are guaranteed defined. Running these at dialogs.js
// eval time would hit a temporal dead zone through the map<->render<->dialogs import
// cycle (dialogs evaluates before map.js's body has run).
export function initDialogs() {
  buildStopSelects();
  buildDietChips();
  map.on("click", (e) => {
    if (!pickMode) return;
    pickMode = false; document.body.classList.remove("picking");
    const pf = stopPrefill || {}; pf.lat = +e.latlng.lat.toFixed(6); pf.lng = +e.latlng.lng.toFixed(6);
    openStop(stopEdit.di, stopEdit.si, pf);
  });
}

export { stopDlg, planDlg };
