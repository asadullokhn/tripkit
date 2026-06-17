import { state } from "./state.js";

export const API = "/api", PASS_KEY = "balitrip-pass";
export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const tripId = new URLSearchParams(location.search).get("t");

// i18n shim (no-op if /shared/i18n.js failed to load)
export const I18N = window.I18N || { t: (k, d) => (d != null ? d : k), mount() {}, lang: "en" };
export const t = (k, d, v) => I18N.t(k, d, v);

// --- type catalogue (icon + gradient + label) ---
export const TYPE = {
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
export const typeOf = (t) => TYPE[t] || TYPE.activity;
export const typeKeyOf = (t) => (TYPE[t] ? t : "activity");
export const typeLabel = (t) => I18N.t("trip.type." + typeKeyOf(t), typeOf(t).label);
export const LOGI = new Set(["start", "fuel", "breakfast", "food", "hotel", "depart", "beach", "finish"]);

export const DAYCOLORS = ["#35b06a", "#25b9cc", "#f0884a", "#c08cff", "#ff6f59", "#ffd66b", "#7bd88f", "#2fd6c3"];
export const dayColor = (i) => DAYCOLORS[i % DAYCOLORS.length];
export const ALL_COLOR = "#aebbb0";

export const days = () => (state.itin && Array.isArray(state.itin.days) ? state.itin.days : []);
// badge: logistics → type emoji; sights → running number within the day
export function badgeFor(day, stop, si) {
  if (LOGI.has(stop.type)) return typeOf(stop.type).icon;
  let n = 0;
  for (let k = 0; k <= si; k++) if (!LOGI.has(day.stops[k].type)) n++;
  return String(n);
}
export const hasPin = (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && (s.lat !== 0 || s.lng !== 0);

// ---------- profile vocab + helpers ----------
export const PACE_LABEL = { relaxed: "Relaxed", balanced: "Balanced", packed: "Packed" };
export const BUDGET_LABEL = { shoestring: "Shoestring", mid: "Mid", comfort: "Comfort", lux: "Lux" };
export const MOBILITY_LABEL = { easy: "Easy walking", moderate: "Some walking", active: "Active days" };
export const DIET_OPTS = ["halal", "veg", "vegan", "no-pork", "no-alcohol", "gluten-free"];
export const DIET_LABEL = { halal: "Halal", veg: "Vegetarian", vegan: "Vegan", "no-pork": "No pork", "no-alcohol": "No alcohol", "gluten-free": "Gluten-free" };
export const DIET_KEY = { halal: "halal", veg: "veg", vegan: "vegan", "no-pork": "noPork", "no-alcohol": "noAlcohol", "gluten-free": "glutenFree" };
export const paceLabel = (k) => PACE_LABEL[k] ? I18N.t("trip.pace." + k, PACE_LABEL[k]) : "";
export const budgetLabel = (k) => BUDGET_LABEL[k] ? I18N.t("trip.budget." + k, BUDGET_LABEL[k]) : "";
export const mobilityLabel = (k) => MOBILITY_LABEL[k] ? I18N.t("trip.mobility." + k, MOBILITY_LABEL[k]) : "";
export const dietLabel = (k) => I18N.t("trip.diet." + (DIET_KEY[k] || k), DIET_LABEL[k] || k);
// derive a Date for day index from profile.startDate (ISO yyyy-mm-dd), local-time, DST-safe
export function dayDate(idx) {
  const sd = state.profile && state.profile.startDate; if (!sd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(sd); if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]); if (isNaN(d)) return null;
  d.setDate(d.getDate() + idx); return d;
}
export function fmtDayDate(d) {
  if (!d) return "";
  try { if (!state._dateFmt) state._dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }); return state._dateFmt.format(d); }
  catch (_) { return ""; }
}
export const dateKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
export function fmtDuration(min) {
  min = Math.round(min); if (!(min > 0)) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
export const mapsSearchUrl = (name) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(name || "");

// ---------- money (integer minor units = whole IDR) ----------
export function moneyRp(n) {
  n = Math.round(+n || 0);
  if (n >= 1000000) { const m = n / 1000000; return "Rp " + (m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")) + "M"; }
  if (n >= 1000) { const k = n / 1000; return "Rp " + (k >= 100 ? Math.round(k) : k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, "")) + "k"; }
  return "Rp " + n;
}
// actual cost (in whole IDR) backing a stop's linked expense/receipt, if any (authed only)
export function actualCost(stop) {
  if (!stop.linkedExpenseId || !state.fullDoc) return null;
  const e = (state.fullDoc.expenses || []).find((x) => x.id === stop.linkedExpenseId);
  if (e) return Math.round(+e.amount || 0);
  const r = (state.fullDoc.receipts || []).find((x) => x.id === stop.linkedExpenseId);
  if (r) return Math.round(+r.grandTotal || 0);
  return null;
}

// ---------- time helpers ----------
// parse a manual time string ("8:30", "08:30", "8.30", "8h30", "20:00") → minutes since midnight, or null
export function parseTimeMin(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})\s*[:.h]\s*(\d{2})/) || String(s).match(/^\s*(\d{1,2})\s*$/);
  if (!m) return null;
  let h = +m[1], min = m[2] != null ? +m[2] : 0;
  if (!(h >= 0 && h < 24) || !(min >= 0 && min < 60)) return null;
  return h * 60 + min;
}
export const fmtClock = (mins) => { mins = ((Math.round(mins) % 1440) + 1440) % 1440; return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0"); };

// ---------- API ----------
export async function api(path, opts = {}) {
  const headers = {};
  if (state.pass) headers["X-Passcode"] = state.pass;
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
  const res = await fetch(API + path, { method: opts.method || "GET", headers, body, credentials: "same-origin" });
  if (!res.ok) { const e = new Error("api " + res.status); e.code = res.status; try { e.body = await res.json(); } catch (_) {} throw e; }
  return res.status === 204 ? null : res.json();
}

// ---------- toast + spinner ----------
let toastBox;
export function toast(msg, type) {
  if (!toastBox) { toastBox = document.createElement("div"); toastBox.className = "toasts"; document.body.appendChild(toastBox); }
  const t = document.createElement("div"); t.className = "toast" + (type === "err" ? " toast--err" : ""); t.textContent = msg;
  toastBox.appendChild(t); setTimeout(() => t.classList.add("in"), 10);
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, 3200);
}
