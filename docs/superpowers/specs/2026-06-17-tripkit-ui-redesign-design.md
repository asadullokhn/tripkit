# Tripkit UI Redesign — Design Spec

**Date:** 2026-06-17
**Status:** Draft for approval
**Author:** Claude (with owner)

---

## 1. Goal & constraints

Redesign the Tripkit UI across all three surfaces (public **landing**, public **/trip** itinerary, passcode-gated **/split** bills) so that:

- It follows the owner's Obsidian rule packs — **PWA Enterprise Rules**, **Landing Page Enterprise Rules** — and **Apple HIG**.
- It stays **fun** (the dark "dusk" personality is an asset, not a liability).
- **Every visible element is reasoned** — nothing exists "because of nothing."
- **No data is lost**; work ships in **deploy-and-verify increments**.

### Decisions locked (owner, 2026-06-17)

| Decision | Choice |
|---|---|
| Scope | **Full redesign** — cleanup + HIG fixes + installable PWA + refreshed visual system across all surfaces |
| Aesthetic | **Refine the current dusk** — keep deep-teal + grain + Bricolage/Hanken/DM-Mono, tighten ramp/spacing/accent/motion |
| Half-built features | **Build all three** — map-pick for stop location, mark-stop-as-done, road-following routes |

---

## 2. The "reasoned" bar (the governing test)

Every element that survives must pass one test:

> **Does this do a job that nothing else on the screen already does?**

- If two elements state the same fact → keep one (the canonical placement), kill the rest.
- If an element is decorative *and* costs the user attention/height/ambiguity → kill it. (Pure-decoration that costs nothing — e.g. the `aria-hidden` 4% grain — may stay; it adds atmosphere without adding a word to parse.)
- If a feature is styled but never built → it must **become real or be deleted**. No styled ghosts.

This is the explicit standard behind every "kill"/"merge" below.

---

## 3. Unified design system (refine-dusk)

A single shared token stylesheet (`shared/tokens.css`) imported by all three surfaces — today each surface re-declares its own colors/fonts, which is why the three `theme-color`s drifted.

### 3.1 Color (one canonical theme, AA-tuned)

```
--base:       #0b1411   /* deepest bg; the ONE theme-color everywhere */
--surface-1:  #0f1c18   /* cards / sheet */
--surface-2:  #15261f   /* raised / inputs */
--line:       rgba(160,200,190,.12)  /* hairlines */
--ink:        #f2f7f4   /* primary text (near-white, never #fff) */
--muted:      #a6bcb4   /* secondary text — ≥4.5:1 on surfaces */
--faint:      #8aa49c   /* micro/mono labels — retuned UP from #5f7d7c to pass AA */
--accent:     #34dfc0   /* the ONE teal accent — CTAs, active states only */
--accent-ink: #05241e   /* text/icon on accent fills */
--danger:     #ff6f6f   /* destructive only */
```

