/* ============================================================
   Bali Highlands Ride — itinerary app
   Data is inlined so the page works opened directly (file://).
   ============================================================ */

const TRIP = {
  title: "Bali Highlands Ride",
  eyebrow: "Bali · 4-day ride",
  datesLabel: "Sat 13 – Tue 16 June 2026",
  riders: 6,
  nights: 3,
  baseHotel: "Bedugul Asri Village",
  baseRating: 4.8,
  tileUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 19,
  colors: ["#35b06a", "#25b9cc", "#f0884a", "#b07ad9"],
  intros: [
    "North out of Tuban into the highlands — Nungnung's gorge and Lake Beratan views before checking in at Container Smart Stay up in Pancasari. (Botanical garden + strawberries pushed to Day 2.)",
    "A relaxed loop round Lake Beratan — halal breakfast, the botanical garden, pick-your-own strawberries and a warung lunch — then north past Gitgit Waterfall and down to Lovina for the night. Easy waterfall only, no big gorge climbs.",
    "East across the island to Karangasem — the Tirta Gangga water palace, then over the hill to Amed to snorkel Jemeluk Bay and bed down by the sea. East-facing coast, so it's a sunrise spot.",
    "Last leg: early checkout and the long run back southwest — one fuel-and-coffee break near Candidasa — to drop the rental car at Park 23 by 6pm."
  ],
  days: [
    {
      label: "Day 1", weekday: "Saturday", dateLabel: "Sat 13 Jun", title: "Tuban → Bedugul",
      routeUrl: "https://www.google.com/maps/dir/-8.7374945,115.1770982/-8.544474,115.2142638/-8.3297697,115.2293907/-8.2688315,115.1666525/-8.249012,115.137847",
      waypoints: [[-8.7374945,115.1770982],[-8.544474,115.2142638],[-8.3297697,115.2293907],[-8.2688315,115.1666525],[-8.249012,115.137847]],
      stops: [
        { badge:"S", type:"start", name:"Tuban — start (Jl. Kediri)", note:"Roll out 08:30. Fuel up before leaving town if you can.", lat:-8.7374945, lng:115.1770982, time:"08:30", url:"https://www.google.com/maps/search/?api=1&query=-8.7374945,115.1770982" },
        { badge:"⛽", type:"fuel", name:"Fuel + minimart (Abiansemal)", note:"Meet-up & refuel point for all 6. Minimart, open 24h.", lat:-8.544474, lng:115.2142638, rating:4.1, ratingCount:556, url:"https://maps.google.com/?cid=4537072022720391647" },
        { badge:"1", type:"waterfall", name:"Nungnung Waterfall", note:"Entry ~15–20k/person. ~500 steps down & up — you can swim.", lat:-8.3297697, lng:115.2293907, rating:4.8, ratingCount:954, url:"https://maps.google.com/?cid=10004879087583290136" },
        { badge:"2", type:"viewpoint", name:"Lake Beratan viewpoint", note:"Lake views and photos before the hotel.", lat:-8.2688315, lng:115.1666525, rating:4.8, ratingCount:393, url:"https://maps.google.com/?cid=2806623557277632363" },
        { badge:"🏨", type:"hotel", name:"Container Smart Stay", note:"Overnight 1 — eco shipping-container rooms in Pancasari, up by the twin lakes. Check in & dinner; bring a jacket, evenings 15–18°C.", lat:-8.249012, lng:115.137847, url:"https://www.google.com/maps/search/?api=1&query=-8.249012,115.137847" }
      ]
    },
    {
      label: "Day 2", weekday: "Sunday", dateLabel: "Sun 14 Jun", title: "Bedugul gardens → Gitgit → Lovina",
      routeUrl: "https://www.google.com/maps/dir/-8.249012,115.137847/-8.27566,115.16398/-8.2761215,115.1542029/-8.2633689,115.1811978/-8.266483,115.164192/-8.1935621,115.1350753/-8.160609,115.0299151/-8.1616,115.041",
      waypoints: [[-8.249012,115.137847],[-8.27566,115.16398],[-8.2761215,115.1542029],[-8.2633689,115.1811978],[-8.266483,115.164192],[-8.1935621,115.1350753],[-8.160609,115.0299151],[-8.1616,115.041]],
      stops: [
        { badge:"🏨", type:"depart", name:"Depart — Container Smart Stay", note:"Relaxed start: a loop round Lake Beratan, then north to the coast. Bring cash for entries & parking.", lat:-8.249012, lng:115.137847, url:"https://www.google.com/maps/search/?api=1&query=-8.249012,115.137847" },
        { badge:"🍳", type:"breakfast", name:"Breakfast — As Siddiq (halal)", note:"Halal Lombok/Taliwang warung by the lake, in front of Ulun Danu temple. Ayam bakar & nasi to start the day.", lat:-8.27566, lng:115.16398, url:"https://www.google.com/maps/search/?api=1&query=-8.27566,115.16398" },
        { badge:"1", type:"garden", name:"Bali Botanical Garden", note:"Yesterday's skipped stop. Orchids and cool air — golf carts available for the group.", lat:-8.2761215, lng:115.1542029, rating:4.6, ratingCount:18210, url:"https://maps.google.com/?cid=9890911261838179781" },
        { badge:"2", type:"strawberry", name:"Joko Strawberry", note:"Pick your own by Lake Beratan, ~50k/kg + a fresh juice.", lat:-8.2633689, lng:115.1811978, rating:4.7, ratingCount:40, url:"https://maps.google.com/?cid=16771699654002220658" },
        { badge:"🍽️", type:"food", name:"Lunch — Magoes Warung Bedugul", note:"Garden warung off the main road, generous Indonesian plates. Ask for halal/no-pork (or Warung Muslim Bu Hj. Marfu'ah nearby).", lat:-8.266483, lng:115.164192, rating:4.5, ratingCount:760, url:"https://www.google.com/maps/search/?api=1&query=-8.266483,115.164192" },
        { badge:"3", type:"waterfall", name:"Gitgit Waterfall", note:"Easiest fall on the way — paved boardwalk, ~15 min each way (use the lower car park to skip the steep bit). Only if you don't fancy a big climb; otherwise push on to Lovina.", lat:-8.1935621, lng:115.1350753, url:"https://www.google.com/maps/search/?api=1&query=-8.1935621,115.1350753" },
        { badge:"🏖️", type:"beach", name:"Lovina Beach", note:"Black sand — sunset, swim, dinner. No night ride back; you're sleeping in Lovina.", lat:-8.160609, lng:115.0299151, url:"https://maps.google.com/?cid=12352326454605907792" },
        { badge:"🏨", type:"hotel", name:"Penginapan Sedap Malam", note:"Overnight 2 in Lovina — simple guesthouse near Celuk Agung Beach, off Jl. Seririt–Singaraja.", lat:-8.1616, lng:115.041, url:"https://www.google.com/maps/search/?api=1&query=-8.1616,115.041" }
      ]
    },
    {
      label: "Day 3", weekday: "Monday", dateLabel: "Mon 15 Jun", title: "Lovina → Amed",
      routeUrl: "https://www.google.com/maps/dir/-8.1616,115.041/-8.41194,115.58722/-8.3344,115.6647/-8.33458,115.64094",
      waypoints: [[-8.1616,115.041],[-8.41194,115.58722],[-8.3344,115.6647],[-8.33458,115.64094]],
      stops: [
        { badge:"🏨", type:"depart", name:"Depart — Sedap Malam (Lovina)", note:"Long drive east today (~3 hrs to Amed) — fuel up and roll out after breakfast. Bring cash for entries & parking.", lat:-8.1616, lng:115.041, url:"https://www.google.com/maps/search/?api=1&query=-8.1616,115.041" },
        { badge:"1", type:"palace", name:"Tirta Gangga Water Palace", note:"Royal water gardens in Karangasem — koi ponds, fountains and stepping-stone paths across the pools. Entry ~50k pp. Flat, shady, easy walking.", lat:-8.41194, lng:115.58722, url:"https://www.google.com/maps/search/?api=1&query=-8.41194,115.58722" },
        { badge:"🏖️", type:"beach", name:"Jemeluk Bay (Amed)", note:"Calm black-sand bay for a snorkel — coral garden and the sunken statues just off the shore. Gear rents cheap on the beach.", lat:-8.3344, lng:115.6647, url:"https://www.google.com/maps/search/?api=1&query=-8.3344,115.6647" },
        { badge:"🏨", type:"hotel", name:"Stay in Amed", note:"Overnight 3 by the sea (pin is an estimate — send the booking link and I'll fix it). East-facing coast, so it's an easy sunrise over the water with Gunung Agung behind you.", lat:-8.33458, lng:115.64094, url:"https://www.google.com/maps/search/?api=1&query=-8.33458,115.64094" }
      ]
    },
    {
      label: "Day 4", weekday: "Tuesday", dateLabel: "Tue 16 Jun", title: "Amed → Park 23",
      routeUrl: "https://www.google.com/maps/dir/-8.33458,115.64094/-8.50947,115.56924/-8.7371405,115.1757056",
      waypoints: [[-8.33458,115.64094],[-8.50947,115.56924],[-8.7371405,115.1757056]],
      stops: [
        { badge:"🏨", type:"depart", name:"Depart — Amed", note:"Early checkout, no dawdling: it's ~3 hrs back and the rental car is due at Park 23 by 6pm. Top up fuel before you leave the coast.", lat:-8.33458, lng:115.64094, url:"https://www.google.com/maps/search/?api=1&query=-8.33458,115.64094" },
        { badge:"⛽", type:"fuel", name:"Fuel + break (Candidasa)", note:"Last easy meet-up: refuel, coffee, snack near Candidasa before the long bypass run southwest.", lat:-8.50947, lng:115.56924, url:"https://www.google.com/maps/search/?api=1&query=-8.50947,115.56924" },
        { badge:"🏁", type:"finish", name:"Finish: Park 23", note:"Jl. Kediri, Tuban — drop the rental car back by 6pm. End of the trip.", lat:-8.7371405, lng:115.1757056, rating:4.3, ratingCount:206, url:"https://maps.google.com/?cid=14512193383187398948" }
      ]
    }
  ],
  reminders: [
    { key:"Cash", icon:"💵", text:"For entries & parking: Nungnung (~15–20k pp), Botanical Garden (~30k pp), Gitgit (~20k pp), strawberries (~50k/kg), Tirta Gangga (~50k pp)." },
    { key:"Fuel", icon:"⛽", text:"Top up at the meet-up stops — stations are sparse in the mountains and on the Amed coast." },
    { key:"Layers", icon:"🧥", text:"Mountain evenings drop to 15–18°C. Take the foggy switchbacks slow." },
    { key:"Shoes", icon:"👟", text:"Non-slip — the waterfall steps and pool stones stay wet." },
    { key:"Car", icon:"🚗", text:"Day 4 is the return — leave Amed early and drop the rental at Park 23 by 6pm Tuesday." }
  ]
};

