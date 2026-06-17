# Trip Planner — Feature Build Design

**Date:** 2026-06-17
**Status:** Approved to build (owner waived per-feature confirmation; bar = "everything reasoned")
**Informed by:** 7-agent ideation sweep (6 lenses + synthesis) grounded in the codebase.

---

## Owner's explicit priorities (build these first)
1. **Per-leg transport mode that changes the map** — ✈️ flight = curved great-circle arc, 🚗 car / 🛵 scooter = road geometry, 🚌 public / 🚶 walk / ⛴️ boat = their own styled legs.
2. **Budgeting** — planned cost per stop + trip/day target, planned-vs-actual against Bills.
3. **AI fills source links** — Google Maps / Agoda·Booking / tickets per place.
4. **Time calculations** — leg drive-times (from OSRM, already fetched) + visit durations → auto day timeline, leave-by/arrival.
5. **Wider preferences incl. dates** — a trip Profile (dates, budget, pace, interests, dietary/halal, group, mobility) that tailors the AI and the public page.

## Two keystones (ship before the rest — everything reads from them)
- **K1 · OSRM leg capture** — the day-route OSRM call already returns `routes[0].legs[].duration/distance` + totals; we discard them. Capture into `routeCache[sig] = { line, legs:[{dur,dist}], total:{dur,dist} }`. Unblocks leg pills, day totals, leave-by, auto-timeline, mode-aware nav, stats strip. (Frontend-only.)
- **K2 · Trip Profile** — `Profile` on `TripDoc` (nil-safe, additive), saved via its own `PUT /api/trips/{id}/profile` so an AI *Replace* can't wipe it. Spine of: profile-steered AI, dates, filters, dietary "good to know", budget, weather.

---

## Model additions (api/model.go — all `omitempty`, nil-safe, backward compatible)

```go
type StopLinks struct { Maps, Booking, Tickets, Site string `json:",omitempty"` }

// Stop gains:
Mode        string     `json:"mode,omitempty"`        // arrival mode: car|scooter|walk|boat|flight|public|taxi
DurationMin int        `json:"durationMin,omitempty"` // planned visit length
Cost        int64      `json:"cost,omitempty"`        // estimated cost, minor units (planning only; actual = Bills)
Links       *StopLinks `json:"links,omitempty"`       // typed source links
Address     string     `json:"address,omitempty"`
Phone       string     `json:"phone,omitempty"`       // STRIPPED from the public payload

type Profile struct {
  StartDate    string   `json:"startDate,omitempty"`   // ISO yyyy-mm-dd → derives day dates
  Pace         string   `json:"pace,omitempty"`        // relaxed|balanced|packed
  BudgetLevel  string   `json:"budgetLevel,omitempty"` // shoestring|mid|comfort|lux
  DailyTarget  int64    `json:"dailyTarget,omitempty"` // minor units, optional
  Interests    []string `json:"interests,omitempty"`
  Dietary      []string `json:"dietary,omitempty"`     // halal|veg|vegan|none
  Adults, Kids int      `json:",omitempty"`
  Mobility     string   `json:"mobility,omitempty"`    // easy|moderate|active
  HomeCurrency string   `json:"homeCurrency,omitempty"`
}
// TripDoc gains: Profile *Profile `json:"profile,omitempty"`
```

Backward compatible: old trips have nil Profile / empty fields and render exactly as before.

## Public-payload contract (unchanged principle)
`handlePublicItinerary` stays money-free: it MAY expose a **sanitized** Profile subset (pace, dietary, interests, group makeup, dates) for the recruiting "Good to know" strip, but **never** budget amounts, `Cost`, `Phone`, or booking refs.

---

## Build increments (each: build → deploy app/api → verify data-sha unchanged → verify live)

**1 · Transport modes + mode-aware map + leg times** *(headline #1, #4-partial)*
- Model: `Stop.Mode`, `Stop.Links`, `Stop.DurationMin`.
- K1 OSRM leg capture.
- `drawRoutes` → **per-leg, mode-aware**: group consecutive pins; render each leg by mode — flight = dashed great-circle arc (computed locally, plane glyph), boat = dashed sea line, walk = dotted, car/scooter/taxi/public = OSRM road geometry (styled per mode). Honest note: the public OSRM demo is car-only, so scooter/bike approximate via the driving road and walk uses a short straight dotted line.
- Leg pill on each non-first pinned stop: `🚗 23 min · 18 km` (OSRM leg, or great-circle for flight/boat); mode glyph on the card.
- Stop dialog: **Mode** select + **source-link** fields (Maps/Booking/Tickets) + **visit duration**.
- Stop card: link chips (Maps / Booking / Tickets) + duration + mode.

**2 · Trip Profile + real dates + profile-steered AI + AI source links** *(#5, #3)*
- Model: `TripDoc.Profile`; `PUT /profile`. Public endpoint exposes sanitized subset.
- "Edit trip" profile dialog (dates, pace, budget, interests, dietary, group, mobility); profile summary card; presets ("Family+halal+relaxed", …).
- Real dates: derive day labels from `StartDate` via `Intl.DateTimeFormat`; auto-select today's day on boot when in range.
- AI: feed Profile into the DeepSeek prompt (pace→stops/day, budget→tone, interests→bias, **dietary→hard constraint**, group, mobility, dates→season/weekday); AI returns per-stop `mode`, `links{maps,booking,tickets}`, `durationMin`, transfer note.

**3 · Time calculations + budgeting** *(#4, #2)*
- Auto day timeline: chain `DurationMin` + OSRM leg durations from a day start → arrive/leave-by clock times; "leave [prev] by 13:18" back-solver for fixed-time stops (red when infeasible).
- Budget gauge (authed only): `Profile.DailyTarget` vs planned (Σ stop `Cost`) vs actual (Σ linked expenses) — per day + trip total; over-target glows amber. Money stays integer minor units; settlement untouched in Bills.

**4 · Supporting high-value (as budget allows)** — per-day weather + sunrise/sunset (open-meteo, keyless), Now/Next spotlight + auto-focus, native Share + per-day deep links, trip-stats strip + public at-a-glance hero, "I'm in" RSVP wall (public, rate-limited), preference filters + dietary badges, checklist (revive dead `.reminders` CSS), duplicate/move stops & days.

**Later / bigger bets** — offline PWA (service worker + tile/route cache), server-rendered OG link preview + generated SVG cover, marker clustering on "All", server-side route-geometry cache.

---

## Cross-cutting reasoning
- **Reuse, don't add:** every Go change reuses the mutate-under-mutex + Rev-bump + omitempty-additive + atomic-write idioms; every UI change reuses existing dialog/chip/pill/dimming patterns. No third-party deps, no build step.
- **Dependency spine:** K1 (leg times) → leg pills, totals, leave-by, timeline, nav. K2 (Profile) → AI, dates, filters, budget, weather, public strip. Real dates → weather, now/next, countdown, timeline.
- **The interlock:** Profile + per-leg mode + visit duration + estimated cost are the new primitives; generation, the map, the timeline, and budgeting all read the same fields — so an AI-generated trip arrives fully fleshed (links, modes, durations, costs) and every downstream view "just works."