One accent. Destructive gets its own persistent color (not hover-only — HIG). Contrast: body text ≥ 4.5:1, retuning `--faint` is a required fix (today's `#5f7d7c` fails).

### 3.2 Type

- **Display** — Bricolage Grotesque. H1 `clamp(28px, 7vw, 44px)` mobile → up to 64–72px desktop, tracking −0.02 to −0.03em.
- **Body** — Hanken Grotesque, **16px minimum**, line-height 1.5–1.6, measure 60–75ch where prose.
- **Mono/numerals** — DM Mono for money, counts, codes, eyebrows.
- `font-display: swap`; preload the H1 weight (protects LCP on the public surfaces).

### 3.3 Spacing / shape / motion

- Spacing scale: `4 8 12 16 20 24 32`.
- Radii: `10 / 14 / 20`, pill `999`.
- Motion: `160ms` standard, `220ms` sheets/dialogs, easing `cubic-bezier(.22,1,.36,1)` for entrances; **`prefers-reduced-motion` → 0ms + static grain**. Transform/opacity only.
- One soft layered shadow token for raised surfaces.

### 3.4 Touch & gesture (HIG)

- **Every interactive control has a ≥44×44pt hit region** (visible art may be smaller via padding/`::before`).
- `-webkit-tap-highlight-color: transparent` **paired with** explicit `:active`/`:focus-visible` so taps still give feedback.
- Pinch-zoom never disabled. `overscroll-behavior: contain` on inner scrollers; never `overflow:hidden` on `body`.
- `focus-visible` rings on **all** interactive elements (today ghost/solid/copy buttons rely on suppressed UA outlines).

---

## 4. App shell, PWA & navigation

The single biggest system gap: it's three standalone pages with no shared shell, no manifest, three theme-colors.

- **`manifest.webmanifest`** — `name "Tripkit"`, `short_name "Tripkit"`, `description`, `start_url "/"` (no query string), `display "standalone"`, `background_color` + `theme_color = #0b1411`.
- **Icon set** — `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon-180.png`, `favicon.ico` (derived from the existing `favicon.svg` split-disc pin).
- **iOS meta block** on every page — `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title=Tripkit`, `viewport-fit=cover`.
- **One `theme-color` (`#0b1411`)** across all three surfaces so the iOS status bar doesn't flip between views.
- **Shared shell pattern** — one topbar idiom (brand/home + context title + the Plan⇄Bills switch + auth), consistent across surfaces. The installed PWA has no browser back, so **every surface provides explicit in-app back/up**. No mixing of nav patterns.
- **Safe-area insets** — `env(safe-area-inset-*)` on every fixed/edge bar: topbars (`-top`), FABs and the settle sheet (`-bottom`), and full-bleed overlays. Today only left/right are handled in places.
- **Caching** — keep network-first HTML + hash/`?v=` asset busting (per the pack, a static app like this does **not** need a service worker); make the version bump part of the deploy step so it can't be forgotten. No SW.

---

## 5. Surface-by-surface plan

### 5.1 Landing (`index.html`) — internal dashboard, not a marketing page

Rationale: the **public face you share to recruit is `/trip`**, not the landing. So the landing stays a clean, fast trip **dashboard** — we apply Landing-pack *hygiene* (one clear value line, CWV, no decoration tax) without inflating it into a 4-fold hero.

**Kill / fix:**
- **Kill** the `Plan · Split · Settle` kicker, the lock-screen `Tripkit` kicker, the `Open splitter →` fake button, the duplicate `+ New trip` header button (keep the dashed "New trip" card — more discoverable), the per-card `🧾` icon (identical on every card → zero info), and the footer feature clause.
- **Fix** the hardcoded `balitrip.teztun.uz` in the footer → derive from `location.host` or drop it (this app is meant to be self-hosted/open-source).
- **Critical — trip card restructure:** today the card stacks the full-card `<a>`, the itinerary chip, and admin ✎/✕ as **overlapping** interactive elements inside one anchor (invalid HTML, coin-flip hit-testing). Restructure to **sibling** controls in a card container (not nested in the anchor): a primary "open trip" target, a clearly separate **Itinerary** link (the recruit's path → must be easy to hit, ≥44pt), and admin actions in their own row.
- **Delete is visually distinct always** (not hover-only color) and ≥44pt; rename ≥44pt.
- **Auth clarity** — reconcile the two secrets: the instance **passcode** (view gate) vs the **admin password** (edit rights). Label them so it's obvious which unlocks what (e.g. lock = "Enter passcode to view", login dialog = "Admin password to edit"). No behavior change to the auth tiers themselves.
- Safe-area top/bottom; AA contrast; retry affordance on the "Couldn't load trips" error.

### 5.2 Trip (`trip/`) — content-first public itinerary

This is the shared/recruiting surface → maximum **deference**: minimal chrome, the day-by-day plan dominates.

**Safety & HIG (highest priority):**
- **Wire the existing-but-unused confirm dialog** into the three destructive actions: **delete stop**, **delete day** (drops all its stops), **AI Replace** (overwrites the saved plan). Today all three mutate immediately. This is the single most serious gap.
- **Re-enable pinch-zoom** — remove `maximum-scale=1.0, user-scalable=no` (a11y violation); match `/split`'s correct viewport.
- Raise sub-44pt controls: Locate/Recenter FABs (42→44+), per-stop `.se` buttons (34→44 hit region), day reorder/edit buttons, sheet-hide (30→44). FABs get `safe-area-inset-bottom`.
- Give icon-only edit controls (`▲ ▼ ✎ 💸`) visible labels or accessible equivalents (tooltips don't exist on touch).
- Geolocation failure must surface a toast (today the error callback is a silent no-op).

**Reasoned cleanup:**
- **Kill** the brand eyebrow that renders the literal word "Itinerary"; **kill** the `<n> sights` chip (restates the timeline + trip-chip).
- **Merge** the two auth entry points — `Edit` and `Log in` do the identical unlock. One auth control.
- **Delete dead CSS** blocks: reminders, sheet-foot, legend, group-* header, day-intro, star ratings, `.route-path`/`@keyframes draw`, and the duplicate home-link/bills-link rules.
- Reconcile the stop **Type** dropdown labels with the JS `TYPE` map (single source of truth; `depart` has no option, labels drift).

**Build the three features (all reasoned-in, not deleted):**
- **Map-pick for location** — replace raw lat/lng typing with: tap "Set on map" → drop/drag a pin; **or** paste a Google/Apple Maps URL → parse to lat/lng. Keep raw fields collapsed for power users. (`hasPin` already treats `0,0` as "no pin".)
- **Mark stop as done** — wire the existing dead "done" CSS into a real timeline check-off. **Persistence:** add a `done bool` to the `Stop` model (shared group state — the whole group sees progress), saved via the existing editor-tier itinerary `PUT`. Public viewers see done-state read-only.
- **Road-following routes** — replace straight dashed polylines with real road geometry. **Approach:** the stale precomputed `routes.js` is deleted (it goes stale the moment stops change); instead fetch route geometry **on demand** from the public OSRM router for any day with ≥2 pins, with a **straight-line fallback** if the call fails, and cache per-day geometry in memory. Same external-dependency posture as the existing CARTO tiles; documented. Lowest-priority increment.

### 5.3 Split (`split/`) — the strongest surface, extend it

The split page is already well-built (native dialogs, themed confirm, debounced saves with rollback/undo, OCR + proof/verify lifecycle). Keep its correct viewport. Cuts + dedupe:

**Reasoned cleanup:**
- **Kill** the lock `Split the Bill` kicker; **fix** the `in this trip` hint (drop or make it a live count); **rename** `+ Add` → `+ Adjustment` (every other add names its noun); **merge** the two near-identical teaching hints into one mental model; **drop** the `Copied` toast (the inline ✓ already confirms — double feedback); show `payout: not set` **only on receivers** (net>0), never on debtors.
- **Biggest dedupe:** the settle sheet renders a **full duplicate** of the "Who pays whom" transfer list (`#transfers` / `renderPlanMirror`). **Remove it.** The settle sheet's job = per-person **balances + manual adjustments**; the **Final Settlement** section owns the single transfer list. Collapse the **three** copies of the "N lines unassigned" message to **one** (the final note).
- Empty delete-cost confirm body → add a consequence sentence (matches person/receipt deletes). Standardize the four "all settled / all square" empty strings into one consistent rule (and make the square-vs-settled distinction explicit if intended).
- Align the "Everyone/Clear" quick chips vs picker "Select all/Clear" naming; clarify "Distribute evenly" vs the "Evenly" split mode (rename the button, e.g. "Even out").

**HIG / PWA:**
- Settle sheet & dialogs **dismiss via explicit control + tap-outside (scrim)** — per the PWA rule, never swipe-/drag-only. The grip stays as a *tappable* close affordance; drag is a progressive enhancement, never the only way out.
- `safe-area-inset-bottom` on the FAB and sticky settle panel; `safe-area-inset-top` on the topbar (for standalone translucent status bar).
- ≥44pt hit regions on `.mini-btn`, `.copy-btn`, `.edit-btn`, `.ghost-btn--sm`, `.adjust__del`; `focus-visible` on ghost/solid/copy/link buttons; AA contrast on `--faint` micro-text.
- 30s timeout on API fetches; keep loading/disabled/error visually distinct on Unlock/Save/Add (spinner+disabled, not just dimmed); never clear a form before a confirmed response.

---

## 6. Motion & "fun" (within HIG deference)

- One **staggered page-load reveal** per surface (opacity+translate, `animation-delay`) — the high-impact "alive" moment.
- Sheets/dialogs use physical, reversible transitions (up = deeper, dismiss = back).
- Micro-interactions on the repeated actions: person-chip toggle, day-tab switch, mark-done check, copy ✓.
- **Never** animate the CTA; honor `prefers-reduced-motion` (static end-state, static grain).
- Fun comes from **color, grain, type personality, and responsive motion** — not from added controls or text.

---

## 7. Accessibility, errors & states

- WCAG AA contrast throughout (drives the `--faint`/`--muted` retune).
- `focus-visible` on every interactive element; visible focus that survives the dark theme.
- 44pt targets; pinch-zoom enabled; safe areas respected.
- Three distinct states (loading / disabled / error) on every async action; 30s fetch ceiling; no silent input loss; skeletons (not spinners) for >200ms loads where layout is known.
- Destructive actions always confirm with a **consequence sentence**.

---

## 8. Increment & deploy plan (no data loss)

Each increment: build → deploy `app`/`api` on the Windows host → **verify data sha unchanged before/after** → verify live.

1. **Foundation** — `shared/tokens.css`, `manifest.webmanifest`, icon set, iOS meta, one theme-color, safe-area utilities, focus/touch baseline. (No behavior change.)
2. **Landing** — kill-list, trip-card restructure, auth-label clarity, contrast/targets.
3. **Split** — kill-list, settle-sheet de-dupe (remove mirror + single unassigned note), dismissal/safe-area/targets/contrast, confirm-body + empty-string fixes.
4. **Trip — safety & cleanup** — wire confirms, re-enable zoom, dead-CSS purge, merge auth, targets, geolocation feedback, type-map reconcile.
5. **Trip — features** — map-pick, mark-as-done (incl. `Stop.done` model field).
6. **Trip — road routes** — OSRM-on-demand geometry + fallback; delete `routes.js`.

Increments 1–4 are pure front-end (zero API change). Increment 5 adds one optional `bool` field to the `Stop` model (backward-compatible). Increment 6 is front-end + external OSRM fetch.

---

## 9. Testing

- Playwright snapshots at **390px** (phone-first) and a desktop width for each surface, before/after.
- Manual **install test on iOS** (standalone launch, status-bar overlap, home-indicator overlap, icon).
- Assert **no horizontal page scroll** at 390px (`scrollWidth === clientWidth`).
- Contrast spot-check on `--faint`/`--muted`/badges.
- Verify the trip-card hit-testing (itinerary vs splitter no longer ambiguous).
- **Data integrity:** capture the trips-dir sha before each deploy and confirm it's identical after (the established pattern); confirm Plan A settlement + itinerary intact.

---

## 10. Out of scope

- No change to auth **tiers**, settlement **math**, OCR/AI pipelines, or the data model **except** the additive `Stop.done` bool.
- Landing is **not** turned into a multi-fold marketing hero (the public face is `/trip`).
- No service worker / offline shell (per the PWA pack, unnecessary here).
- DeepSeek vision OCR remains impossible until a vision key is supplied — unchanged.