const TYPE = {
  start:      { icon:"🏍️", label:"Start",            g:["#3aa06a","#173f29"] },
  fuel:       { icon:"⛽",  label:"Fuel stop",        g:["#6b7a83","#2a3338"] },
  waterfall:  { icon:"💧",  label:"Waterfall",        g:["#2a9fc4","#0c3a4a"] },
  strawberry: { icon:"🍓",  label:"Strawberry farm",  g:["#d24f70","#591b32"] },
  garden:     { icon:"🌺",  label:"Botanical garden", g:["#43a85f","#184028"] },
  breakfast:  { icon:"🍳",  label:"Breakfast",        g:["#e0a83a","#5a3e12"] },
  food:       { icon:"🍽️",  label:"Food stop",        g:["#d98a3d","#52301a"] },
  viewpoint:  { icon:"🌄",  label:"Viewpoint",        g:["#8475cc","#2c2a58"] },
  palace:     { icon:"⛲",  label:"Water palace",     g:["#3a8fb0","#123a48"] },
  hotel:      { icon:"🏨",  label:"Hotel",            g:["#dd8f44","#553016"] },
  depart:     { icon:"🌅",  label:"Departure",        g:["#dd8f44","#3a2a1a"] },
  beach:      { icon:"🏖️",  label:"Beach",            g:["#26b6c9","#0a4a44"] },
  checkout:   { icon:"🛎️",  label:"Check-out",        g:["#dd8f44","#553016"] },
  finish:     { icon:"🏁",  label:"Finish",           g:["#f0884a","#5a2e16"] }
};

