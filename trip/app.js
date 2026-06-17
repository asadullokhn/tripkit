/* ============================================================
   Tripkit · Itinerary — per-trip, publicly viewable (shareable),
   editable with the passcode, AI-generatable by the admin.
   Vanilla JS + Leaflet. No build step.
   ============================================================ */
(() => {
  "use strict";

  const API = "/api", PASS_KEY = "balitrip-pass";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const tripId = new URLSearchParams(location.search).get("t");

  // --- state ---
  let pass = localStorage.getItem(PASS_KEY) || "";
  let admin = false, aiEnabled = false, authed = false, editing = false;
  let data = null;       // { trip, people, itinerary, profile?, rev } from the public endpoint
  let itin = { title: "", days: [] };
  let profile = null;    // sanitized (public) or full (authed) trip profile
  let fullDoc = null;    // full trip doc (expenses/receipts) once authed — for cost links
  let draft = null;      // AI draft under review
  let currentDay = 0;    // index or "all"
  let lastRev = -1;
  let lockIntent = null; // what to do after unlocking: "edit" | fn

  // --- type catalogue (icon + gradient + label) ---
  const TYPE = {
    start:     { icon: "🚩", label: "Start",        g: ["#5fb87a", "#214a2e"] },
    fuel:      { icon: "⛽", label: "Fuel / stop",  g: ["#cf7d3a", "#4a2c14"] },
    breakfast: { icon: "🍳", label: "Breakfast",    g: ["#d9a23d", "#4a3416"] },
    food:      { icon: "🍽️", label: "Food",         g: ["#d98a3d", "#52301a"] },
    viewpoint: { icon: "🌄", label: "Viewpoint",    g: ["#8475cc", "#2c2a58"] },
    waterfall: { icon: "💧", label: "Waterfall",    g: ["#3a9fd0", "#123a48"] },
    garden:    { icon: "🌿", label: "Nature",       g: ["#4cae6a", "#163a26"] },
    palace:    { icon: "⛩️", label: "Temple",       g: ["#c065a0", "#3a1830"] },
    museum:    { icon: "🏛️", label: "Museum",       g: ["#9a8cc0", "#2a2648"] },
    activity:  { icon: "🎯", label: "Activity",     g: ["#3a8fb0", "#123a48"] },
    beach:     { icon: "🏖️", label: "Beach",        g: ["#26b6c9", "#0a4a44"] },
    hotel:     { icon: "🏨", label: "Hotel",        g: ["#dd8f44", "#553016"] },
    depart:    { icon: "🌅", label: "Departure",    g: ["#dd8f44", "#3a2a1a"] },
    finish:    { icon: "🏁", label: "Finish",       g: ["#f0884a", "#5a2e16"] },
  };
  const typeOf = (t) => TYPE[t] || TYPE.activity;
  const LOGI = new Set(["start", "fuel", "breakfast", "food", "hotel", "depart", "beach", "finish"]);

  const DAYCOLORS = ["#35b06a", "#25b9cc", "#f0884a", "#c08cff", "#ff6f59", "#ffd66b", "#7bd88f", "#2fd6c3"];
  const dayColor = (i) => DAYCOLORS[i % DAYCOLORS.length];
  const ALL_COLOR = "#aebbb0";

  const days = () => (itin && Array.isArray(itin.days) ? itin.days : []);
  // badge: logistics → type emoji; sights → running number within the day
  function badgeFor(day, stop, si) {
    if (LOGI.has(stop.type)) return typeOf(stop.type).icon;
    let n = 0;
    for (let k = 0; k <= si; k++) if (!LOGI.has(day.stops[k].type)) n++;
    return String(n);
  }
  const hasPin = (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && (s.lat !== 0 || s.lng !== 0);

  // ---------- profile vocab + helpers ----------
  const PACE_LABEL = { relaxed: "Relaxed", balanced: "Balanced", packed: "Packed" };
  const BUDGET_LABEL = { shoestring: "Shoestring", mid: "Mid", comfort: "Comfort", lux: "Lux" };
  const MOBILITY_LABEL = { easy: "Easy pace", moderate: "Moderate", active: "Active" };
  const DIET_OPTS = ["halal", "veg", "vegan", "no-pork", "no-alcohol", "gluten-free"];
  const DIET_LABEL = { halal: "Halal", veg: "Vegetarian", vegan: "Vegan", "no-pork": "No pork", "no-alcohol": "No alcohol", "gluten-free": "Gluten-free" };
  // derive a Date for day index from profile.startDate (ISO yyyy-mm-dd), local-time, DST-safe
  function dayDate(idx) {
    const sd = profile && profile.startDate; if (!sd) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(sd); if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]); if (isNaN(d)) return null;
    d.setDate(d.getDate() + idx); return d;
  }
  let _dateFmt = null;
  function fmtDayDate(d) {
    if (!d) return "";
    try { if (!_dateFmt) _dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }); return _dateFmt.format(d); }
    catch (_) { return ""; }
  }
  const dateKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
  function fmtDuration(min) {
    min = Math.round(min); if (!(min > 0)) return "";
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }
  const mapsSearchUrl = (name) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(name || "");

  // ---------- money (integer minor units = whole IDR) ----------
  function moneyRp(n) {
    n = Math.round(+n || 0);
    if (n >= 1000000) { const m = n / 1000000; return "Rp " + (m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")) + "M"; }
    if (n >= 1000) { const k = n / 1000; return "Rp " + (k >= 100 ? Math.round(k) : k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, "")) + "k"; }
    return "Rp " + n;
  }
  // actual cost (in whole IDR) backing a stop's linked expense/receipt, if any (authed only)
  function actualCost(stop) {
    if (!stop.linkedExpenseId || !fullDoc) return null;
    const e = (fullDoc.expenses || []).find((x) => x.id === stop.linkedExpenseId);
    if (e) return Math.round(+e.amount || 0);
    const r = (fullDoc.receipts || []).find((x) => x.id === stop.linkedExpenseId);
    if (r) return Math.round(+r.grandTotal || 0);
    return null;
  }

  // ---------- time helpers ----------
  // parse a manual time string ("8:30", "08:30", "8.30", "8h30", "20:00") → minutes since midnight, or null
  function parseTimeMin(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{1,2})\s*[:.h]\s*(\d{2})/) || String(s).match(/^\s*(\d{1,2})\s*$/);
    if (!m) return null;
    let h = +m[1], min = m[2] != null ? +m[2] : 0;
    if (!(h >= 0 && h < 24) || !(min >= 0 && min < 60)) return null;
    return h * 60 + min;
  }
  const fmtClock = (mins) => { mins = ((Math.round(mins) % 1440) + 1440) % 1440; return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0"); };
  // OSRM leg duration (minutes) between two pinned stops for a mode; haversine fallback for walk; null otherwise
  function legMinutes(a, b, m) {
    const info = MODES[m] || MODES.car;
    if (info.road) { const leg = routeCache[legSig(a, b, m)]; return (leg && leg.line) ? leg.dur / 60 : null; }
    const km = haversineKm([a.lat, a.lng], [b.lat, b.lng]);
    if (m === "walk") return Math.max(1, km / 5 * 60);
    return null;   // flight/boat: don't guess travel time
  }
  // build a per-day timeline: returns { rows:[{arrival, leaveBy?, late}], endsAt, driveMin } | null
  function computeDayTimeline(day) {
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

  // ---------- API ----------
  async function api(path, opts = {}) {
    const headers = {};
    if (pass) headers["X-Passcode"] = pass;
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const res = await fetch(API + path, { method: opts.method || "GET", headers, body, credentials: "same-origin" });
    if (!res.ok) { const e = new Error("api " + res.status); e.code = res.status; try { e.body = await res.json(); } catch (_) {} throw e; }
    return res.status === 204 ? null : res.json();
  }

  // ---------- toast + spinner ----------
  let toastBox;
  function toast(msg, type) {
    if (!toastBox) { toastBox = document.createElement("div"); toastBox.className = "toasts"; document.body.appendChild(toastBox); }
    const t = document.createElement("div"); t.className = "toast" + (type === "err" ? " toast--err" : ""); t.textContent = msg;
    toastBox.appendChild(t); setTimeout(() => t.classList.add("in"), 10);
    setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, 3200);
  }
  function spin(on, msg) { const el = $("#spinner"); if (!el) return; if (msg) $("#spinMsg").textContent = msg; el.hidden = !on; }

  // ---------- Leaflet map ----------
  const map = L.map("map", { zoomControl: false, attributionControl: true, scrollWheelZoom: true, inertia: true, zoomSnap: 0.25 });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    { maxZoom: 20, subdomains: "abcd", attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.setView([-2, 118], 5);
  const layer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);   // road-following day routes (vectors sit below markers)
  const routeCache = {};                          // daySig -> [[lat,lng]...] (road) | null (failed) | "pending"
  let markers = [], flat = [], activeIdx = -1;

  // ---------- weather (open-meteo, keyless) ----------
  const wxCache = {};   // "lat,lng,date" -> {tmax,tmin,pop,code,sunrise,sunset} | null (failed) | "pending"
  const WX_EMOJI = (c) => {
    if (c === 0) return "☀️"; if (c <= 2) return "🌤"; if (c === 3) return "☁️";
    if (c <= 48) return "🌫"; if (c <= 57) return "🌦"; if (c <= 67) return "🌧";
    if (c <= 77) return "🌨"; if (c <= 82) return "🌦"; if (c <= 86) return "🌨";
    return "⛈";
  };
  function dayCentroid(day) {
    const pins = (day.stops || []).filter(hasPin); if (!pins.length) return null;
    let la = 0, ln = 0; pins.forEach((s) => { la += s.lat; ln += s.lng; });
    return { lat: la / pins.length, lng: ln / pins.length };
  }
  function wxKey(c, date) { return `${c.lat.toFixed(2)},${c.lng.toFixed(2)},${date}`; }
  async function fetchWeather(key, lat, lng, date) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&start_date=${date}&end_date=${date}`;
    try {
      const res = await fetch(url); if (!res.ok) throw 0;
      const j = await res.json(); const d = j && j.daily;
      if (!d || !d.time || !d.time.length) throw 0;
      wxCache[key] = { code: d.weather_code[0], tmax: d.temperature_2m_max[0], tmin: d.temperature_2m_min[0],
        pop: d.precipitation_probability_max ? d.precipitation_probability_max[0] : null,
        sunrise: (d.sunrise && d.sunrise[0]) || "", sunset: (d.sunset && d.sunset[0]) || "" };
    } catch (_) { wxCache[key] = null; }
  }
  // ensure forecasts for the visible day(s) that have a real date within ~16 days + pinned stops
  function ensureWeather() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let queued = false;
    viewDays().forEach((di) => {
      const day = days()[di], d = dayDate(di); if (!d) return;
      const diff = Math.round((d - today) / 86400000); if (diff < 0 || diff > 15) return;
      const c = dayCentroid(day); if (!c) return;
      const date = dateKey(d), key = wxKey(c, date);
      if (wxCache[key] === undefined) { wxCache[key] = "pending"; queued = true; fetchWeather(key, c.lat, c.lng, date).then(() => renderSheet()); }
    });
    return queued;
  }
  function weatherChipHtml(di) {
    const day = days()[di], d = dayDate(di); if (!d) return "";
    const c = dayCentroid(day); if (!c) return "";
    const w = wxCache[wxKey(c, dateKey(d))];
    if (!w || w === "pending") return "";
    const sun = (iso) => { const m = /T(\d{2}:\d{2})/.exec(iso || ""); return m ? m[1] : ""; };
    const pop = (w.pop != null && w.pop > 0) ? ` · 🌧${Math.round(w.pop)}%` : "";
    const rise = sun(w.sunrise), set = sun(w.sunset);
    const sunTxt = (rise && set) ? `<span class="wx-sun">🌅 ${rise} · 🌇 ${set}</span>` : "";
    return `<span class="day-chip wx-chip">${WX_EMOJI(w.code)} ${Math.round(w.tmax)}°/${Math.round(w.tmin)}°${pop}</span>${sunTxt}`;
  }

  const viewDays = () => currentDay === "all" ? days().map((_, i) => i) : (days()[currentDay] ? [currentDay] : []);
  function buildFlat() {
    flat = [];
    viewDays().forEach((di) => days()[di].stops.forEach((stop, si) => flat.push({ stop, di, si, color: dayColor(di) })));
  }
  function pinPts() { return flat.filter((f) => hasPin(f.stop)).map((f) => [f.stop.lat, f.stop.lng]); }
  function fitView(animate) {
    const pts = pinPts(); if (!pts.length) return;
    const desk = window.innerWidth >= 860;
    const pad = desk ? { paddingTopLeft: [70, 110], paddingBottomRight: [440, 60] }
      : { paddingTopLeft: [40, 150], paddingBottomRight: [40, window.innerHeight * 0.48] };
    const b = L.latLngBounds(pts);
    if (animate) map.flyToBounds(b, { ...pad, duration: 0.7 }); else map.fitBounds(b, pad);
  }
  // ---------- transport modes + per-leg, mode-aware routes ----------
  const MODES = {
    car:     { icon: "🚗", label: "Drive",   road: true },
    scooter: { icon: "🛵", label: "Scooter", road: true },
    taxi:    { icon: "🚕", label: "Taxi",    road: true },
    public:  { icon: "🚌", label: "Transit", road: true },
    bike:    { icon: "🚲", label: "Bike",    road: true },
    walk:    { icon: "🚶", label: "Walk",    road: false },
    boat:    { icon: "⛴️", label: "Boat",    road: false },
    flight:  { icon: "✈️", label: "Flight",  road: false },
  };
  const modeOf = (s) => (s && MODES[s.mode] ? s.mode : "car");   // how you ARRIVE at s (from the prior pinned stop)
  const legSig = (a, b, m) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)};${b.lat.toFixed(5)},${b.lng.toFixed(5)};${m}`;
  function haversineKm(A, B) {
    const R = 6371, d = (x) => x * Math.PI / 180;
    const dLat = d(B[0] - A[0]), dLng = d(B[1] - A[1]);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(d(A[0])) * Math.cos(d(B[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  // gentle queue so a multi-leg / All view doesn't hammer the OSRM demo (rate-limited)
  const legQueue = []; let legActive = 0;
  function pumpLegs() {
    while (legActive < 3 && legQueue.length) {
      const [sig, A, B] = legQueue.shift(); legActive++;
      fetchLeg(sig, A, B).then(() => { legActive--; drawRoutes(); refreshLegPills(); pumpLegs(); });
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
  function drawRoutes() {
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
  function legLabel(a, b) {
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
  function refreshLegPills() {
    document.querySelectorAll(".leg-pill[data-a]").forEach((el) => {
      const st = days()[+el.dataset.di] && days()[+el.dataset.di].stops;
      if (st && st[+el.dataset.a] && st[+el.dataset.b]) el.textContent = legLabel(st[+el.dataset.a], st[+el.dataset.b]);
    });
  }
  function renderMap() {
    layer.clearLayers(); markers = [];
    drawRoutes();
    flat.forEach((f, k) => {
      if (!hasPin(f.stop)) { markers.push(null); return; }
      const badge = badgeFor(days()[f.di], f.stop, f.si);
      const logi = LOGI.has(f.stop.type);
      const icon = L.divIcon({ className: "mk-wrap" + (f.stop.done ? " is-done" : ""), html: `<div class="mk ${logi ? "is-logi" : ""}" style="--mk:${f.color}"><span>${badge}</span></div>`,
        iconSize: [30, 30], iconAnchor: [15, 35], popupAnchor: [0, -34] });
      const m = L.marker([f.stop.lat, f.stop.lng], { icon, riseOnHover: true }).addTo(layer);
      m.bindPopup(`<div class="pop-badge">${esc(typeOf(f.stop.type).label)}</div><div class="pop-name">${esc(f.stop.name)}</div>`);
      m.on("click", () => activateStop(k, "map"));
      markers.push(m);
    });
    fitView(false);
  }

  // ---------- sheet content ----------
  function dirUrl(day) {
    const pts = day.stops.filter(hasPin).map((s) => `${s.lat},${s.lng}`);
    return pts.length ? "https://www.google.com/maps/dir/" + pts.join("/") : null;
  }
  function costChip(stop) {
    if (!stop.linkedExpenseId) return "";
    if (fullDoc) {
      const e = (fullDoc.expenses || []).find((x) => x.id === stop.linkedExpenseId);
      if (e) return `<a class="cost-chip" href="/split/?t=${encodeURIComponent(tripId)}" title="View in Bills">Rp ${Number(e.amount).toLocaleString("en-US")}</a>`;
      const r = (fullDoc.receipts || []).find((x) => x.id === stop.linkedExpenseId);
      if (r) return `<a class="cost-chip" href="/split/?t=${encodeURIComponent(tripId)}">Rp ${Number(r.grandTotal).toLocaleString("en-US")}</a>`;
      return `<span class="cost-chip warn" title="linked cost was removed">⚠ cost</span>`;
    }
    return `<a class="cost-chip" href="/split/?t=${encodeURIComponent(tripId)}" title="has a linked cost">💸 cost</a>`;
  }
  function stopCard(di, si, gi, tl) {
    const day = days()[di], stop = day.stops[si], t = typeOf(stop.type);
    const time = stop.time ? `<span class="stop-time">${esc(stop.time)}</span>` : "";
    // computed timeline row: arrival + visit duration line, optional "leave prev by" badge + late warning
    const row = tl && tl.rows[si];
    let timeline = "";
    if (row && row.arrival != null) {
      const dur = (stop.durationMin > 0) ? ` · ${fmtDuration(stop.durationMin)} here` : "";
      const fixed = parseTimeMin(stop.time) != null;
      timeline = `<div class="stop-clock${row.late ? " late" : ""}">${fixed ? "🕒" : "arr"} ${fmtClock(row.arrival)}${dur}${row.late ? ' <span class="late-tag">⚠ tight</span>' : ""}</div>`;
    }
    const leaveBy = (row && row.leaveBy != null && si > 0)
      ? `<span class="leave-by" title="leave the previous stop by this time">leave by ${fmtClock(row.leaveBy)}</span>` : "";
    const lk = stop.links || {};
    const mapsHref = lk.maps || stop.url || "";
    const chip = (href, label) => href ? `<a class="stop-chip" href="${esc(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${label}</a>` : "";
    const linksRow = [chip(mapsHref, "🗺 Maps"), chip(lk.booking, "🏨 Book"), chip(lk.tickets, "🎟 Tickets")].filter(Boolean).join("");
    const links = linksRow ? `<div class="stop-links">${linksRow}</div>` : "";
    const dur = (stop.durationMin > 0) ? `<span class="dur-pill" title="visit duration">⏱ ${fmtDuration(stop.durationMin)}</span>` : "";
    const nopin = hasPin(stop) ? "" : `<span class="nopin" title="no map pin yet">no pin</span>`;
    let prevPin = -1;
    if (hasPin(stop)) for (let j = si - 1; j >= 0; j--) { if (hasPin(day.stops[j])) { prevPin = j; break; } }
    const legPill = (prevPin >= 0 || leaveBy) ? `<div class="leg-row">${prevPin >= 0 ? `<span class="leg-pill" data-di="${di}" data-a="${prevPin}" data-b="${si}">${esc(legLabel(day.stops[prevPin], stop))}</span>` : ""}${leaveBy}</div>` : "";
    const edit = editing ? `
      <div class="stop-edit">
        <button class="se mv" data-act="up" data-di="${di}" data-si="${si}" title="Move up" aria-label="Move up">▲</button>
        <button class="se mv" data-act="down" data-di="${di}" data-si="${si}" title="Move down" aria-label="Move down">▼</button>
        <button class="se" data-act="cost" data-di="${di}" data-si="${si}" title="Link a cost">💸</button>
        <button class="se" data-act="edit" data-di="${di}" data-si="${si}" title="Edit">✎</button>
      </div>` : "";
    return `
      <li class="tl-item anim ${stop.done ? "is-done" : ""}" data-gi="${gi}" data-di="${di}" data-si="${si}" style="animation-delay:${Math.min(0.6, 0.05 * gi + 0.08)}s">
        <div class="tl-node ${LOGI.has(stop.type) ? "is-logi" : ""}" ${authed ? `data-sid="1" data-act="done" data-di="${di}" data-si="${si}" role="button" tabindex="0" aria-label="${stop.done ? "Mark not done" : "Mark done"}"` : ""}><span class="nd-badge">${badgeFor(day, stop, si)}</span><span class="nd-check">✓</span></div>
        <button class="stop" data-idx="${gi}">
          <div class="thumb" style="--thumb:linear-gradient(150deg, ${t.g[0]}, ${t.g[1]})"><span>${t.icon}</span></div>
          <div class="stop-body">
            ${legPill}
            <div class="stop-top"><span class="stop-name">${esc(stop.name)}</span>${time}</div>
            <div class="stop-sub"><span class="type">${esc(t.label)}</span>${dur}${nopin}${costChip(stop)}</div>
            ${timeline}
            ${stop.note ? `<p class="stop-note">${esc(stop.note)}</p>` : ""}
            ${links}
          </div>
        </button>
        ${edit}
      </li>`;
  }
  function dayHead(di, tl) {
    const day = days()[di], dir = dirUrl(day);
    const dateText = day.dateLabel || fmtDayDate(dayDate(di));   // manual dateLabel wins; else derive from startDate
    const addDay = editing ? `<button class="eb-btn sm" data-act="editday" data-di="${di}">✎ day</button>
      <button class="eb-btn sm" data-act="dayup" data-di="${di}" title="Move day earlier">▲</button>
      <button class="eb-btn sm" data-act="daydown" data-di="${di}" title="Move day later">▼</button>` : "";
    // schedule chip: ends ~HH:MM · {driving total}
    let schedChip = "";
    if (tl && tl.endsAt != null) {
      const drive = tl.driveMin > 0 ? ` · 🚗 ${fmtDuration(tl.driveMin)}` : "";
      schedChip = `<span class="day-chip">ends ~${fmtClock(tl.endsAt)}${drive}</span>`;
    }
    const wxChip = weatherChipHtml(di);
    const budget = budgetGaugeHtml(di);
    const shareDay = `<button class="eb-btn sm" data-act="shareday" data-di="${di}" title="Share this day">↗ Share</button>`;
    const chips = (schedChip || wxChip) ? `<div class="day-chips">${schedChip}${wxChip}</div>` : "";
    return `
      <div class="day-head">
        <span class="day-eyebrow">${esc(day.label || "Day " + (di + 1))}${dateText ? `<span class="pill">· ${esc(dateText)}</span>` : ""}</span>
        <h2 class="day-title">${esc(day.title || "Day " + (di + 1))}</h2>
        ${chips}
        ${budget}
        <div class="day-actions">
          ${dir ? `<a class="route-btn" href="${dir}" target="_blank" rel="noopener">Open route ↗</a>` : ""}
          ${shareDay}
          ${addDay}
        </div>
      </div>`;
  }
  // budget gauge — AUTHED users only (never expose amounts to public)
  function budgetGaugeHtml(di) {
    if (!authed) return "";
    const day = days()[di], stops = day.stops || [];
    let planned = 0, actual = 0, hasActual = false;
    stops.forEach((s) => { if (s.cost > 0) planned += s.cost; const a = actualCost(s); if (a != null) { actual += a; hasActual = true; if (!(s.cost > 0)) planned += a; } });
    const target = (profile && profile.dailyTarget > 0) ? profile.dailyTarget : 0;
    if (!planned && !hasActual && !target) return "";
    const over = target && planned > target;
    const pct = target ? Math.min(100, Math.round(planned / target * 100)) : (planned ? 100 : 0);
    const targetTxt = target ? ` / ${moneyRp(target)} planned` : " planned";
    const actualTxt = hasActual ? `<span class="bg-actual">actual ${moneyRp(actual)}</span>` : "";
    return `<div class="budget-gauge${over ? " over" : ""}">
      <div class="bg-bar"><span style="width:${pct}%"></span></div>
      <div class="bg-label"><span class="bg-planned">${moneyRp(planned)}${targetTxt}</span>${actualTxt}</div>
    </div>`;
  }
  // dates summary text e.g. "Sat 13 Jun – Mon 15 Jun"
  function datesSummary() {
    const n = days().length, s = dayDate(0); if (!s || !n) return "";
    const e = dayDate(n - 1);
    return n > 1 ? `${fmtDayDate(s)} – ${fmtDayDate(e)}` : fmtDayDate(s);
  }
  // authed/editing compact summary chips (may show money-ish budget level, never the daily target text)
  function profileSummaryHtml() {
    if (!profile) return "";
    const chips = [];
    const dates = datesSummary(); if (dates) chips.push(`<span class="ps-chip">🗓 <b>${esc(dates)}</b></span>`);
    if (profile.pace && PACE_LABEL[profile.pace]) chips.push(`<span class="ps-chip">⚡ ${esc(PACE_LABEL[profile.pace])}</span>`);
    if (profile.budgetLevel && BUDGET_LABEL[profile.budgetLevel]) chips.push(`<span class="ps-chip">💰 ${esc(BUDGET_LABEL[profile.budgetLevel])}</span>`);
    (profile.dietary || []).forEach((d) => chips.push(`<span class="ps-chip">🍽 ${esc(DIET_LABEL[d] || d)}</span>`));
    const grp = groupSummary(); if (grp) chips.push(`<span class="ps-chip">👥 ${esc(grp)}</span>`);
    return chips.length ? `<div class="profile-summary">${chips.join("")}</div>` : "";
  }
  function groupSummary() {
    const a = +profile.adults || 0, k = +profile.kids || 0; if (!a && !k) return "";
    const p = []; if (a) p.push(`${a} adult${a > 1 ? "s" : ""}`); if (k) p.push(`${k} kid${k > 1 ? "s" : ""}`);
    return p.join(" · ");
  }
  // public, non-money "good to know" strip
  function goodToKnowHtml() {
    if (authed || !profile) return "";
    const bits = [];
    if ((profile.dietary || []).includes("halal")) bits.push("Halal-friendly");
    else if ((profile.dietary || []).length) bits.push((profile.dietary || []).map((d) => DIET_LABEL[d] || d).join(", "));
    if (profile.pace && PACE_LABEL[profile.pace]) bits.push(PACE_LABEL[profile.pace] + " pace");
    if (profile.mobility && MOBILITY_LABEL[profile.mobility]) bits.push(MOBILITY_LABEL[profile.mobility]);
    if ((+profile.kids || 0) > 0) bits.push("Family");
    if (!bits.length) return "";
    return `<div class="good-to-know"><span class="gtk-label">Good to know</span>${bits.map((b) => `<span class="gtk-chip">${esc(b)}</span>`).join("")}</div>`;
  }

  function renderSheet() {
    const inner = $("#sheet-inner");
    if (!days().length) {
      inner.innerHTML = `<div class="empty-itin">
        <div class="empty-emoji">🗺️</div>
        <h2>No itinerary yet</h2>
        <p>${authed ? "Add the first day, or generate one with AI." : "Ask the organizer to add a plan."}</p>
        ${authed ? profileSummaryHtml() : goodToKnowHtml()}
        <div class="empty-cta">
          ${admin && aiEnabled ? `<button class="solid-btn" id="emptyAi">✨ Generate with AI</button>` : ""}
          <button class="eb-btn" id="emptyAdd">＋ Add the first day</button>
        </div>
      </div>`;
      const ea = $("#emptyAdd"); if (ea) ea.addEventListener("click", () => requireAuth(() => openDay(null)));
      const eai = $("#emptyAi"); if (eai) eai.addEventListener("click", () => $("#aiBtn").click());
      return;
    }
    let gi = 0; let html = nowStripHtml() + (authed ? profileSummaryHtml() : goodToKnowHtml());
    const list = currentDay === "all" ? days().map((_, i) => i) : [currentDay];
    list.forEach((di) => {
      const tl = computeDayTimeline(days()[di]);
      const cards = days()[di].stops.map((_, si) => stopCard(di, si, gi++, tl)).join("");
      html += `<section class="day-group">${dayHead(di, tl)}<ol class="timeline">${cards}</ol>
        ${editing ? `<button class="eb-btn add-stop" data-act="addstop" data-di="${di}">＋ Add stop</button>` : ""}</section>`;
    });
    if (authed) html += tripBudgetHtml();
    if (editing) html += `<button class="eb-btn add-day" data-act="addday">＋ Add day</button>`;
    inner.innerHTML = html;

    inner.querySelectorAll(".stop").forEach((b) => b.addEventListener("click", () => activateStop(Number(b.dataset.idx), "sheet")));
    inner.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation(); onEditAct(b.dataset.act, Number(b.dataset.di), Number(b.dataset.si));
    }));
    ensureWeather();
    applyNowNext();
  }
  // trip-total budget (authed) — sum vs dailyTarget × days
  function tripBudgetHtml() {
    if (!authed) return "";
    let planned = 0, actual = 0, hasActual = false;
    days().forEach((day) => (day.stops || []).forEach((s) => {
      if (s.cost > 0) planned += s.cost; const a = actualCost(s);
      if (a != null) { actual += a; hasActual = true; if (!(s.cost > 0)) planned += a; }
    }));
    const target = (profile && profile.dailyTarget > 0) ? profile.dailyTarget * days().length : 0;
    if (!planned && !hasActual && !target) return "";
    const over = target && planned > target;
    const pct = target ? Math.min(100, Math.round(planned / target * 100)) : (planned ? 100 : 0);
    const targetTxt = target ? ` / ${moneyRp(target)} planned` : " planned";
    const actualTxt = hasActual ? `<span class="bg-actual">actual ${moneyRp(actual)}</span>` : "";
    return `<div class="trip-budget"><span class="tb-label">Trip budget</span>
      <div class="budget-gauge${over ? " over" : ""}">
        <div class="bg-bar"><span style="width:${pct}%"></span></div>
        <div class="bg-label"><span class="bg-planned">${moneyRp(planned)}${targetTxt}</span>${actualTxt}</div>
      </div></div>`;
  }

  // ---------- NOW / NEXT ----------
  // which day index is "today" within the trip, or -1
  function todayDayIndex() {
    const n = days().length; if (!n || !(profile && profile.startDate)) return -1;
    const tk = dateKey(new Date());
    for (let i = 0; i < n; i++) if (dateKey(dayDate(i)) === tk) return i;
    return -1;
  }
  // find the current + next stop on today's day from computed arrival times
  function nowNext() {
    const di = todayDayIndex(); if (di < 0) return null;
    const day = days()[di], tl = computeDayTimeline(day); if (!tl) return null;
    const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
    let cur = -1, next = -1;
    for (let i = 0; i < day.stops.length; i++) {
      const arr = tl.rows[i] && tl.rows[i].arrival; if (arr == null) continue;
      if (arr <= mins) cur = i; else { next = i; break; }
    }
    // refine "current" — within its visit duration window it's current; once past, it's the last reached
    return { di, cur, next, tl, mins };
  }
  function nowStripHtml() {
    const nn = nowNext(); if (!nn || (nn.cur < 0 && nn.next < 0)) return "";
    const day = days()[nn.di];
    const curS = nn.cur >= 0 ? day.stops[nn.cur] : null;
    const nextS = nn.next >= 0 ? day.stops[nn.next] : null;
    let main, sub = "";
    if (curS) {
      main = `<span class="ns-kicker">Now</span><span class="ns-name">${esc(curS.name)}</span>`;
      if (nextS) { const inMin = Math.max(0, Math.round((nn.tl.rows[nn.next].arrival) - nn.mins)); sub = `<span class="ns-next">next: ${esc(nextS.name)} · in ${fmtDuration(inMin) || "now"}</span>`; }
    } else if (nextS) {
      const inMin = Math.max(0, Math.round((nn.tl.rows[nn.next].arrival) - nn.mins));
      main = `<span class="ns-kicker">Up next</span><span class="ns-name">${esc(nextS.name)}</span>`;
      sub = `<span class="ns-next">in ${fmtDuration(inMin) || "now"}</span>`;
    } else return "";
    return `<div class="now-strip" data-di="${nn.di}" data-cur="${nn.cur}" data-next="${nn.next}"><div class="ns-main">${main}</div>${sub}</div>`;
  }
  // tag the matching card + pin with .is-now / .is-next (only meaningful in single-day or all view)
  function applyNowNext() {
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
  // on boot mid-trip, scroll to the current (or next) stop
  function scrollToNow() {
    const nn = nowNext(); if (!nn) return;
    const si = nn.cur >= 0 ? nn.cur : nn.next; if (si < 0) return;
    const li = document.querySelector(`.tl-item[data-di="${nn.di}"][data-si="${si}"]`);
    if (li) li.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  let nowTimer = null;
  function startNowTicker() {
    if (nowTimer) clearInterval(nowTimer);
    nowTimer = setInterval(() => {
      if (document.hidden) return;
      if (todayDayIndex() < 0) return;
      const strip = $(".now-strip");
      if (strip) { const fresh = nowStripHtml(); if (fresh) { const tmp = document.createElement("div"); tmp.innerHTML = fresh; strip.replaceWith(tmp.firstElementChild); } }
      else { const html = nowStripHtml(); if (html) { const inner = $("#sheet-inner"); if (inner) inner.insertAdjacentHTML("afterbegin", html); } }
      applyNowNext();
    }, 60000);
  }

  function activateStop(i, source) {
    if (i === activeIdx && source === "sheet") i = -1;
    activeIdx = i;
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

  // ---------- tabs ----------
  function buildTabs() {
    const tabs = $("#tabs");
    const dayTabs = days().map((d, i) => `
      <button class="tab" role="tab" data-idx="${i}" aria-selected="${i === currentDay}" style="--tab-color:${dayColor(i)}">
        <span class="dot"></span>${esc(d.label || "Day " + (i + 1))}</button>`).join("");
    const allTab = days().length > 1 ? `<button class="tab tab-all" role="tab" data-idx="all" aria-selected="${currentDay === "all"}" style="--tab-color:${ALL_COLOR}"><span class="dot dot-all"></span>All</button>` : "";
    tabs.innerHTML = dayTabs + allTab;
    tabs.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => selectDay(b.dataset.idx === "all" ? "all" : Number(b.dataset.idx))));
  }
  function selectDay(i, initial) {
    currentDay = i; activeIdx = -1;
    const isAll = i === "all";
    document.documentElement.style.setProperty("--day", isAll ? ALL_COLOR : dayColor(i));
    $("#tabs").querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.idx === String(i)));
    try { history.replaceState(null, "", location.pathname + location.search + (isAll ? "#all" : "#day" + (Number(i) + 1))); } catch (_) {}
    buildFlat(); renderSheet(); renderMap();
    if (!initial) fitView(true);
  }

  // ---------- render all ----------
  function renderAll() {
    $("#brand-title").textContent = (data && data.trip && data.trip.name) || itin.title || "Itinerary";
    { const eb = $("#brand-eyebrow"); const t = (itin.title && data && data.trip && itin.title !== data.trip.name) ? itin.title : ""; eb.textContent = t; eb.hidden = !t; }
    $("#trip-chip").textContent = days().length ? `${days().length} day${days().length > 1 ? "s" : ""}` : "";
    const bl = $("#bills-link"); if (bl && tripId) bl.href = "/split/?t=" + encodeURIComponent(tripId);
    if (typeof currentDay === "number" && !days()[currentDay]) currentDay = days().length ? 0 : "all";
    buildTabs(); selectDay(currentDay, true);
    applyAuthUI();
  }
  function applyAuthUI() {
    document.body.classList.toggle("is-editing", editing);
    $("#editToggle").textContent = editing ? "Done" : "Edit";
    $("#editToggle").setAttribute("aria-pressed", editing ? "true" : "false");
    document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !admin; });
    $("#profileBtn").hidden = !(authed && editing);
    $("#aiBtn").hidden = !(admin && aiEnabled);
    $("#logoutBtn").hidden = !admin;
  }

  // ---------- editing ----------
  function requireAuth(fn) { if (authed) return fn(); lockIntent = fn; showLock(); }
  async function saveItin(optimisticMsg) {
    try { await api(`/trips/${tripId}/itinerary`, { method: "PUT", body: { title: itin.title || "", days: itin.days } });
      if (optimisticMsg) toast(optimisticMsg); await reload(true); }
    catch (e) { toast(e.code === 401 ? "Enter the passcode to edit" : "Save failed", "err"); if (e.code === 401) { authed = false; showLock(); } reload(true); }
  }
  function onEditAct(act, di, si) {
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
  function moveStop(di, si, d) { const a = days()[di].stops; const j = si + d; if (j < 0 || j >= a.length) return; [a[si], a[j]] = [a[j], a[si]]; renderSheet(); renderMap(); saveItin(); }
  function toggleDone(di, si) {
    if (!authed) return requireAuth(() => toggleDone(di, si));
    const s = days()[di].stops[si]; s.done = !s.done;
    renderSheet(); renderMap(); saveItin(s.done ? "Marked done" : "Marked not done");
  }
  function moveDay(di, d) { const a = days(); const j = di + d; if (j < 0 || j >= a.length) return; [a[di], a[j]] = [a[j], a[di]]; currentDay = j; renderAll(); saveItin(); }

  // stop dialog
  const stopDlg = $("#stopDialog"); let stopEdit = null, stopPrefill = null, pickMode = false;
  // build the Type <select> from the TYPE catalogue so labels never drift from the map
  $("#stType").innerHTML = Object.keys(TYPE).map((k) => `<option value="${k}">${TYPE[k].icon} ${esc(TYPE[k].label)}</option>`).join("");
  $("#stMode").innerHTML = Object.keys(MODES).map((k) => `<option value="${k}">${MODES[k].icon} ${MODES[k].label}</option>`).join("");
  function setCoords(c) {
    $("#stLat").value = c ? c.lat : ""; $("#stLng").value = c ? c.lng : "";
    const el = $("#stCoords"); el.textContent = c ? `📍 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}` : "No pin yet"; el.classList.toggle("set", !!c);
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
  function openStop(di, si, prefill) {
    stopEdit = { di, si };
    const s = prefill || (si != null ? days()[di].stops[si] : {});
    const lk = s.links || {};
    $("#stopTitle").textContent = si != null ? "Edit stop" : "Add stop";
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
    pickMode = true; document.body.classList.add("picking"); toast("Tap the map to place the pin");
  });
  map.on("click", (e) => {
    if (!pickMode) return;
    pickMode = false; document.body.classList.remove("picking");
    const pf = stopPrefill || {}; pf.lat = +e.latlng.lat.toFixed(6); pf.lng = +e.latlng.lng.toFixed(6);
    openStop(stopEdit.di, stopEdit.si, pf);
  });
  $("#stCancel").addEventListener("click", () => stopDlg.close());
  stopDlg.addEventListener("cancel", (e) => { e.preventDefault(); stopDlg.close(); });
  $("#stDelete").addEventListener("click", async () => {
    const { di, si } = stopEdit; const nm = (days()[di].stops[si] && days()[di].stops[si].name) || "this stop";
    stopDlg.close();
    if (!(await confirmAsk("Delete stop?", `“${nm}” will be removed from the day.`, "Delete", true))) return;
    days()[di].stops.splice(si, 1); renderSheet(); renderMap(); saveItin("Stop removed");
  });
  $("#stopForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#stName").value.trim();
    if (!name) { $("#stErr").textContent = "Name is required"; $("#stErr").hidden = false; $("#stName").focus(); return; }
    const lat = parseFloat($("#stLat").value), lng = parseFloat($("#stLng").value);
    const mapsUrl = $("#stUrl").value.trim();
    const links = { maps: mapsUrl, booking: $("#stLinkBooking").value.trim(), tickets: $("#stLinkTickets").value.trim() };
    const s = { name, type: $("#stType").value, mode: $("#stMode").value, time: $("#stTime").value.trim(), url: mapsUrl,
      links, durationMin: Math.max(0, parseInt($("#stDuration").value, 10) || 0),
      note: $("#stNote").value.trim(), lat: Number.isFinite(lat) ? lat : 0, lng: Number.isFinite(lng) ? lng : 0 };
    const { di, si } = stopEdit;
    if (si != null) { const o = days()[di].stops[si]; s.id = o.id; s.linkedExpenseId = o.linkedExpenseId; s.done = o.done; s.cost = o.cost; days()[di].stops[si] = s; }
    else days()[di].stops.push(s);
    stopDlg.close(); renderSheet(); renderMap(); saveItin("Saved");
  });

  // day dialog
  const dayDlg = $("#dayDialog"); let dayEdit = null;
  function openDay(di) {
    dayEdit = di;
    const d = di != null ? days()[di] : {};
    $("#dayTitle").textContent = di != null ? "Edit day" : "Add day";
    $("#dyTitle").value = d.title || ""; $("#dyLabel").value = d.label || ""; $("#dyDate").value = d.dateLabel || "";
    $("#dyDelete").hidden = di == null;
    dayDlg.showModal(); setTimeout(() => $("#dyTitle").focus(), 30);
  }
  $("#dyCancel").addEventListener("click", () => dayDlg.close());
  dayDlg.addEventListener("cancel", (e) => { e.preventDefault(); dayDlg.close(); });
  $("#dyDelete").addEventListener("click", async () => {
    if (dayEdit == null) return;
    const d = itin.days[dayEdit]; const nm = (d && (d.title || d.label)) || "this day"; const n = (d && d.stops) ? d.stops.length : 0;
    dayDlg.close();
    if (!(await confirmAsk("Delete day?", `“${nm}”${n ? ` and its ${n} stop${n > 1 ? "s" : ""}` : ""} will be removed.`, "Delete", true))) return;
    itin.days.splice(dayEdit, 1); currentDay = itin.days.length ? 0 : "all"; renderAll(); saveItin("Day removed");
  });
  $("#dayForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#dyTitle").value.trim(); if (!title) return;
    const d = { label: $("#dyLabel").value.trim() || ("Day " + ((dayEdit != null ? dayEdit : itin.days.length) + 1)), dateLabel: $("#dyDate").value.trim(), title };
    if (dayEdit != null) { d.id = itin.days[dayEdit].id; d.stops = itin.days[dayEdit].stops; itin.days[dayEdit] = d; }
    else { d.stops = []; itin.days.push(d); currentDay = itin.days.length - 1; }
    dayDlg.close(); renderAll(); saveItin("Saved");
  });

  // trip profile dialog
  const profileDlg = $("#profileDialog");
  // build dietary chips from the vocab
  $("#pfDietary").innerHTML = DIET_OPTS.map((k) => `<button type="button" class="chip" data-diet="${k}">${esc(DIET_LABEL[k] || k)}</button>`).join("");
  $("#pfDietary").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) b.classList.toggle("on"); });
  function openProfile() {
    requireAuth(async () => {
      // make sure we have the FULL profile (incl. dailyTarget/homeCurrency) before editing
      if (!fullDoc) { try { fullDoc = await api(`/trips/${tripId}`); } catch (_) {} }
      const p = (fullDoc && fullDoc.profile) || profile || {};
      $("#pfStartDate").value = p.startDate || "";
      $("#pfPace").value = p.pace || ""; $("#pfBudgetLevel").value = p.budgetLevel || "";
      $("#pfDailyTarget").value = p.dailyTarget > 0 ? p.dailyTarget : "";
      $("#pfInterests").value = (p.interests || []).join(", ");
      const diet = new Set(p.dietary || []);
      $("#pfDietary").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", diet.has(c.dataset.diet)));
      $("#pfAdults").value = p.adults > 0 ? p.adults : ""; $("#pfKids").value = p.kids > 0 ? p.kids : "";
      $("#pfMobility").value = p.mobility || ""; $("#pfHomeCurrency").value = p.homeCurrency || "";
      $("#pfErr").hidden = true;
      profileDlg.showModal(); setTimeout(() => $("#pfStartDate").focus(), 30);
    });
  }
  $("#profileBtn").addEventListener("click", openProfile);
  $("#pfCancel").addEventListener("click", () => profileDlg.close());
  profileDlg.addEventListener("cancel", (e) => { e.preventDefault(); profileDlg.close(); });
  $("#profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const interests = $("#pfInterests").value.split(",").map((s) => s.trim()).filter(Boolean);
    const dietary = [...$("#pfDietary").querySelectorAll(".chip.on")].map((c) => c.dataset.diet);
    const body = {
      startDate: $("#pfStartDate").value || "",
      pace: $("#pfPace").value || "", budgetLevel: $("#pfBudgetLevel").value || "",
      dailyTarget: Math.max(0, parseInt($("#pfDailyTarget").value, 10) || 0),
      interests, dietary,
      adults: Math.max(0, parseInt($("#pfAdults").value, 10) || 0),
      kids: Math.max(0, parseInt($("#pfKids").value, 10) || 0),
      mobility: $("#pfMobility").value || "", homeCurrency: $("#pfHomeCurrency").value.trim(),
    };
    const go = $("#pfSave"); go.disabled = true;
    try {
      fullDoc = await api(`/trips/${tripId}/profile`, { method: "PUT", body });
      profileDlg.close(); _dateFmt = null; await reload(true); toast("Trip profile saved");
    } catch (err) {
      $("#pfErr").textContent = err.code === 401 ? "Enter the passcode to edit" : "Save failed"; $("#pfErr").hidden = false;
      if (err.code === 401) { authed = false; profileDlg.close(); showLock(); }
    } finally { go.disabled = false; }
  });

  // ---------- share ----------
  function shareTrip(di) {
    const name = (data && data.trip && data.trip.name) || itin.title || "Our trip";
    const n = days().length;
    let url = location.origin + location.pathname + location.search;
    let text = name;
    const dates = datesSummary();
    if (di != null && days()[di]) {
      const d = days()[di];
      url += "#day" + (di + 1);
      text = `${name} — ${d.title || d.label || "Day " + (di + 1)}`;
    } else {
      const parts = [];
      if (n) parts.push(`${n} day${n > 1 ? "s" : ""}`);
      if (dates) parts.push(dates);
      if (parts.length) text += " · " + parts.join(" · ");
    }
    const payload = { title: name, text, url };
    if (navigator.share) { navigator.share(payload).catch(() => {}); return; }
    const copy = `${text}\n${url}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copy).then(() => toast("Link copied"), () => toast("Couldn't copy", "err"));
    } else { toast(copy); }
  }
  $("#shareBtn").addEventListener("click", () => shareTrip(null));

  // edit toggle + login
  $("#editToggle").addEventListener("click", () => { if (!editing) return requireAuth(() => { editing = true; renderAll(); }); editing = false; renderAll(); });
  $("#logoutBtn").addEventListener("click", async () => { try { await api("/logout", { method: "POST" }); } catch (_) {} admin = false; applyAuthUI(); toast("Logged out"); });

  // ---------- cost link ----------
  const costDlg = $("#costDialog"); let costEdit = null;
  function openCost(di, si) {
    requireAuth(async () => {
      if (!fullDoc) { try { fullDoc = await api(`/trips/${tripId}`); } catch (_) {} }
      costEdit = { di, si };
      const stop = days()[di].stops[si];
      const sel = $("#costSelect"); sel.innerHTML = `<option value="">— none —</option>`;
      (fullDoc ? fullDoc.expenses || [] : []).forEach((e) => { const o = document.createElement("option"); o.value = e.id; o.textContent = `${e.title} · Rp ${Number(e.amount).toLocaleString("en-US")}`; sel.appendChild(o); });
      (fullDoc ? fullDoc.receipts || [] : []).forEach((r) => { const o = document.createElement("option"); o.value = r.id; o.textContent = `${r.title} · Rp ${Number(r.grandTotal).toLocaleString("en-US")}`; sel.appendChild(o); });
      sel.value = stop.linkedExpenseId || ""; $("#costAmount").value = ""; $("#costErr").hidden = true;
      $("#costUnlink").hidden = !stop.linkedExpenseId;
      costDlg.showModal();
    });
  }
  $("#costCancel").addEventListener("click", () => costDlg.close());
  costDlg.addEventListener("cancel", (e) => { e.preventDefault(); costDlg.close(); });
  $("#costUnlink").addEventListener("click", () => { const { di, si } = costEdit; days()[di].stops[si].linkedExpenseId = ""; costDlg.close(); renderSheet(); saveItin("Unlinked"); });
  $("#costForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { di, si } = costEdit; const stop = days()[di].stops[si];
    const sel = $("#costSelect").value; const amt = Math.max(0, parseInt($("#costAmount").value, 10) || 0);
    try {
      let linkId = sel;
      if (!sel && amt > 0) {
        const ppl = (fullDoc ? fullDoc.people || [] : []);
        const shares = {}; ppl.forEach((p) => shares[p.id] = 1);
        const payer = ppl[0] ? ppl[0].id : "";
        const out = await api(`/trips/${tripId}/expenses`, { method: "POST", body: { title: stop.name, amount: amt, payerId: payer, splitMode: "EVENLY", shares } });
        fullDoc = out; linkId = out.expenses[out.expenses.length - 1].id;
      }
      stop.linkedExpenseId = linkId || "";
      costDlg.close(); renderSheet(); saveItin("Cost linked");
    } catch (err) { $("#costErr").textContent = err.code === 401 ? "Passcode needed" : "Couldn't link"; $("#costErr").hidden = false; }
  });

  // ---------- AI generate ----------
  const aiDlg = $("#aiDialog");
  function hasProfileSignal() {
    const p = (fullDoc && fullDoc.profile) || profile; if (!p) return false;
    return !!(p.pace || p.budgetLevel || (p.interests || []).length || (p.dietary || []).length || p.mobility || p.startDate || p.adults || p.kids);
  }
  $("#aiBtn").addEventListener("click", () => {
    $("#aiDest").value = data && data.trip ? data.trip.name : ""; $("#aiDays").value = 3;
    const p = (fullDoc && fullDoc.profile) || profile;
    $("#aiNotes").value = (p && (p.interests || []).length) ? (p.interests || []).join(", ") : "";
    $("#aiProfileHint").hidden = !hasProfileSignal();
    $("#aiErr").hidden = true; aiDlg.showModal(); setTimeout(() => $("#aiDest").focus(), 30);
  });
  $("#aiCancel").addEventListener("click", () => aiDlg.close());
  aiDlg.addEventListener("cancel", (e) => { e.preventDefault(); aiDlg.close(); });
  $("#aiForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dest = $("#aiDest").value.trim(); if (!dest) return;
    const go = $("#aiGo"); go.disabled = true; spin(true, "Drafting your itinerary…");
    try {
      const out = await api(`/trips/${tripId}/itinerary/generate`, { method: "POST", body: { destination: dest, days: parseInt($("#aiDays").value, 10) || 3, notes: $("#aiNotes").value.trim() } });
      draft = out.draft; aiDlg.close();
      itin = JSON.parse(JSON.stringify(draft)); currentDay = 0; editing = false; renderAll();
      $("#draftBanner").hidden = false;
    } catch (err) {
      $("#aiErr").textContent = err.code === 503 ? "AI isn't configured on the server." : err.code === 504 ? "Timed out — try again." : err.code === 401 ? "Log in as admin." : "Generation failed.";
      $("#aiErr").hidden = false;
    } finally { go.disabled = false; spin(false); }
  });
  function endDraft() { draft = null; $("#draftBanner").hidden = true; }
  $("#draftDiscard").addEventListener("click", () => { endDraft(); reload(true); });
  $("#draftRegen").addEventListener("click", () => { endDraft(); $("#aiBtn").click(); });
  $("#draftReplace").addEventListener("click", async () => {
    if (!(await confirmAsk("Replace itinerary?", "This overwrites the entire saved plan with the AI draft.", "Replace", true))) return;
    itin = JSON.parse(JSON.stringify(draft)); endDraft(); await saveItin("Itinerary saved");
  });
  $("#draftAppend").addEventListener("click", async () => {
    try { const cur = await api(`/trips/${tripId}/itinerary`); const base = (cur && cur.itinerary) || { title: "", days: [] };
      base.days = (base.days || []).concat(draft.days); if (!base.title) base.title = draft.title;
      itin = base; endDraft(); await saveItin("Days appended"); } catch (_) { toast("Append failed", "err"); }
  });

  // ---------- confirm ----------
  const cfDlg = $("#confirmDialog"); let cfResolve = null;
  function confirmAsk(title, body, okLabel, danger) {
    return new Promise((res) => { cfResolve = res; $("#cfTitle").textContent = title; $("#cfBody").textContent = body || ""; const ok = $("#cfOk"); ok.textContent = okLabel || "Confirm"; ok.classList.toggle("danger", !!danger); cfDlg.showModal(); });
  }
  $("#cfOk").addEventListener("click", () => { cfDlg.close(); if (cfResolve) cfResolve(true); cfResolve = null; });
  $("#cfCancel").addEventListener("click", () => { cfDlg.close(); if (cfResolve) cfResolve(false); cfResolve = null; });
  cfDlg.addEventListener("cancel", (e) => { e.preventDefault(); cfDlg.close(); if (cfResolve) cfResolve(false); cfResolve = null; });

  // ---------- lock ----------
  function showLock(msg) { const el = $("#lock"); el.hidden = false; if (msg) $("#lockErr").textContent = msg; setTimeout(() => $("#lockInput").focus(), 50); }
  $("#lockForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const v = $("#lockInput").value.trim(); if (!v) return;
    pass = v;
    try {
      fullDoc = await api(`/trips/${tripId}`);   // verifies passcode
      localStorage.setItem(PASS_KEY, pass); authed = true;
      if (fullDoc && fullDoc.profile) profile = fullDoc.profile;   // promote to full profile (incl dailyTarget)
      try { const me = await api("/me"); admin = !!me.admin; aiEnabled = !!me.aiEnabled; } catch (_) {}
      $("#lock").hidden = true; $("#lockErr").textContent = "";
      renderSheet(); applyAuthUI();
      const fn = lockIntent; lockIntent = null; if (typeof fn === "function") fn();
    } catch (err) {
      pass = ""; const c = $("#lockForm"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
      $("#lockErr").textContent = "Wrong passcode"; $("#lockInput").select();
    }
  });

  // ---------- sheet drag (from the original itinerary app) ----------
  const sheet = $("#sheet"), grab = $("#sheet-grab"), scroller = $("#sheet-scroll");
  const peekTranslate = () => Math.max(0, sheet.offsetHeight - window.innerHeight * 0.46);
  const hiddenTranslate = () => Math.max(0, sheet.offsetHeight - 36);
  const stateTranslate = (s) => s === "full" ? 0 : s === "hidden" ? hiddenTranslate() : peekTranslate();
  function setSheetState(s) { sheet.dataset.state = s; document.body.classList.toggle("sheet-full", s === "full"); document.body.classList.toggle("sheet-hidden", s === "hidden"); sheet.style.setProperty("--sheet-y", stateTranslate(s) + "px"); }
  let drag = null;
  function onDown(e) { if (window.innerWidth >= 860) return; drag = { startY: e.clientY, start: stateTranslate(sheet.dataset.state), moved: 0 }; sheet.classList.add("dragging"); window.addEventListener("pointermove", onMove, { passive: false }); window.addEventListener("pointerup", onUp); }
  function onMove(e) { if (!drag) return; drag.moved = e.clientY - drag.startY; sheet.style.setProperty("--sheet-y", Math.min(hiddenTranslate(), Math.max(0, drag.start + drag.moved)) + "px"); e.preventDefault(); }
  function onUp() { if (!drag) return; sheet.classList.remove("dragging"); const peek = peekTranslate(), hid = hiddenTranslate(); let cur = Math.min(hid, Math.max(0, drag.start + drag.moved)); if (drag.moved < -60) cur -= peek * 0.4; else if (drag.moved > 60) cur += peek * 0.4; const cand = [["full", 0], ["peek", peek], ["hidden", hid]]; let best = cand[0]; cand.forEach((c) => { if (Math.abs(c[1] - cur) < Math.abs(best[1] - cur)) best = c; }); setSheetState(best[0]); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); drag = null; }
  grab.addEventListener("pointerdown", onDown);
  grab.addEventListener("click", () => { if (Math.abs((drag && drag.moved) || 0) > 6) return; setSheetState(sheet.dataset.state === "full" ? "peek" : "full"); });
  const hideBtn = $("#sheet-hide"); if (hideBtn) hideBtn.addEventListener("click", (e) => { e.stopPropagation(); setSheetState("hidden"); });
  scroller.addEventListener("pointerdown", (e) => { if (window.innerWidth >= 860) return; if (scroller.scrollTop <= 0 && sheet.dataset.state === "full") onDown(e); });

  // ---------- locate / recenter ----------
  const locLayer = L.layerGroup().addTo(map); let meMarker = null, meCircle = null;
  function onPos(p) { const ll = [p.coords.latitude, p.coords.longitude], acc = p.coords.accuracy || 0;
    if (!meMarker) { meCircle = L.circle(ll, { radius: acc, className: "me-acc", stroke: false, interactive: false }).addTo(locLayer);
      meMarker = L.marker(ll, { icon: L.divIcon({ className: "me-wrap", html: `<div class="me-dot"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(locLayer);
      map.flyTo(ll, Math.max(map.getZoom(), 14), { duration: 0.8 }); } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(acc); }
    $("#locate").classList.add("on"); }
  $("#locate").addEventListener("click", () => { if (!navigator.geolocation) return; if (meMarker) return map.flyTo(meMarker.getLatLng(), 15, { duration: 0.6 }); navigator.geolocation.getCurrentPosition(onPos, () => toast("Couldn't get your location", "err"), { enableHighAccuracy: true, timeout: 12000 }); });
  $("#recenter").addEventListener("click", () => fitView(true));
  let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { map.invalidateSize(); if (window.innerWidth < 860) setSheetState(sheet.dataset.state || "peek"); fitView(false); }, 150); });

  // ---------- load / poll ----------
  function adopt(d) {
    data = d; itin = (d && d.itinerary) || { title: "", days: [] }; lastRev = d ? d.rev : -1;
    // authed full profile (incl dailyTarget) wins; else the sanitized public subset
    profile = (authed && fullDoc && fullDoc.profile) || (d && d.profile) || null;
    _dateFmt = null;
  }
  async function reload(silent) {
    try { const d = await api(`/trips/${tripId}/itinerary`); adopt(d); if (!silent) {} renderAll(); }
    catch (e) { if (!silent) $("#sheet-inner").innerHTML = `<div class="empty-itin"><p>Couldn't load this trip.</p></div>`; }
  }
  function startDayFromHash() { if (/#all/i.test(location.hash)) return "all"; const m = (location.hash || "").match(/day(\d+)/i); return m ? Math.max(0, Number(m[1]) - 1) : 0; }
  // with no #hash, land on today's day when today is within the trip's date range
  function defaultDay() {
    const n = days().length; if (!n || !(profile && profile.startDate)) return 0;
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
      if (pass) { try { fullDoc = await api(`/trips/${tripId}`); authed = true; if (fullDoc && fullDoc.profile) profile = fullDoc.profile; const me = await api("/me"); admin = !!me.admin; aiEnabled = !!me.aiEnabled; } catch (_) { pass = ""; } }
      currentDay = location.hash ? startDayFromHash() : defaultDay();
      renderAll();
      setSheetState("peek");
      setTimeout(() => map.invalidateSize(), 60);
      startNowTicker();
      if (!location.hash && todayDayIndex() >= 0) setTimeout(scrollToNow, 600);
    } catch (e) {
      $("#sheet-inner").innerHTML = `<div class="empty-itin"><div class="empty-emoji">🗺️</div><h2>Trip not found</h2><p>Check the link, or go to <a href="/">Tripkit</a>.</p></div>`;
      setSheetState("peek");
    }
    setInterval(async () => {
      if (editing || draft || document.querySelector("dialog[open]") || document.hidden) return;
      try { const d = await api(`/trips/${tripId}/itinerary`); if (d && d.rev !== lastRev) { adopt(d); renderAll(); } } catch (_) {}
    }, 6000);
  }
  window.addEventListener("hashchange", () => { const h = startDayFromHash(); if (h !== currentDay) selectDay(h); });
  boot();
})();
