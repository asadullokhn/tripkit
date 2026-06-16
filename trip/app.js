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
  let data = null;       // { trip, people, itinerary, rev } from the public endpoint
  let itin = { title: "", days: [] };
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
  let markers = [], flat = [], activeIdx = -1;

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
  function renderMap() {
    layer.clearLayers(); markers = [];
    viewDays().forEach((di) => {
      const line = days()[di].stops.filter(hasPin).map((s) => [s.lat, s.lng]);
      if (line.length > 1) {
        const c = dayColor(di);
        L.polyline(line, { color: c, weight: 10, opacity: 0.14, lineCap: "round" }).addTo(layer);
        L.polyline(line, { color: c, weight: 3.5, opacity: 0.92, lineCap: "round", dashArray: "1 9" }).addTo(layer);
      }
    });
    flat.forEach((f, k) => {
      if (!hasPin(f.stop)) { markers.push(null); return; }
      const badge = badgeFor(days()[f.di], f.stop, f.si);
      const logi = LOGI.has(f.stop.type);
      const icon = L.divIcon({ className: "mk-wrap", html: `<div class="mk ${logi ? "is-logi" : ""}" style="--mk:${f.color}"><span>${badge}</span></div>`,
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
  function stopCard(di, si, gi) {
    const day = days()[di], stop = day.stops[si], t = typeOf(stop.type);
    const time = stop.time ? `<span class="stop-time">${esc(stop.time)}</span>` : "";
    const url = stop.url ? `<a class="stop-link" href="${esc(stop.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Maps ↗</a>` : "";
    const nopin = hasPin(stop) ? "" : `<span class="nopin" title="no map pin yet">no pin</span>`;
    const edit = editing ? `
      <div class="stop-edit">
        <button class="se mv" data-act="up" data-di="${di}" data-si="${si}" title="Move up" aria-label="Move up">▲</button>
        <button class="se mv" data-act="down" data-di="${di}" data-si="${si}" title="Move down" aria-label="Move down">▼</button>
        <button class="se" data-act="cost" data-di="${di}" data-si="${si}" title="Link a cost">💸</button>
        <button class="se" data-act="edit" data-di="${di}" data-si="${si}" title="Edit">✎</button>
      </div>` : "";
    return `
      <li class="tl-item anim" data-gi="${gi}" style="animation-delay:${Math.min(0.6, 0.05 * gi + 0.08)}s">
        <div class="tl-node ${LOGI.has(stop.type) ? "is-logi" : ""}"><span class="nd-badge">${badgeFor(day, stop, si)}</span></div>
        <button class="stop" data-idx="${gi}">
          <div class="thumb" style="--thumb:linear-gradient(150deg, ${t.g[0]}, ${t.g[1]})"><span>${t.icon}</span></div>
          <div class="stop-body">
            <div class="stop-top"><span class="stop-name">${esc(stop.name)}</span>${time}</div>
            <div class="stop-sub"><span class="type">${esc(t.label)}</span>${nopin}${costChip(stop)}</div>
            ${stop.note ? `<p class="stop-note">${esc(stop.note)}</p>` : ""}
            ${url}
          </div>
        </button>
        ${edit}
      </li>`;
  }
  function dayHead(di) {
    const day = days()[di], dir = dirUrl(day);
    const sights = day.stops.filter((s) => !LOGI.has(s.type)).length;
    const addDay = editing ? `<button class="eb-btn sm" data-act="editday" data-di="${di}">✎ day</button>
      <button class="eb-btn sm" data-act="dayup" data-di="${di}" title="Move day earlier">▲</button>
      <button class="eb-btn sm" data-act="daydown" data-di="${di}" title="Move day later">▼</button>` : "";
    return `
      <div class="day-head">
        <span class="day-eyebrow">${esc(day.label || "Day " + (di + 1))}${day.dateLabel ? `<span class="pill">· ${esc(day.dateLabel)}</span>` : ""}</span>
        <h2 class="day-title">${esc(day.title || "Day " + (di + 1))}</h2>
        <div class="day-actions">
          ${dir ? `<a class="route-btn" href="${dir}" target="_blank" rel="noopener">Open route ↗</a>` : ""}
          <span class="meta-chip"><b>${sights}</b> sights</span>
          ${addDay}
        </div>
      </div>`;
  }
  function renderSheet() {
    const inner = $("#sheet-inner");
    if (!days().length) {
      inner.innerHTML = `<div class="empty-itin">
        <div class="empty-emoji">🗺️</div>
        <h2>No itinerary yet</h2>
        <p>${authed ? "Add the first day, or generate one with AI." : "Ask the organizer to add a plan."}</p>
        <div class="empty-cta">
          ${admin && aiEnabled ? `<button class="solid-btn" id="emptyAi">✨ Generate with AI</button>` : ""}
          <button class="eb-btn" id="emptyAdd">＋ Add the first day</button>
        </div>
      </div>`;
      const ea = $("#emptyAdd"); if (ea) ea.addEventListener("click", () => requireAuth(() => openDay(null)));
      const eai = $("#emptyAi"); if (eai) eai.addEventListener("click", () => $("#aiBtn").click());
      return;
    }
    let gi = 0; let html = "";
    const list = currentDay === "all" ? days().map((_, i) => i) : [currentDay];
    list.forEach((di) => {
      const cards = days()[di].stops.map((_, si) => stopCard(di, si, gi++)).join("");
      html += `<section class="day-group">${dayHead(di)}<ol class="timeline">${cards}</ol>
        ${editing ? `<button class="eb-btn add-stop" data-act="addstop" data-di="${di}">＋ Add stop</button>` : ""}</section>`;
    });
    if (editing) html += `<button class="eb-btn add-day" data-act="addday">＋ Add day</button>`;
    inner.innerHTML = html;

    inner.querySelectorAll(".stop").forEach((b) => b.addEventListener("click", () => activateStop(Number(b.dataset.idx), "sheet")));
    inner.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation(); onEditAct(b.dataset.act, Number(b.dataset.di), Number(b.dataset.si));
    }));
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
    $("#brand-eyebrow").textContent = itin.title && data && itin.title !== data.trip.name ? itin.title : "Itinerary";
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
    $("#aiBtn").hidden = !(admin && aiEnabled);
    $("#loginBtn").hidden = admin;
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
    if (act === "up" || act === "down") return moveStop(di, si, act === "up" ? -1 : 1);
    if (act === "dayup" || act === "daydown") return moveDay(di, act === "dayup" ? -1 : 1);
    if (act === "edit") return openStop(di, si);
    if (act === "addstop") return openStop(di, null);
    if (act === "addday") return openDay(null);
    if (act === "editday") return openDay(di);
    if (act === "cost") return openCost(di, si);
  }
  function moveStop(di, si, d) { const a = days()[di].stops; const j = si + d; if (j < 0 || j >= a.length) return; [a[si], a[j]] = [a[j], a[si]]; renderSheet(); renderMap(); saveItin(); }
  function moveDay(di, d) { const a = days(); const j = di + d; if (j < 0 || j >= a.length) return; [a[di], a[j]] = [a[j], a[di]]; currentDay = j; renderAll(); saveItin(); }

  // stop dialog
  const stopDlg = $("#stopDialog"); let stopEdit = null;
  function openStop(di, si) {
    stopEdit = { di, si };
    const s = si != null ? days()[di].stops[si] : {};
    $("#stopTitle").textContent = si != null ? "Edit stop" : "Add stop";
    $("#stName").value = s.name || ""; $("#stType").value = s.type || "activity";
    $("#stTime").value = s.time || ""; $("#stUrl").value = s.url || "";
    $("#stNote").value = s.note || ""; $("#stLat").value = (s.lat ?? "") === 0 ? "" : (s.lat ?? "");
    $("#stLng").value = (s.lng ?? "") === 0 ? "" : (s.lng ?? "");
    $("#stErr").hidden = true; $("#stDelete").hidden = si == null;
    stopDlg.showModal(); setTimeout(() => $("#stName").focus(), 30);
  }
  $("#stCancel").addEventListener("click", () => stopDlg.close());
  stopDlg.addEventListener("cancel", (e) => { e.preventDefault(); stopDlg.close(); });
  $("#stDelete").addEventListener("click", () => { const { di, si } = stopEdit; days()[di].stops.splice(si, 1); stopDlg.close(); renderSheet(); renderMap(); saveItin("Stop removed"); });
  $("#stopForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#stName").value.trim();
    if (!name) { $("#stErr").textContent = "Name is required"; $("#stErr").hidden = false; $("#stName").focus(); return; }
    const lat = parseFloat($("#stLat").value), lng = parseFloat($("#stLng").value);
    const s = { name, type: $("#stType").value, time: $("#stTime").value.trim(), url: $("#stUrl").value.trim(),
      note: $("#stNote").value.trim(), lat: Number.isFinite(lat) ? lat : 0, lng: Number.isFinite(lng) ? lng : 0 };
    const { di, si } = stopEdit;
    if (si != null) { s.id = days()[di].stops[si].id; s.linkedExpenseId = days()[di].stops[si].linkedExpenseId; days()[di].stops[si] = s; }
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
  $("#dyDelete").addEventListener("click", () => { if (dayEdit == null) return; itin.days.splice(dayEdit, 1); currentDay = itin.days.length ? 0 : "all"; dayDlg.close(); renderAll(); saveItin("Day removed"); });
  $("#dayForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#dyTitle").value.trim(); if (!title) return;
    const d = { label: $("#dyLabel").value.trim() || ("Day " + ((dayEdit != null ? dayEdit : itin.days.length) + 1)), dateLabel: $("#dyDate").value.trim(), title };
    if (dayEdit != null) { d.id = itin.days[dayEdit].id; d.stops = itin.days[dayEdit].stops; itin.days[dayEdit] = d; }
    else { d.stops = []; itin.days.push(d); currentDay = itin.days.length - 1; }
    dayDlg.close(); renderAll(); saveItin("Saved");
  });

  // edit toggle + login
  $("#editToggle").addEventListener("click", () => { if (!editing) return requireAuth(() => { editing = true; renderAll(); }); editing = false; renderAll(); });
  $("#loginBtn").addEventListener("click", () => requireAuth(() => {}));  // unlocking promotes to admin via /me
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
  $("#aiBtn").addEventListener("click", () => { $("#aiDest").value = data && data.trip ? data.trip.name : ""; $("#aiDays").value = 3; $("#aiNotes").value = ""; $("#aiErr").hidden = true; aiDlg.showModal(); setTimeout(() => $("#aiDest").focus(), 30); });
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
  $("#draftReplace").addEventListener("click", async () => { itin = JSON.parse(JSON.stringify(draft)); endDraft(); await saveItin("Itinerary saved"); });
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
      try { const me = await api("/me"); admin = !!me.admin; aiEnabled = !!me.aiEnabled; } catch (_) {}
      $("#lock").hidden = true; $("#lockErr").textContent = "";
      applyAuthUI();
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
  $("#locate").addEventListener("click", () => { if (!navigator.geolocation) return; if (meMarker) return map.flyTo(meMarker.getLatLng(), 15, { duration: 0.6 }); navigator.geolocation.getCurrentPosition(onPos, () => {}, { enableHighAccuracy: true, timeout: 12000 }); });
  $("#recenter").addEventListener("click", () => fitView(true));
  let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { map.invalidateSize(); if (window.innerWidth < 860) setSheetState(sheet.dataset.state || "peek"); fitView(false); }, 150); });

  // ---------- load / poll ----------
  function adopt(d) { data = d; itin = (d && d.itinerary) || { title: "", days: [] }; lastRev = d ? d.rev : -1; }
  async function reload(silent) {
    try { const d = await api(`/trips/${tripId}/itinerary`); adopt(d); if (!silent) {} renderAll(); }
    catch (e) { if (!silent) $("#sheet-inner").innerHTML = `<div class="empty-itin"><p>Couldn't load this trip.</p></div>`; }
  }
  function startDayFromHash() { if (/#all/i.test(location.hash)) return "all"; const m = (location.hash || "").match(/day(\d+)/i); return m ? Math.max(0, Number(m[1]) - 1) : 0; }

  async function boot() {
    if (!tripId) { location.replace("/"); return; }
    try {
      const d = await api(`/trips/${tripId}/itinerary`);   // PUBLIC — no passcode needed to view
      adopt(d);
      currentDay = startDayFromHash();
      // if we already hold a passcode, silently promote to authed (enables edit + cost chips)
      if (pass) { try { fullDoc = await api(`/trips/${tripId}`); authed = true; const me = await api("/me"); admin = !!me.admin; aiEnabled = !!me.aiEnabled; } catch (_) { pass = ""; } }
      renderAll();
      setSheetState("peek");
      setTimeout(() => map.invalidateSize(), 60);
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