const $ = (s, r = document) => r.querySelector(s);
const isLogi = (badge) => !/^\d+$/.test(badge);
const ALL_COLOR = "#aebbb0";   // neutral accent for the "All days" view

/* ---------- Done state (per-browser, localStorage) ---------- */
const DONE_KEY = "balitrip:done:v1";
let DONE = new Set();
try { DONE = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]")); } catch (e) {}

function toggleDone(sid) {
  const on = !DONE.has(sid);
  if (on) DONE.add(sid); else DONE.delete(sid);
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...DONE])); } catch (e) {}
  document.querySelectorAll(`.tl-item[data-sid="${sid}"]`).forEach(li => li.classList.toggle("is-done", on));
  markers.forEach((m, k) => {
    if (flatStops[k] && flatStops[k].sid === sid) {
      const el = m.getElement();
      if (el) el.classList.toggle("is-done", on);
    }
  });
}

/* ---------- Map ---------- */
const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  scrollWheelZoom: true,
  tap: true,
  inertia: true,
  zoomSnap: 0.25,
  worldCopyJump: false
});
L.tileLayer(TRIP.tileUrl, { maxZoom: TRIP.maxZoom, subdomains: "abcd", attribution: TRIP.tileAttribution }).addTo(map);
map.attributionControl.setPrefix(false);

