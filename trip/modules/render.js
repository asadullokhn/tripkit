import { state } from "./state.js";
import { $, days, esc, t, hasPin, dayDate, fmtDayDate, dateKey, fmtDuration, fmtClock, parseTimeMin, typeOf, typeLabel, badgeFor, LOGI, moneyRp, actualCost, tripId, PACE_LABEL, BUDGET_LABEL, MOBILITY_LABEL, paceLabel, budgetLabel, mobilityLabel, dietLabel, dayColor, ALL_COLOR } from "./core.js";
import { viewDays, computeDayTimeline, legLabel, modeOf, MODES, routeCache, legSig, activateStop, buildFlat, renderMap, fitView, applyNowNext } from "./map.js";
import { requireAuth, openDay, openPlan, openRsvp, onEditAct, removeSignup } from "./dialogs.js";

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

// ---------- sheet content ----------
function dirUrl(day) {
  const pts = day.stops.filter(hasPin).map((s) => `${s.lat},${s.lng}`);
  return pts.length ? "https://www.google.com/maps/dir/" + pts.join("/") : null;
}
function costChip(stop) {
  if (!stop.linkedExpenseId) return "";
  if (state.fullDoc) {
    const e = (state.fullDoc.expenses || []).find((x) => x.id === stop.linkedExpenseId);
    if (e) return `<a class="cost-chip" href="/split/?t=${encodeURIComponent(tripId)}" title="${esc(t("trip.cost.viewInBills", "View in Bills"))}">Rp ${Number(e.amount).toLocaleString("en-US")}</a>`;
    const r = (state.fullDoc.receipts || []).find((x) => x.id === stop.linkedExpenseId);
    if (r) return `<a class="cost-chip" href="/split/?t=${encodeURIComponent(tripId)}">Rp ${Number(r.grandTotal).toLocaleString("en-US")}</a>`;
    return `<span class="cost-chip warn" title="${esc(t("trip.cost.removedTitle", "linked cost was removed"))}">⚠ ${esc(t("trip.cost.chip", "cost"))}</span>`;
  }
  return `<a class="cost-chip" href="/split/?t=${encodeURIComponent(tripId)}" title="${esc(t("trip.cost.hasLinkedTitle", "has a linked cost"))}">💸 ${esc(t("trip.cost.chip", "cost"))}</a>`;
}
function stopCard(di, si, gi, tl) {
  const day = days()[di], stop = day.stops[si], ty = typeOf(stop.type);
  const time = stop.time ? `<span class="stop-time">${esc(stop.time)}</span>` : "";
  // computed timeline row: arrival + visit duration line, optional "leave prev by" badge + late warning
  const row = tl && tl.rows[si];
  let timeline = "";
  if (row && row.arrival != null) {
    const dur = (stop.durationMin > 0) ? ` · ${t("trip.card.here", "{d} here", { d: fmtDuration(stop.durationMin) })}` : "";
    const fixed = parseTimeMin(stop.time) != null;
    timeline = `<div class="stop-clock${row.late ? " late" : ""}">${fixed ? "🕒" : esc(t("trip.card.arr", "arr"))} ${fmtClock(row.arrival)}${dur}${row.late ? ` <span class="late-tag">⚠ ${esc(t("trip.card.tight", "tight"))}</span>` : ""}</div>`;
  }
  const leaveBy = (row && row.leaveBy != null && si > 0)
    ? `<span class="leave-by" title="${esc(t("trip.card.leaveByTitle", "leave the previous stop by this time"))}">${esc(t("trip.card.leaveBy", "leave by {time}", { time: fmtClock(row.leaveBy) }))}</span>` : "";
  const lk = stop.links || {};
  const mapsHref = lk.maps || stop.url || "";
  const chip = (href, label) => href ? `<a class="stop-chip" href="${esc(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${label}</a>` : "";
  const linksRow = [chip(mapsHref, "🗺 " + esc(t("trip.card.maps", "Maps"))), chip(lk.booking, "🏨 " + esc(t("trip.card.book", "Book"))), chip(lk.tickets, "🎟 " + esc(t("trip.card.tickets", "Tickets")))].filter(Boolean).join("");
  const links = linksRow ? `<div class="stop-links">${linksRow}</div>` : "";
  const dur = (stop.durationMin > 0) ? `<span class="dur-pill" title="${esc(t("trip.card.visitDuration", "visit duration"))}">⏱ ${fmtDuration(stop.durationMin)}</span>` : "";
  const nopin = hasPin(stop) ? "" : `<span class="nopin" title="${esc(t("trip.card.noPinTitle", "no map pin yet"))}">${esc(t("trip.card.noPin", "no pin"))}</span>`;
  let prevPin = -1;
  if (hasPin(stop)) for (let j = si - 1; j >= 0; j--) { if (hasPin(day.stops[j])) { prevPin = j; break; } }
  const legPill = (prevPin >= 0 || leaveBy) ? `<div class="leg-row">${prevPin >= 0 ? `<span class="leg-pill" data-di="${di}" data-a="${prevPin}" data-b="${si}">${esc(legLabel(day.stops[prevPin], stop))}</span>` : ""}${leaveBy}</div>` : "";
  const edit = state.editing ? `
    <div class="stop-edit">
      <button class="se mv" data-act="up" data-di="${di}" data-si="${si}" title="${esc(t("trip.card.moveUp", "Move up"))}" aria-label="${esc(t("trip.card.moveUp", "Move up"))}">▲</button>
      <button class="se mv" data-act="down" data-di="${di}" data-si="${si}" title="${esc(t("trip.card.moveDown", "Move down"))}" aria-label="${esc(t("trip.card.moveDown", "Move down"))}">▼</button>
      <button class="se" data-act="cost" data-di="${di}" data-si="${si}" title="${esc(t("trip.cost.title", "Link a cost"))}">💸</button>
      <button class="se" data-act="edit" data-di="${di}" data-si="${si}" title="${esc(t("common.edit", "Edit"))}">✎</button>
    </div>` : "";
  return `
    <li class="tl-item anim ${stop.done ? "is-done" : ""}" data-gi="${gi}" data-di="${di}" data-si="${si}" style="animation-delay:${Math.min(0.6, 0.05 * gi + 0.08)}s">
      <div class="tl-node ${LOGI.has(stop.type) ? "is-logi" : ""}" ${state.authed ? `data-sid="1" data-act="done" data-di="${di}" data-si="${si}" role="button" tabindex="0" aria-label="${stop.done ? esc(t("trip.card.markNotDone", "Mark not done")) : esc(t("trip.card.markDone", "Mark done"))}"` : ""}><span class="nd-badge">${badgeFor(day, stop, si)}</span><span class="nd-check">✓</span></div>
      <button class="stop" data-idx="${gi}">
        <div class="thumb" style="--thumb:linear-gradient(150deg, ${ty.g[0]}, ${ty.g[1]})"><span>${ty.icon}</span></div>
        <div class="stop-body">
          ${legPill}
          <div class="stop-top"><span class="stop-name">${esc(stop.name)}</span>${time}</div>
          <div class="stop-sub"><span class="type">${esc(typeLabel(stop.type))}</span>${dur}${nopin}${costChip(stop)}</div>
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
  const addDay = state.editing ? `<button class="eb-btn sm" data-act="editday" data-di="${di}">✎ ${esc(t("trip.day.dayWord", "day"))}</button>
    <button class="eb-btn sm" data-act="dayup" data-di="${di}" title="${esc(t("trip.day.moveEarlier", "Move day earlier"))}">▲</button>
    <button class="eb-btn sm" data-act="daydown" data-di="${di}" title="${esc(t("trip.day.moveLater", "Move day later"))}">▼</button>` : "";
  // schedule chip: ends ~HH:MM · {driving total}
  let schedChip = "";
  if (tl && tl.endsAt != null) {
    const drive = tl.driveMin > 0 ? ` · 🚗 ${fmtDuration(tl.driveMin)}` : "";
    schedChip = `<span class="day-chip">${esc(t("trip.day.ends", "ends ~{time}", { time: fmtClock(tl.endsAt) }))}${drive}</span>`;
  }
  const wxChip = weatherChipHtml(di);
  const budget = budgetGaugeHtml(di);
  const shareDay = `<button class="eb-btn sm" data-act="shareday" data-di="${di}" title="${esc(t("trip.day.shareTitle", "Share this day"))}">↗ ${esc(t("trip.bar.share", "Share"))}</button>`;
  const chips = (schedChip || wxChip) ? `<div class="day-chips">${schedChip}${wxChip}</div>` : "";
  const dayFallback = t("trip.day.dayN", "Day {n}", { n: di + 1 });
  return `
    <div class="day-head">
      <span class="day-eyebrow">${esc(day.label || dayFallback)}${dateText ? `<span class="pill">· ${esc(dateText)}</span>` : ""}</span>
      <h2 class="day-title">${esc(day.title || dayFallback)}</h2>
      ${chips}
      ${budget}
      <div class="day-actions">
        ${dir ? `<a class="route-btn" href="${dir}" target="_blank" rel="noopener">${esc(t("trip.day.openRoute", "Open route ↗"))}</a>` : ""}
        ${shareDay}
        ${addDay}
      </div>
    </div>`;
}
// budget gauge — AUTHED users only (never expose amounts to public)
function budgetGaugeHtml(di) {
  if (!state.authed) return "";
  const day = days()[di], stops = day.stops || [];
  let planned = 0, actual = 0, hasActual = false;
  stops.forEach((s) => { if (s.cost > 0) planned += s.cost; const a = actualCost(s); if (a != null) { actual += a; hasActual = true; if (!(s.cost > 0)) planned += a; } });
  const target = (state.profile && state.profile.dailyTarget > 0) ? state.profile.dailyTarget : 0;
  if (!planned && !hasActual && !target) return "";
  const over = target && planned > target;
  const pct = target ? Math.min(100, Math.round(planned / target * 100)) : (planned ? 100 : 0);
  const targetTxt = target ? ` / ${t("trip.budget.ofTarget", "{amt} planned", { amt: moneyRp(target) })}` : " " + t("trip.budget.planned", "planned");
  const actualTxt = hasActual ? `<span class="bg-actual">${esc(t("trip.budget.actual", "actual {amt}", { amt: moneyRp(actual) }))}</span>` : "";
  return `<div class="budget-gauge${over ? " over" : ""}">
    <div class="bg-bar"><span style="width:${pct}%"></span></div>
    <div class="bg-label"><span class="bg-planned">${moneyRp(planned)}${targetTxt}</span>${actualTxt}</div>
  </div>`;
}
// dates summary text e.g. "Sat 13 Jun – Mon 15 Jun"
export function datesSummary() {
  const n = days().length, s = dayDate(0); if (!s || !n) return "";
  const e = dayDate(n - 1);
  return n > 1 ? `${fmtDayDate(s)} – ${fmtDayDate(e)}` : fmtDayDate(s);
}
// authed/editing compact summary chips (may show money-ish budget level, never the daily target text)
function profileSummaryHtml() {
  if (!state.profile) return "";
  const chips = [];
  const dates = datesSummary(); if (dates) chips.push(`<span class="ps-chip">🗓 <b>${esc(dates)}</b></span>`);
  if (state.profile.pace && PACE_LABEL[state.profile.pace]) chips.push(`<span class="ps-chip">⚡ ${esc(paceLabel(state.profile.pace))}</span>`);
  if (state.profile.budgetLevel && BUDGET_LABEL[state.profile.budgetLevel]) chips.push(`<span class="ps-chip">💰 ${esc(budgetLabel(state.profile.budgetLevel))}</span>`);
  (state.profile.dietary || []).forEach((d) => chips.push(`<span class="ps-chip">🍽 ${esc(dietLabel(d))}</span>`));
  const grp = groupSummary(); if (grp) chips.push(`<span class="ps-chip">👥 ${esc(grp)}</span>`);
  return chips.length ? `<div class="profile-summary">${chips.join("")}</div>` : "";
}
function groupSummary() {
  const a = +state.profile.adults || 0, k = +state.profile.kids || 0; if (!a && !k) return "";
  const p = [];
  if (a) p.push(a > 1 ? t("trip.group.adults", "{n} adults", { n: a }) : t("trip.group.adult", "{n} adult", { n: a }));
  if (k) p.push(k > 1 ? t("trip.group.kids", "{n} kids", { n: k }) : t("trip.group.kid", "{n} kid", { n: k }));
  return p.join(" · ");
}
// public, non-money "good to know" strip
function goodToKnowHtml() {
  if (state.authed || !state.profile) return "";
  const bits = [];
  if ((state.profile.dietary || []).includes("halal")) bits.push(t("trip.gtk.halalFriendly", "Halal-friendly"));
  else if ((state.profile.dietary || []).length) bits.push((state.profile.dietary || []).map((d) => dietLabel(d)).join(", "));
  if (state.profile.pace && PACE_LABEL[state.profile.pace]) bits.push(t("trip.gtk.pace", "{pace} pace", { pace: paceLabel(state.profile.pace) }));
  if (state.profile.mobility && MOBILITY_LABEL[state.profile.mobility]) bits.push(mobilityLabel(state.profile.mobility));
  if ((+state.profile.kids || 0) > 0) bits.push(t("trip.gtk.family", "Family"));
  if (!bits.length) return "";
  return `<div class="good-to-know"><span class="gtk-label">${esc(t("trip.gtk.label", "Good to know"))}</span>${bits.map((b) => `<span class="gtk-chip">${esc(b)}</span>`).join("")}</div>`;
}

// ---------- at-a-glance hero ----------
// sum road distance (km) + drive time (h) across every day's loaded legs (uses routeCache)
function tripRoadTotals() {
  let distM = 0, durS = 0, any = false;
  days().forEach((day) => {
    const pins = (day.stops || []).filter(hasPin);
    for (let i = 0; i < pins.length - 1; i++) {
      const m = modeOf(pins[i + 1]); if (!(MODES[m] && MODES[m].road)) continue;
      const leg = routeCache[legSig(pins[i], pins[i + 1], m)];
      if (leg && leg.line) { distM += leg.dist; durS += leg.dur; any = true; }
    }
  });
  return any ? { km: distM / 1000, h: durS / 3600 } : null;
}
const totalStops = () => days().reduce((n, d) => n + ((d.stops && d.stops.length) || 0), 0);
// compact summary card near the top of the sheet (prominent for public recruits)
function heroHtml() {
  if (!days().length) return "";
  const name = (state.data && state.data.trip && state.data.trip.name) || state.itin.title || "";
  const nDays = days().length, nStops = totalStops();
  const dates = datesSummary();
  const facts = [];
  facts.push(nDays > 1 ? t("trip.chip.days", "{n} days", { n: nDays }) : t("trip.chip.day", "{n} day", { n: nDays }));
  if (nStops) facts.push(nStops > 1 ? t("trip.hero.stops", "{n} stops", { n: nStops }) : t("trip.hero.stop", "{n} stop", { n: nStops }));
  const rd = tripRoadTotals();
  if (rd) facts.push(t("trip.hero.driving", "~{km} km · {h}h driving", { km: Math.round(rd.km), h: rd.h < 10 ? rd.h.toFixed(1).replace(/\.0$/, "") : Math.round(rd.h) }));
  const datesLine = dates ? `<div class="hero-dates">🗓 ${esc(dates)}</div>` : "";
  return `<div class="trip-hero">
    ${name ? `<div class="hero-name">${esc(name)}</div>` : ""}
    ${datesLine}
    <div class="hero-facts">${facts.map((f) => `<span class="hero-fact">${esc(f)}</span>`).join("")}</div>
  </div>`;
}

// ---------- "I'm in" join wall ----------
export const signupTotal = () => state.signups.reduce((n, s) => n + Math.max(1, +s.count || 1), 0);
function joinWallHtml() {
  if (!days().length) return "";
  const total = signupTotal();
  const full = state.capacity > 0 && total >= state.capacity;
  let countLine = "";
  if (state.capacity > 0) {
    const left = Math.max(0, state.capacity - total);
    countLine = full
      ? `<span class="jw-count jw-full">${esc(t("trip.rsvp.full", "Full"))}</span>`
      : `<span class="jw-count">${esc(t("trip.rsvp.ofCap", "{n} of {cap} — {left} spot{s} left", { n: total, cap: state.capacity, left, s: left === 1 ? "" : "s" }))}</span>`;
  } else if (total > 0) {
    countLine = `<span class="jw-count">${esc(total > 1 ? t("trip.rsvp.coming", "{n} coming", { n: total }) : t("trip.rsvp.comingOne", "{n} coming", { n: total }))}</span>`;
  }
  const roster = state.signups.length
    ? `<div class="jw-roster"><span class="jw-roster-label">${esc(t("trip.rsvp.rosterLabel", "Coming ({n}):", { n: total }))}</span>${state.signups.map((s, i) => {
        const cnt = Math.max(1, +s.count || 1);
        const nm = esc(s.name) + (cnt > 1 ? ` <span class="jw-x">×${cnt}</span>` : "");
        const rm = state.admin ? `<button class="jw-rm" type="button" data-act="rsvprm" data-idx="${i}" title="${esc(t("trip.rsvp.remove", "Remove"))}" aria-label="${esc(t("trip.rsvp.removeName", "Remove {name}", { name: s.name }))}">✕</button>` : "";
        return `<span class="jw-person">${nm}${rm}</span>`;
      }).join("")}</div>`
    : `<div class="jw-roster jw-empty">${esc(t("trip.rsvp.beFirst", "Be the first to join."))}</div>`;
  return `<div class="join-wall">
    <div class="jw-head">
      <button class="solid-btn jw-btn" id="joinBtn" type="button" ${full ? "disabled" : ""}>✋ ${esc(t("trip.rsvp.join", "I'm in"))}</button>
      ${countLine}
    </div>
    ${roster}
  </div>`;
}

export function renderSheet() {
  const inner = $("#sheet-inner");
  if (!days().length) {
    inner.innerHTML = `<div class="empty-itin">
      <div class="empty-emoji">🗺️</div>
      <h2>${esc(t("trip.empty.title", "No itinerary yet"))}</h2>
      <p>${state.authed ? esc(t("trip.empty.authed", "Add the first day, or generate one with AI.")) : esc(t("trip.empty.public", "Ask the organizer to add a plan."))}</p>
      ${state.authed ? profileSummaryHtml() : goodToKnowHtml()}
      <div class="empty-cta">
        ${state.admin && state.aiEnabled ? `<button class="solid-btn" id="emptyAi">✨ ${esc(t("trip.empty.generateAi", "Generate with AI"))}</button>` : ""}
        <button class="eb-btn" id="emptyAdd">＋ ${esc(t("trip.empty.addFirstDay", "Add the first day"))}</button>
      </div>
    </div>`;
    const ea = $("#emptyAdd"); if (ea) ea.addEventListener("click", () => requireAuth(() => openDay(null)));
    const eai = $("#emptyAi"); if (eai) eai.addEventListener("click", () => openPlan());
    return;
  }
  let gi = 0; let html = nowStripHtml() + heroHtml() + joinWallHtml() + (state.authed ? profileSummaryHtml() : goodToKnowHtml());
  const list = state.currentDay === "all" ? days().map((_, i) => i) : [state.currentDay];
  list.forEach((di) => {
    const tl = computeDayTimeline(days()[di]);
    const cards = days()[di].stops.map((_, si) => stopCard(di, si, gi++, tl)).join("");
    html += `<section class="day-group">${dayHead(di, tl)}<ol class="timeline">${cards}</ol>
      ${state.editing ? `<button class="eb-btn add-stop" data-act="addstop" data-di="${di}">＋ ${esc(t("trip.stop.addTitle", "Add stop"))}</button>` : ""}</section>`;
  });
  if (state.authed) html += tripBudgetHtml();
  if (state.editing) html += `<button class="eb-btn add-day" data-act="addday">＋ ${esc(t("trip.day.addTitle", "Add day"))}</button>`;
  inner.innerHTML = html;

  inner.querySelectorAll(".stop").forEach((b) => b.addEventListener("click", () => activateStop(Number(b.dataset.idx), "sheet")));
  inner.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (b.dataset.act === "rsvprm") return removeSignup(Number(b.dataset.idx));
    onEditAct(b.dataset.act, Number(b.dataset.di), Number(b.dataset.si));
  }));
  const jb = $("#joinBtn"); if (jb) jb.addEventListener("click", openRsvp);
  ensureWeather();
  applyNowNext();
}
// trip-total budget (authed) — sum vs dailyTarget × days
function tripBudgetHtml() {
  if (!state.authed) return "";
  let planned = 0, actual = 0, hasActual = false;
  days().forEach((day) => (day.stops || []).forEach((s) => {
    if (s.cost > 0) planned += s.cost; const a = actualCost(s);
    if (a != null) { actual += a; hasActual = true; if (!(s.cost > 0)) planned += a; }
  }));
  const target = (state.profile && state.profile.dailyTarget > 0) ? state.profile.dailyTarget * days().length : 0;
  if (!planned && !hasActual && !target) return "";
  const over = target && planned > target;
  const pct = target ? Math.min(100, Math.round(planned / target * 100)) : (planned ? 100 : 0);
  const targetTxt = target ? ` / ${t("trip.budget.ofTarget", "{amt} planned", { amt: moneyRp(target) })}` : " " + t("trip.budget.planned", "planned");
  const actualTxt = hasActual ? `<span class="bg-actual">${esc(t("trip.budget.actual", "actual {amt}", { amt: moneyRp(actual) }))}</span>` : "";
  return `<div class="trip-budget"><span class="tb-label">${esc(t("trip.budget.tripBudget", "Trip budget"))}</span>
    <div class="budget-gauge${over ? " over" : ""}">
      <div class="bg-bar"><span style="width:${pct}%"></span></div>
      <div class="bg-label"><span class="bg-planned">${moneyRp(planned)}${targetTxt}</span>${actualTxt}</div>
    </div></div>`;
}

// ---------- NOW / NEXT ----------
// which day index is "today" within the trip, or -1
export function todayDayIndex() {
  const n = days().length; if (!n || !(state.profile && state.profile.startDate)) return -1;
  const tk = dateKey(new Date());
  for (let i = 0; i < n; i++) if (dateKey(dayDate(i)) === tk) return i;
  return -1;
}
// find the current + next stop on today's day from computed arrival times
export function nowNext() {
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
    main = `<span class="ns-kicker">${esc(t("trip.now.now", "Now"))}</span><span class="ns-name">${esc(curS.name)}</span>`;
    if (nextS) { const inMin = Math.max(0, Math.round((nn.tl.rows[nn.next].arrival) - nn.mins)); sub = `<span class="ns-next">${esc(t("trip.now.nextName", "next: {name} · in {dur}", { name: nextS.name, dur: fmtDuration(inMin) || t("trip.now.now2", "now") }))}</span>`; }
  } else if (nextS) {
    const inMin = Math.max(0, Math.round((nn.tl.rows[nn.next].arrival) - nn.mins));
    main = `<span class="ns-kicker">${esc(t("trip.now.upNext", "Up next"))}</span><span class="ns-name">${esc(nextS.name)}</span>`;
    sub = `<span class="ns-next">${esc(t("trip.now.in", "in {dur}", { dur: fmtDuration(inMin) || t("trip.now.now2", "now") }))}</span>`;
  } else return "";
  return `<div class="now-strip" data-di="${nn.di}" data-cur="${nn.cur}" data-next="${nn.next}"><div class="ns-main">${main}</div>${sub}</div>`;
}
// on boot mid-trip, scroll to the current (or next) stop
export function scrollToNow() {
  const nn = nowNext(); if (!nn) return;
  const si = nn.cur >= 0 ? nn.cur : nn.next; if (si < 0) return;
  const li = document.querySelector(`.tl-item[data-di="${nn.di}"][data-si="${si}"]`);
  if (li) li.scrollIntoView({ behavior: "smooth", block: "center" });
}
let nowTimer = null;
export function startNowTicker() {
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

// ---------- tabs ----------
export function buildTabs() {
  const tabs = $("#tabs");
  const dayTabs = days().map((d, i) => `
    <button class="tab" role="tab" data-idx="${i}" aria-selected="${i === state.currentDay}" style="--tab-color:${dayColor(i)}">
      <span class="dot"></span>${esc(d.label || t("trip.day.dayN", "Day {n}", { n: i + 1 }))}</button>`).join("");
  const allTab = days().length > 1 ? `<button class="tab tab-all" role="tab" data-idx="all" aria-selected="${state.currentDay === "all"}" style="--tab-color:${ALL_COLOR}"><span class="dot dot-all"></span>${esc(t("trip.tabs.all", "All"))}</button>` : "";
  tabs.innerHTML = dayTabs + allTab;
  tabs.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => selectDay(b.dataset.idx === "all" ? "all" : Number(b.dataset.idx))));
}
export function selectDay(i, initial) {
  state.currentDay = i; state.activeIdx = -1;
  const isAll = i === "all";
  document.documentElement.style.setProperty("--day", isAll ? ALL_COLOR : dayColor(i));
  $("#tabs").querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.idx === String(i)));
  try { history.replaceState(null, "", location.pathname + location.search + (isAll ? "#all" : "#day" + (Number(i) + 1))); } catch (_) {}
  buildFlat(); renderSheet(); renderMap();
  if (!initial) fitView(true);
}

// ---------- render all ----------
export function renderAll() {
  $("#brand-title").textContent = (state.data && state.data.trip && state.data.trip.name) || state.itin.title || t("trip.brand.itinerary", "Itinerary");
  { const eb = $("#brand-eyebrow"); const txt = (state.itin.title && state.data && state.data.trip && state.itin.title !== state.data.trip.name) ? state.itin.title : ""; eb.textContent = txt; eb.hidden = !txt; }
  $("#trip-chip").textContent = days().length ? (days().length > 1 ? t("trip.chip.days", "{n} days", { n: days().length }) : t("trip.chip.day", "{n} day", { n: days().length })) : "";
  const bl = $("#bills-link"); if (bl && tripId) bl.href = "/split/?t=" + encodeURIComponent(tripId);
  if (typeof state.currentDay === "number" && !days()[state.currentDay]) state.currentDay = days().length ? 0 : "all";
  buildTabs(); selectDay(state.currentDay, true);
  applyAuthUI();
}
export function applyAuthUI() {
  document.body.classList.toggle("is-editing", state.editing);
  $("#editToggle").textContent = state.editing ? t("common.done", "Done") : t("common.edit", "Edit");
  $("#editToggle").setAttribute("aria-pressed", state.editing ? "true" : "false");
  document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !state.admin; });
  $("#profileBtn").hidden = !(state.authed && state.editing);
  $("#aiBtn").hidden = !(state.admin && state.aiEnabled);
  $("#logoutBtn").hidden = !state.admin;
}
