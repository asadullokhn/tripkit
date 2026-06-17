export const API = "/api";
export const PASS_KEY = "balitrip-pass";
export const PALETTE = ["#ff6f59", "#2fd6c3", "#ffb454", "#c08cff", "#7bd88f", "#ff8fc7", "#ffd66b", "#6cb8ff"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const BIG = 8; // >BIG people switches to condensed (avatar + picker) UI
export const grp = new Intl.NumberFormat("en-US");

export const saveQueue = {};      // entityKey -> { timer, snap } (debounced writes + rollback snapshot)

export const state = {
  tripId: new URLSearchParams(location.search).get("t") || "",
  doc: null,
  pass: "",
  admin: false,
  loginEnabled: false,
  ocrEnabled: false,
  CUR: "IDR",
  personById: {},
  personColor: {},
  inflight: 0,          // in-flight writes
  sheetDragging: false, // bottom-sheet mid-gesture
  pendingDoc: null,     // doc from poll deferred while busy/dialog-open
  lastSyncStatus: "syncing",
};
