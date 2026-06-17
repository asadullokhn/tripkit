import { state } from "./state.js";
import { $, days, dayColor, hasPin, badgeFor, LOGI, esc, typeLabel, I18N, toast, t, parseTimeMin } from "./core.js";
import { renderSheet, nowNext } from "./render.js";

// ---------- Leaflet map ----------
export const map = L.map("map", { zoomControl: false, attributionControl: true, scrollWheelZoom: true, inertia: true, zoomSnap: 0.25 });
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  { maxZoom: 20, subdomains: "abcd", attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
map.attributionControl.setPrefix(false);
map.setView([-2, 118], 5);
export const layer = L.layerGroup().addTo(map);
export const routeLayer = L.layerGroup().addTo(map);   // road-following day routes (vectors sit below markers)
export const routeCache = {};                          // daySig -> [[lat,lng]...] (road) | null (failed) | "pending"
let markers = [], flat = [];

export const viewDays = () => state.currentDay === "all" ? days().map((_, i) => i) : (days()[state.currentDay] ? [state.currentDay] : []);
export function buildFlat() {
  flat = [];
  viewDays().forEach((di) => days()[di].stops.forEach((stop, si) => flat.push({ stop, di, si, color: dayColor(di) })));
}
export function pinPts() { return flat.filter((f) => hasPin(f.stop)).map((f) => [f.stop.lat, f.stop.lng]); }
export function fitView(animate) {
  const pts = pinPts(); if (!pts.length) return;
  const desk = window.innerWidth >= 860;
  const pad = desk ? { paddingTopLeft: [70, 110], paddingBottomRight: [440, 60] }
    : { paddingTopLeft: [40, 150], paddingBottomRight: [40, window.innerHeight * 0.48] };
  const b = L.latLngBounds(pts);
  if (animate) map.flyToBounds(b, { ...pad, duration: 0.7 }); else map.fitBounds(b, pad);
}
// ---------- transport modes + per-leg, mode-aware routes ----------
export const MODES = {
  car:     { icon: "🚗", label: "Drive",   road: true },
  scooter: { icon: "🛵", label: "Scooter", road: true },
  taxi:    { icon: "🚕", label: "Taxi",    road: true },
  public:  { icon: "🚌", label: "Transit", road: true },
  bike:    { icon: "🚲", label: "Bike",    road: true },
  walk:    { icon: "🚶", label: "Walk",    road: false },
  boat:    { icon: "⛴️", label: "Boat",    road: false },
  flight:  { icon: "✈️", label: "Flight",  road: false },
};
export const modeOf = (s) => (s && MODES[s.mode] ? s.mode : "car");   // how you ARRIVE at s (from the prior pinned stop)
export const modeLabel = (k) => MODES[k] ? I18N.t("trip.mode." + k, MODES[k].label) : "";
export const legSig = (a, b, m) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)};${b.lat.toFixed(5)},${b.lng.toFixed(5)};${m}`;
export function haversineKm(A, B) {
  const R = 6371, d = (x) => x * Math.PI / 180;
  const dLat = d(B[0] - A[0]), dLng = d(B[1] - A[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(d(A[0])) * Math.cos(d(B[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
// OSRM leg duration (minutes) between two pinned stops for a mode; haversine fallback for walk; null otherwise
export function legMinutes(a, b, m) {
  const info = MODES[m] || MODES.car;
  if (info.road) { const leg = routeCache[legSig(a, b, m)]; return (leg && leg.line) ? leg.dur / 60 : null; }
  const km = haversineKm([a.lat, a.lng], [b.lat, b.lng]);
  if (m === "walk") return Math.max(1, km / 5 * 60);
  return null;   // flight/boat: don't guess travel time
}
// build a per-day timeline: returns { rows:[{arrival, leaveBy?, late}], endsAt, driveMin } | null
export function computeDayTimeline(day) {
  const stops = day.stops || []; if (!stops.length) return null;
  const rows = stops.map(() => ({ arrival: null, leaveBy: null, late: false }));
  // anchor: first manual time, else 08:00
  let clock = null;
  for (const s of stops) { const t = parseTimeMin(s.time); if (t != null) { clock = t; break; } }
  if (clock == null) clock = 8 * 60;
  let driveMin = 0, prevPin = -1;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i], fixed = parseTimeMin(s.time);
    let travel = 0;
    if (hasPin(s) && prevPin >= 0) { const lm = legMinutes(stops[prevPin], s, modeOf(s)); if (lm != null) { travel = lm; driveMin += lm; } }
    const computedArr = (i === 0) ? clock : clock + travel;
    if (fixed != null) {
      rows[i].arrival = fixed;
      if (i > 0) { rows[i].late = computedArr > fixed + 1; rows[i].leaveBy = fixed - travel; }   // back-solve: leave prior stop by …
      clock = fixed;
    } else {
      rows[i].arrival = computedArr; clock = computedArr;
    }
    const dur = (s.durationMin > 0) ? s.durationMin : 0;
    clock += dur;
    if (hasPin(s)) prevPin = i;
  }
  return { rows, endsAt: clock, driveMin };
}
// gentle queue so a multi-leg / All view doesn't hammer the OSRM demo (rate-limited)
const legQueue = []; let legActive = 0;
function pumpLegs() {
  while (legActive < 3 && legQueue.length) {
    const [sig, A, B] = legQueue.shift(); legActive++;
    fetchLeg(sig, A, B).then(() => {
      legActive--; drawRoutes(); refreshLegPills(); pumpLegs();
      // once all queued legs resolve, recompute the day timeline with the now-known drive times
      if (legActive === 0 && !legQueue.length && !state.editing && !document.querySelector("dialog[open]")) renderSheet();
    });
  }
}
async function fetchLeg(sig, A, B) {
  const url = `https://router.project-osrm.org/route/v1/driving/${A[1]},${A[0]};${B[1]},${B[0]}?overview=full&geometries=geojson`;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal }); if (!res.ok) throw 0;
    const j = await res.json(); const r = j.routes && j.routes[0];
    const g = r && r.geometry && r.geometry.coordinates; if (!g || !g.length) throw 0;
    routeCache[sig] = { line: g.map((c) => [c[1], c[0]]), dur: r.duration, dist: r.distance };
  } catch (_) { routeCache[sig] = null; }             // remember failure → keep the dashed fallback
  finally { clearTimeout(timer); }
}
// a bowed arc for a flight leg (quadratic bezier, control point offset ⟂ to the chord)
function arcPts(A, B) {
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], dx = B[1] - A[1], dy = B[0] - A[0], bow = 0.2;
  const cy = mid[0] + dx * bow, cx = mid[1] - dy * bow, out = [];
  for (let t = 0; t <= 1.0001; t += 0.05) { const u = 1 - t;
    out.push([u * u * A[0] + 2 * u * t * cy + t * t * B[0], u * u * A[1] + 2 * u * t * cx + t * t * B[1]]); }
  return out;
}
function drawRoad(c, line) {
  L.polyline(line, { color: c, weight: 11, opacity: 0.13, lineCap: "round", lineJoin: "round" }).addTo(routeLayer);
  L.polyline(line, { color: c, weight: 4, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(routeLayer);
}
function drawDashed(c, pts, dash, w) {
  L.polyline(pts, { color: c, weight: w + 5, opacity: 0.1, lineCap: "round" }).addTo(routeLayer);
  L.polyline(pts, { color: c, weight: w, opacity: 0.9, lineCap: "round", dashArray: dash }).addTo(routeLayer);
}
export function drawRoutes() {
  routeLayer.clearLayers();
  viewDays().forEach((di) => {
    const c = dayColor(di), pins = days()[di].stops.filter(hasPin);
    for (let i = 0; i < pins.length - 1; i++) {
      const A = [pins[i].lat, pins[i].lng], B = [pins[i + 1].lat, pins[i + 1].lng], m = modeOf(pins[i + 1]);
      if (m === "flight") { drawDashed(c, arcPts(A, B), "2 10", 3); continue; }
      if (m === "boat") { drawDashed(c, [A, B], "2 10", 3); continue; }
      if (m === "walk") { drawDashed(c, [A, B], "1 8", 3); continue; }
      const sig = legSig(pins[i], pins[i + 1], m), leg = routeCache[sig];
      if (leg && leg.line) { drawRoad(c, leg.line); continue; }
      drawDashed(c, [A, B], "1 9", 3.5);              // fallback while the road leg loads / if it fails
      if (leg === undefined) { routeCache[sig] = "pending"; legQueue.push([sig, A, B]); pumpLegs(); }
    }
  });
}
// label for the leg arriving at b (from the previous pinned stop a)
export function legLabel(a, b) {
  const m = modeOf(b), info = MODES[m];
  if (info.road) {
    const leg = routeCache[legSig(a, b, m)];
    if (leg && leg.line) return `${info.icon} ${Math.round(leg.dur / 60)} min · ${(leg.dist / 1000).toFixed(leg.dist < 10000 ? 1 : 0)} km`;
    return `${info.icon} …`;
  }
  const km = haversineKm([a.lat, a.lng], [b.lat, b.lng]);
  if (m === "walk") return `${info.icon} ${Math.max(1, Math.round(km / 5 * 60))} min · ${km.toFixed(1)} km`;
  return `${info.icon} ${km < 10 ? km.toFixed(1) : Math.round(km)} km`;   // flight/boat: distance only
}
export function refreshLegPills() {
  document.querySelectorAll(".leg-pill[data-a]").forEach((el) => {
    const st = days()[+el.dataset.di] && days()[+el.dataset.di].stops;
    if (st && st[+el.dataset.a] && st[+el.dataset.b]) el.textContent = legLabel(st[+el.dataset.a], st[+el.dataset.b]);
  });
}
export function renderMap() {
  layer.clearLayers(); markers = [];
  drawRoutes();
  flat.forEach((f, k) => {
    if (!hasPin(f.stop)) { markers.push(null); return; }
    const badge = badgeFor(days()[f.di], f.stop, f.si);
    const logi = LOGI.has(f.stop.type);
    const icon = L.divIcon({ className: "mk-wrap" + (f.stop.done ? " is-done" : ""), html: `<div class="mk ${logi ? "is-logi" : ""}" style="--mk:${f.color}"><span>${badge}</span></div>`,
      iconSize: [30, 30], iconAnchor: [15, 35], popupAnchor: [0, -34] });
    const m = L.marker([f.stop.lat, f.stop.lng], { icon, riseOnHover: true }).addTo(layer);
    m.bindPopup(`<div class="pop-badge">${esc(typeLabel(f.stop.type))}</div><div class="pop-name">${esc(f.stop.name)}</div>`);
    m.on("click", () => activateStop(k, "map"));
    markers.push(m);
  });
  fitView(false);
}

export function activateStop(i, source) {
  if (i === state.activeIdx && source === "sheet") i = -1;
  state.activeIdx = i;
  document.querySelectorAll(".stop").forEach((el) => el.classList.toggle("is-active", Number(el.dataset.idx) === i));
  markers.forEach((m, mi) => { const el = m && m.getElement(); if (el) el.classList.toggle("is-active", mi === i); });
  if (i < 0 || !flat[i]) return;
  const stop = flat[i].stop;
  if (!hasPin(stop)) return;
  if (source === "sheet") {
    const off = window.innerWidth >= 860 ? 0 : -0.012;
    map.flyTo([stop.lat + off, stop.lng], 14, { duration: 0.6 });
    if (markers[i]) setTimeout(() => markers[i].openPopup(), 420);
  } else if (markers[i]) {
    markers[i].openPopup();
    if (sheet.dataset.state !== "full") setSheetState("full");
    const card = document.querySelector(`.stop[data-idx="${i}"]`);
    if (card) setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }
}

// tag the matching card + pin with .is-now / .is-next (only meaningful in single-day or all view)
export function applyNowNext() {
  document.querySelectorAll(".is-now, .is-next").forEach((el) => el.classList.remove("is-now", "is-next"));
  markers.forEach((m) => { const el = m && m.getElement(); if (el) el.classList.remove("is-now", "is-next"); });
  const nn = nowNext(); if (!nn) return;
  const tag = (si, cls) => {
    if (si < 0) return;
    const li = document.querySelector(`.tl-item[data-di="${nn.di}"][data-si="${si}"]`);
    if (li) { li.classList.add(cls); const gi = +li.dataset.gi; const mk = markers[gi] && markers[gi].getElement(); if (mk) mk.classList.add(cls); }
  };
  tag(nn.cur, "is-now"); tag(nn.next, "is-next");
}

// ---------- sheet drag (from the original itinerary app) ----------
export const sheet = $("#sheet"), grab = $("#sheet-grab"), scroller = $("#sheet-scroll");
export const peekTranslate = () => Math.max(0, sheet.offsetHeight - window.innerHeight * 0.46);
const hiddenTranslate = () => Math.max(0, sheet.offsetHeight - 36);
export const stateTranslate = (s) => s === "full" ? 0 : s === "hidden" ? hiddenTranslate() : peekTranslate();
export function setSheetState(s) { sheet.dataset.state = s; document.body.classList.toggle("sheet-full", s === "full"); document.body.classList.toggle("sheet-hidden", s === "hidden"); sheet.style.setProperty("--sheet-y", stateTranslate(s) + "px"); }
let drag = null;
export function onDown(e) { if (window.innerWidth >= 860) return; drag = { startY: e.clientY, start: stateTranslate(sheet.dataset.state), moved: 0 }; sheet.classList.add("dragging"); window.addEventListener("pointermove", onMove, { passive: false }); window.addEventListener("pointerup", onUp); }
function onMove(e) { if (!drag) return; drag.moved = e.clientY - drag.startY; sheet.style.setProperty("--sheet-y", Math.min(hiddenTranslate(), Math.max(0, drag.start + drag.moved)) + "px"); e.preventDefault(); }
function onUp() { if (!drag) return; sheet.classList.remove("dragging"); const peek = peekTranslate(), hid = hiddenTranslate(); let cur = Math.min(hid, Math.max(0, drag.start + drag.moved)); if (drag.moved < -60) cur -= peek * 0.4; else if (drag.moved > 60) cur += peek * 0.4; const cand = [["full", 0], ["peek", peek], ["hidden", hid]]; let best = cand[0]; cand.forEach((c) => { if (Math.abs(c[1] - cur) < Math.abs(best[1] - cur)) best = c; }); setSheetState(best[0]); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); drag = null; }
grab.addEventListener("pointerdown", onDown);
grab.addEventListener("click", () => { if (Math.abs((drag && drag.moved) || 0) > 6) return; setSheetState(sheet.dataset.state === "full" ? "peek" : "full"); });
const hideBtn = $("#sheet-hide"); if (hideBtn) hideBtn.addEventListener("click", (e) => { e.stopPropagation(); setSheetState("hidden"); });
scroller.addEventListener("pointerdown", (e) => { if (window.innerWidth >= 860) return; if (scroller.scrollTop <= 0 && sheet.dataset.state === "full") onDown(e); });

// ---------- locate / recenter ----------
export const locLayer = L.layerGroup().addTo(map); let meMarker = null, meCircle = null;
export function onPos(p) { const ll = [p.coords.latitude, p.coords.longitude], acc = p.coords.accuracy || 0;
  if (!meMarker) { meCircle = L.circle(ll, { radius: acc, className: "me-acc", stroke: false, interactive: false }).addTo(locLayer);
    meMarker = L.marker(ll, { icon: L.divIcon({ className: "me-wrap", html: `<div class="me-dot"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(locLayer);
    map.flyTo(ll, Math.max(map.getZoom(), 14), { duration: 0.8 }); } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(acc); }
  $("#locate").classList.add("on"); }
$("#locate").addEventListener("click", () => { if (!navigator.geolocation) return; if (meMarker) return map.flyTo(meMarker.getLatLng(), 15, { duration: 0.6 }); navigator.geolocation.getCurrentPosition(onPos, () => toast(t("trip.toast.locationFailed", "Couldn't get your location"), "err"), { enableHighAccuracy: true, timeout: 12000 }); });
$("#recenter").addEventListener("click", () => fitView(true));
let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { map.invalidateSize(); if (window.innerWidth < 860) setSheetState(sheet.dataset.state || "peek"); fitView(false); }, 150); });