const layer = L.layerGroup().addTo(map);
let markers = [];
let activeIdx = -1;
let flatStops = [];   // current view, flattened: { stop, dayIdx, color } — index lines up with markers + .stop cards

function dayColor(i) { return TRIP.colors[i]; }
function viewDays() { return currentDay === "all" ? TRIP.days.map((_, i) => i) : [currentDay]; }

function buildView() {
  flatStops = [];
  viewDays().forEach(di => {
    TRIP.days[di].stops.forEach((stop, si) => flatStops.push({ stop, dayIdx: di, color: dayColor(di), sid: di + "-" + si }));
  });
}

function fitView(animate) {
  const pts = viewDays().flatMap(di => TRIP.days[di].waypoints);
  const b = L.latLngBounds(pts);
  const isDesktop = window.innerWidth >= 860;
  const pad = isDesktop
    ? { paddingTopLeft: [70, 90], paddingBottomRight: [470, 60] }
    : { paddingTopLeft: [50, 150], paddingBottomRight: [50, window.innerHeight * 0.48] };
  if (animate) map.flyToBounds(b, { ...pad, duration: 0.8, easeLinearity: 0.25 });
  else map.fitBounds(b, pad);
}

function renderMap() {
  layer.clearLayers();
  markers = [];

  // routes: one per visible day, each in its day colour (soft glow + crisp animated line)
  viewDays().forEach(di => {
    const day = TRIP.days[di];
    const color = dayColor(di);
    // road-following geometry (routes.js); fall back to straight waypoint hops
    const line = (typeof ROUTES !== "undefined" && ROUTES[di]) || day.waypoints;
    L.polyline(line, { color, weight: 11, opacity: 0.16, lineCap: "round", lineJoin: "round" }).addTo(layer);
    const main = L.polyline(line, { color, weight: 3.5, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(layer);
    const path = main.getElement();
    if (path) {
      try {
        const len = path.getTotalLength();
        path.style.setProperty("--len", len);
        path.classList.add("route-path");
      } catch (e) { /* no SVG length in some renderers */ }
    }
  });

  // markers: parallel to flatStops so data-idx lines up with the sheet cards
  flatStops.forEach((item, k) => {
    const { stop, color } = item;
    const logi = isLogi(stop.badge);
    const icon = L.divIcon({
      className: "mk-wrap" + (DONE.has(item.sid) ? " is-done" : ""),
      html: `<div class="mk ${logi ? "is-logi" : ""}" style="--mk:${color}"><span>${stop.badge}</span></div>`,
      iconSize: [30, 30], iconAnchor: [15, 35], popupAnchor: [0, -38]
    });
    const m = L.marker([stop.lat, stop.lng], { icon, riseOnHover: true }).addTo(layer);
    m.bindPopup(
      `<div class="pop-badge">${stop.badge} · ${TYPE[stop.type].label}</div><div class="pop-name">${stop.name}</div>`,
      { closeButton: true, offset: [0, -2] }
    );
    m.on("click", () => activateStop(k, "map"));
    markers.push(m);
  });

  fitView(false);
}

/* ---------- Sheet content ---------- */
function ratingHTML(stop) {
  if (!stop.rating) return `<span class="type">${TYPE[stop.type].label}</span>`;
  const count = stop.ratingCount ? ` <span style="color:var(--muted-2)">(${stop.ratingCount.toLocaleString()})</span>` : "";
  return `<span class="rating"><span class="star">★</span>${stop.rating}${count}</span><span class="sep">·</span><span class="type">${TYPE[stop.type].label}</span>`;
}

function roundTrip(day) {
  const a = day.waypoints[0], b = day.waypoints[day.waypoints.length - 1];
  return Math.abs(a[0] - b[0]) < 0.002 && Math.abs(a[1] - b[1]) < 0.002;
}

// One Google Maps directions link covering every stop of the trip (consecutive
// duplicates — e.g. the hotel between days — collapsed).
function allLocationsUrl() {
  const pts = [];
  TRIP.days.forEach(d => d.waypoints.forEach(w => {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last[0] - w[0]) > 1e-6 || Math.abs(last[1] - w[1]) > 1e-6) pts.push(w);
  }));
  return "https://www.google.com/maps/dir/" + pts.map(p => `${p[0]},${p[1]}`).join("/");
}

