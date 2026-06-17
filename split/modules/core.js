import { state, API, PALETTE, MONTHS, BIG, grp } from "./state.js";

let _render = () => {};
export function setRender(fn) { _render = fn; }

export const canEdit = true;   // any passcode user can edit money entries (editor tier); admin adds people/trip

export const $ = (s) => document.querySelector(s);
export const money = (n) => (state.CUR === "IDR" ? "Rp " : state.CUR + " ") + grp.format(Math.round(n || 0));
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const cacheKey = () => "balitrip-trip-" + state.tripId;
export const sumItems = (items) => (items || []).reduce((s, it) => s + (it.lineTotal || 0), 0);
export const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
export const bigMode = () => (state.doc && state.doc.people && state.doc.people.length > BIG);

export function fmtWhen(date, time) {
  let out = "";
  if (date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (m) out = parseInt(m[3], 10) + " " + (MONTHS[parseInt(m[2], 10) - 1] || "");
  }
  if (time) out += (out ? " · " : "") + String(time).slice(0, 5);
  return out.trim();
}
export const dateSortKey = (r) => (r.date || "9999-99-99") + " " + (r.time || "99:99");

// distinct color for any index (palette first 8 — unchanged; golden-angle HSL beyond)
export function genColor(i) { return i < PALETTE.length ? PALETTE[i] : `hsl(${Math.round((i * 137.508) % 360)} 65% 62%)`; }

// ---------- toasts (aria-live, framework-free) ----------
let toastWrap = null;
export function ensureToasts() {
  if (toastWrap) return toastWrap;
  toastWrap = document.createElement("div");
  toastWrap.className = "toasts"; toastWrap.setAttribute("aria-live", "polite"); toastWrap.setAttribute("aria-atomic", "false");
  document.body.appendChild(toastWrap);
  return toastWrap;
}
export function toast(msg, opts = {}) {
  const w = ensureToasts();
  const t = document.createElement("div");
  t.className = "toast" + (opts.type === "err" ? " toast--err" : opts.type === "ok" ? " toast--ok" : "");
  t.setAttribute("role", opts.type === "err" ? "alert" : "status");
  const span = document.createElement("span"); span.textContent = msg; t.appendChild(span);
  if (opts.action && opts.actionLabel) {
    const b = document.createElement("button"); b.type = "button"; b.className = "toast__action"; b.textContent = opts.actionLabel;
    b.addEventListener("click", () => { remove(); opts.action(); });
    t.appendChild(b);
  }
  w.appendChild(t);
  let done = false;
  function remove() { if (done) return; done = true; t.classList.add("toast--out"); setTimeout(() => t.remove(), 200); }
  setTimeout(remove, opts.ms || (opts.action ? 6000 : 2600));
  return remove;
}

