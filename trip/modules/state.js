export const state = {
  pass: localStorage.getItem("balitrip-pass") || "",
  admin: false,
  aiEnabled: false,
  authed: false,
  editing: false,
  data: null,       // { trip, people, itinerary, profile?, rev } from the public endpoint
  itin: { title: "", days: [] },
  signups: [],      // [{name, count, at}] — public join wall
  capacity: 0,      // max travelers; 0 = no cap
  profile: null,    // sanitized (public) or full (authed) trip profile
  fullDoc: null,    // full trip doc (expenses/receipts) once authed — for cost links
  draft: null,      // AI draft under review
  currentDay: 0,    // index or "all"
  lastRev: -1,
  lockIntent: null, // what to do after unlocking: "edit" | fn
  _dateFmt: null,
  activeIdx: -1,
};