function stopCardHTML(stop, gi, delay, sid) {
  const t = TYPE[stop.type];
  const logi = isLogi(stop.badge);
  const time = stop.time ? `<span class="stop-time">${stop.time}</span>` : "";
  const done = DONE.has(sid) ? " is-done" : "";
  return `
    <li class="tl-item anim${done}" data-sid="${sid}" style="animation-delay:${delay}s">
      <div class="tl-node ${logi ? "is-logi" : ""}" data-sid="${sid}" role="button" tabindex="0" aria-label="Mark ${stop.name} as done" title="Mark as done">
        <span class="nd-badge">${stop.badge}</span><span class="nd-check" aria-hidden="true">✓</span>
      </div>
      <button class="stop" data-idx="${gi}">
        <div class="thumb" style="--thumb:linear-gradient(150deg, ${t.g[0]}, ${t.g[1]})"><span>${t.icon}</span></div>
        <div class="stop-body">
          <div class="stop-top">
            <span class="stop-name">${stop.name}</span>
            ${time}
          </div>
          <div class="stop-sub">${ratingHTML(stop)}</div>
          <p class="stop-note">${stop.note}</p>
          <a class="stop-link" href="${stop.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
            Open in Maps
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>
        </div>
      </button>
    </li>`;
}

function tailHTML() {
  const remindersHTML = TRIP.reminders.map(r => `
    <div class="reminder">
      <span class="r-key"><i>${r.icon}</i>${r.key}</span>
      <span class="r-text">${r.text}</span>
    </div>`).join("");
  return `
    <p class="legend anim" style="animation-delay:.2s">Numbers = sights · ⛽ fuel · 🍽️ food · 🏨 hotel · 🏖️ beach · 🏁 finish<br><span class="legend-hint">Tap a stop's circle to mark it done (saved on this device).</span></p>

    <section class="reminders">
      <div class="section-label">Before you ride</div>
      <div class="reminder-grid">${remindersHTML}</div>
    </section>

    <footer class="sheet-foot">
      <span>Stays · <b>Container Smart Stay</b> · <b>Sedap Malam</b> · <b>Amed</b></span>
      <span><b>${TRIP.riders}</b> riders · ${TRIP.datesLabel} · prices in IDR (k = thousand)</span>
    </footer>`;
}