// --- api ---
export async function api(path, opts = {}) {
  const headers = {};
  if (state.pass) headers["X-Passcode"] = state.pass;
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
  const res = await fetch(API + path, { method: opts.method || "GET", headers, body, credentials: "same-origin" });
  if (!res.ok) {
    const e = new Error("api " + res.status); e.code = res.status;
    try { e.body = await res.json(); } catch (_) {}
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

export function adoptDoc(d) {
  if (!d || !d.trip) return;
  state.doc = d;
  state.CUR = d.trip.baseCurrency || "IDR";
  state.personById = {}; state.personColor = {};
  (d.people || []).forEach((p, i) => { state.personById[p.id] = p; state.personColor[p.id] = p.color || genColor(i); });
  cacheStore(d);
}
export function cacheStore(d) {
  try { localStorage.setItem(cacheKey(), JSON.stringify(d)); }
  catch (_) {
    try { // quota: drop other trips' caches and retry once
      Object.keys(localStorage).forEach((k) => { if (k.startsWith("balitrip-trip-") && k !== cacheKey()) localStorage.removeItem(k); });
      localStorage.setItem(cacheKey(), JSON.stringify(d));
    } catch (_2) {}
  }
}
export function cacheLoad() {
  try { const raw = localStorage.getItem(cacheKey()); if (raw) return JSON.parse(raw); } catch (_) {}
  return null;
}

export function setSync(status) {
  state.lastSyncStatus = status;
  const el = $("#sync"); if (!el) return;
  el.classList.toggle("live", status === "live");
  el.classList.toggle("offline", status === "offline");
  $("#syncLabel").textContent = status === "live" ? I18N.t("split.sync.live", "live") : status === "offline" ? I18N.t("split.sync.offline", "offline") : I18N.t("split.sync.syncing", "syncing…");
}

// A write returns the full doc; adopt + re-render. opts: { rollback, okMsg, errMsg }
export function pushDoc(promise, opts = {}) {
  state.inflight++;
  return promise
    .then((d) => { adoptDoc(d); _render(); setSync("live"); if (opts.okMsg) toast(opts.okMsg, { type: "ok" }); return d; })
    .catch((e) => {
      if (e.code === 401) { lock(I18N.t("split.lock.sessionExpired", "Session expired — enter passcode")); }
      else if (e.code === 403) { setSync("offline"); if (opts.rollback) { opts.rollback(); _render(); } toast(I18N.t("split.toast.loginToChange", "Log in to make changes"), { type: "err" }); refreshTrip(); }
      else {
        setSync("offline");
        if (opts.rollback) { opts.rollback(); _render(); }
        toast(opts.errMsg || I18N.t("split.toast.saveFailed", "Couldn't save — change undone"), { type: "err", action: opts.retry, actionLabel: opts.retry ? I18N.t("common.retry", "Retry") : undefined });
      }
      throw e;
    })
    .finally(() => { state.inflight = Math.max(0, state.inflight - 1); if (state.inflight === 0) flushPending(); });
}

export const pname = (id) => (state.personById[id] ? state.personById[id].name : "—");
export const pcol = (id) => state.personColor[id] || "var(--teal)";
export const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

export function showSpinner(msg) { const s = $("#ocrSpinner"); if (!s) return; const sp = s.querySelector("span"); if (sp) sp.textContent = msg || I18N.t("split.spinner.working", "Working…"); s.hidden = false; }
export function hideSpinner() { const s = $("#ocrSpinner"); if (s) s.hidden = true; }

// copy to clipboard
export function copyText(text, btn) {
  const done = () => { if (btn) { const o = btn.innerHTML; btn.innerHTML = `<span aria-hidden="true">✓</span>`; setTimeout(() => { btn.innerHTML = o; }, 1200); } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}
export function fallbackCopy(text, done) {
  try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand("copy"); ta.remove(); done(); }
  catch (_) { toast(I18N.t("split.toast.copyFailed", "Couldn't copy"), { type: "err" }); }
}

// ---------- passcode gate ----------
export function lock(msg) {
  const el = $("#lock"); const wasOpen = !el.hidden; el.hidden = false;
  if (msg) {
    $("#lockErr").textContent = msg;
    if (wasOpen) { const card = el.querySelector(".lock__card"); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); }
  }
  setTimeout(() => $("#lockInput").focus(), 60);
}

// ---------- poll guard ----------
export function flushPending() {
  if (!state.pendingDoc) return;
  if (state.inflight > 0 || document.querySelector("dialog[open]") || (state.sheetDragging)) return;
  const d = state.pendingDoc; state.pendingDoc = null;
  const y = window.scrollY; adoptDoc(d); _render(); window.scrollTo(0, y);
  toast(I18N.t("split.toast.updated", "Updated — refreshed"), { type: "ok", ms: 1800 });
}

// ---------- boot / polling ----------
export async function refreshTrip() {
  try { const d = await api("/trips/" + state.tripId); adoptDoc(d); _render(); setSync("live"); } catch (e) { if (e.code === 401) lock(I18N.t("split.lock.enterPasscode", "Enter passcode")); else setSync("offline"); }
}