function daySheetHTML(dayIdx) {
  const day = TRIP.days[dayIdx];
  const sights = day.stops.filter(s => !isLogi(s.badge)).length;
  const trip = roundTrip(day) ? "Round trip" : "One-way";
  const stops = day.stops.map((stop, i) => stopCardHTML(stop, i, 0.06 * i + 0.12, dayIdx + "-" + i)).join("");

  return `
    <div class="day-head">
      <span class="day-eyebrow anim" style="animation-delay:.02s">${day.label}<span class="pill">· ${day.dateLabel}</span></span>
      <h2 class="day-title anim" style="animation-delay:.06s"><span class="wd">${day.weekday}</span><br>${day.title}</h2>
      <p class="day-intro anim" style="animation-delay:.1s">${TRIP.intros[dayIdx]}</p>
      <div class="day-actions anim" style="animation-delay:.14s">
        <a class="route-btn" href="${day.routeUrl}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          Open route
        </a>
        <span class="meta-chip"><b>${sights}</b> sights</span>
        <span class="meta-chip">${trip}</span>
      </div>
    </div>

    <ol class="timeline">${stops}</ol>
    ${tailHTML()}`;
}

function allSheetHTML() {
  const totalSights = TRIP.days.reduce((n, d) => n + d.stops.filter(s => !isLogi(s.badge)).length, 0);
  let gi = 0;
  const groups = TRIP.days.map((day, di) => {
    const cards = day.stops.map((stop, si) => {
      const idx = gi++;
      return stopCardHTML(stop, idx, Math.min(0.9, 0.03 * idx + 0.1), di + "-" + si);
    }).join("");
    return `
      <section class="day-group" style="--day:${dayColor(di)}">
        <div class="group-head">
          <span class="group-dot"></span>
          <span class="group-label">${day.label}<span class="group-date"> · ${day.dateLabel}</span></span>
          <span class="group-title">${day.title}</span>
          <a class="group-route" href="${day.routeUrl}" target="_blank" rel="noopener">Route ›</a>
        </div>
        <ol class="timeline">${cards}</ol>
      </section>`;
  }).join("");

  return `
    <div class="day-head">
      <span class="day-eyebrow anim" style="animation-delay:.02s">All days<span class="pill">· ${TRIP.datesLabel}</span></span>
      <h2 class="day-title anim" style="animation-delay:.06s"><span class="wd">The whole route</span><br>Every stop</h2>
      <p class="day-intro anim" style="animation-delay:.1s">The whole route on one map — ${totalSights} sights across ${TRIP.days.length} days, from Bedugul down to Lovina and east to Amed.</p>
      <div class="day-actions anim" style="animation-delay:.14s">
        <a class="route-btn" href="${allLocationsUrl()}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="11" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
          Open all in Maps
        </a>
        <span class="meta-chip"><b>${totalSights}</b> sights</span>
        <span class="meta-chip"><b>${TRIP.days.length}</b> days</span>
      </div>
    </div>

    ${groups}
    ${tailHTML()}`;
}

function renderSheet() {
  $("#sheet-inner").innerHTML = currentDay === "all" ? allSheetHTML() : daySheetHTML(currentDay);
  $("#sheet-inner").querySelectorAll(".stop").forEach(btn => {
    btn.addEventListener("click", () => activateStop(Number(btn.dataset.idx), "sheet"));
  });
  $("#sheet-inner").querySelectorAll(".tl-node[data-sid]").forEach(node => {
    node.addEventListener("click", (e) => { e.stopPropagation(); toggleDone(node.dataset.sid); });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDone(node.dataset.sid); }
    });
  });
}

/* ---------- Stop activation ---------- */
function activateStop(i, source) {
  if (i === activeIdx && source === "sheet") { i = -1; } // toggle off when re-tapping in list
  activeIdx = i;

  document.querySelectorAll(".stop").forEach(el => el.classList.toggle("is-active", Number(el.dataset.idx) === i));
  markers.forEach((m, mi) => {
    const wrap = m.getElement();
    if (wrap) wrap.classList.toggle("is-active", mi === i);
  });

  if (i < 0) return;
  const stop = flatStops[i].stop;

  if (source === "sheet") {
    const offsetLat = window.innerWidth >= 860 ? 0 : -0.012; // nudge pin above the sheet on mobile
    map.flyTo([stop.lat + offsetLat, stop.lng], 14.5, { duration: 0.7 });
    setTimeout(() => markers[i].openPopup(), 480);
  } else {
    markers[i].openPopup();
    const card = document.querySelector(`.stop[data-idx="${i}"]`);
    if (card) {
      if (sheet.dataset.state !== "full") setSheetState("full");
      setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    }
  }
}

/* ---------- Tabs ---------- */
let currentDay = 0;

function buildTabs() {
  const tabs = $("#tabs");
  const dayTabs = TRIP.days.map((d, i) => `
    <button class="tab" role="tab" data-idx="${i}" aria-selected="${i === 0}" style="--tab-color:${TRIP.colors[i]}">
      <span class="dot"></span>${d.label}
    </button>`).join("");
  const allTab = `
    <button class="tab tab-all" role="tab" data-idx="all" aria-selected="false" style="--tab-color:${ALL_COLOR}">
      <span class="dot dot-all"></span>All
    </button>`;
  tabs.innerHTML = dayTabs + allTab;
  tabs.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.idx;
      selectDay(v === "all" ? "all" : Number(v));
    });
  });
}

function selectDay(i, initial) {
  if (i === currentDay && !initial) return;
  currentDay = i;
  activeIdx = -1;
  const isAll = i === "all";
  document.documentElement.style.setProperty("--day", isAll ? ALL_COLOR : TRIP.colors[i]);

  $("#tabs").querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.idx === String(i)));
  $("#brand-eyebrow").textContent = TRIP.eyebrow;
  try { history.replaceState(null, "", isAll ? "#all" : "#day" + (i + 1)); } catch (e) {}

  buildView();
  renderSheet();
  renderMap();
  if (!initial) fitView(true);
}

/* ---------- Bottom sheet drag ---------- */
const sheet = $("#sheet");
const grab = $("#sheet-grab");
const scroller = $("#sheet-scroll");

function peekTranslate() {
  // leave ~46% of the viewport showing the map
  return Math.max(0, sheet.offsetHeight - window.innerHeight * 0.46);
}
const HIDDEN_HANDLE = 36;   // px of the sheet (the grab pill) left visible when hidden
function hiddenTranslate() { return Math.max(0, sheet.offsetHeight - HIDDEN_HANDLE); }
function stateTranslate(state) {
  if (state === "full") return 0;
  if (state === "hidden") return hiddenTranslate();
  return peekTranslate();
}
function setSheetState(state) {
  sheet.dataset.state = state;
  document.body.classList.toggle("sheet-full", state === "full");
  document.body.classList.toggle("sheet-hidden", state === "hidden");
  sheet.style.setProperty("--sheet-y", stateTranslate(state) + "px");
}

let drag = null;
function onDown(e) {
  if (window.innerWidth >= 860) return;
  const startY = (e.touches ? e.touches[0].clientY : e.clientY);
  drag = { startY, start: stateTranslate(sheet.dataset.state), moved: 0 };
  sheet.classList.add("dragging");
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
}
function onMove(e) {
  if (!drag) return;
  const dy = e.clientY - drag.startY;
  drag.moved = dy;
  const next = Math.min(hiddenTranslate(), Math.max(0, drag.start + dy));
  sheet.style.setProperty("--sheet-y", next + "px");
  e.preventDefault();
}
function onUp() {
  if (!drag) return;
  sheet.classList.remove("dragging");
  const peek = peekTranslate(), hid = hiddenTranslate();
  let current = Math.min(hid, Math.max(0, drag.start + drag.moved));
  // velocity bias toward the swipe direction
  if (drag.moved < -60) current -= peek * 0.4;
  else if (drag.moved > 60) current += peek * 0.4;
  // snap to nearest of full / peek / hidden
  const cand = [["full", 0], ["peek", peek], ["hidden", hid]];
  let best = cand[0];
  cand.forEach(c => { if (Math.abs(c[1] - current) < Math.abs(best[1] - current)) best = c; });
  setSheetState(best[0]);
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  drag = null;
}
grab.addEventListener("pointerdown", onDown);
grab.addEventListener("click", () => {
  if (Math.abs((drag && drag.moved) || 0) > 6) return;
  const s = sheet.dataset.state;
  setSheetState(s === "full" ? "peek" : "full");   // hidden/peek -> full, full -> peek
});
const hideBtn = $("#sheet-hide");
if (hideBtn) hideBtn.addEventListener("click", (e) => { e.stopPropagation(); setSheetState("hidden"); });
// allow dragging the sheet down from the very top of the scroll area
scroller.addEventListener("pointerdown", (e) => {
  if (window.innerWidth >= 860) return;
  if (scroller.scrollTop <= 0 && sheet.dataset.state === "full") onDown(e);
});

/* ---------- Live location ("you are here") ---------- */
const locLayer = L.layerGroup().addTo(map);  // never cleared by renderMap
let meMarker = null, meCircle = null, meWatch = null;

function meIcon() {
  return L.divIcon({ className: "me-wrap", html: `<div class="me-dot"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}
function onPos(p) {
  const lat = p.coords.latitude, lng = p.coords.longitude, acc = p.coords.accuracy || 0;
  const ll = [lat, lng];
  const first = !meMarker;
  if (first) {
    meCircle = L.circle(ll, { radius: acc, className: "me-acc", stroke: false, interactive: false }).addTo(locLayer);
    meMarker = L.marker(ll, { icon: meIcon(), interactive: false, keyboard: false, zIndexOffset: 3000 }).addTo(locLayer);
    map.flyTo(ll, Math.max(map.getZoom(), 14.5), { duration: 0.8 });
  } else {
    meMarker.setLatLng(ll);
    meCircle.setLatLng(ll).setRadius(acc);
  }
  $("#locate").classList.add("on");
}
function onPosErr(err) {
  $("#locate").classList.remove("on");
  if (err && err.code === 1) alert("Location permission was denied. Enable location for this site in your browser settings to see where you are.");
  else if (err && err.code === 3) alert("Couldn't get a location fix (timed out). Try again with a clearer view of the sky.");
}
function startLocate() {
  if (!navigator.geolocation) { alert("This device/browser doesn't support location."); return; }
  if (meMarker) { map.flyTo(meMarker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.7 }); return; }
  const opts = { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 };
  navigator.geolocation.getCurrentPosition(onPos, onPosErr, opts);
  if (meWatch == null) meWatch = navigator.geolocation.watchPosition(onPos, onPosErr, opts);
}
$("#locate").addEventListener("click", startLocate);
// auto-start only if the user already granted permission (no surprise prompt)
if (navigator.permissions && navigator.permissions.query) {
  navigator.permissions.query({ name: "geolocation" })
    .then(s => { if (s.state === "granted") startLocate(); })
    .catch(() => {});
}

/* ---------- Recenter + resize ---------- */
$("#recenter").addEventListener("click", () => fitView(true));
$("#trip-chip").textContent = `${TRIP.riders} riders · ${TRIP.days.length} days`;

let rT;
window.addEventListener("resize", () => {
  clearTimeout(rT);
  rT = setTimeout(() => {
    map.invalidateSize();
    if (window.innerWidth < 860) setSheetState(sheet.dataset.state || "peek");
    fitView(false);
  }, 150);
});

/* ---------- Boot ---------- */
function startDay() {
  if (/#all/i.test(location.hash)) return "all";
  const m = (location.hash || "").match(/day([1234])/i);
  return m ? Number(m[1]) - 1 : 0;
}
buildTabs();
selectDay(startDay(), true);
setSheetState("peek");
setTimeout(() => map.invalidateSize(), 60);
window.addEventListener("hashchange", () => selectDay(startDay()));
