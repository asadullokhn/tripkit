# Tripkit — UX + Scaling Improvement Spec

_Synthesized from a multi-perspective audit (components/modals, 10+ scaling, a11y/mobile, robustness, flows). Drives the world-class polish + itinerary work._

Confirmed: the poll (704-711) calls `adoptDoc(d); render()` unconditionally on any rev change, with only a `document.hidden` guard — no dialog-open guard, no inflight guard. All the load-bearing claims across the five reviews check out against the actual source. I have enough verified grounding to write the spec.

The source of truth is `/Users/asadullokhn/CascadeProjects/Personal/balitrip/split/` (722-line app.js matching the review line refs), with the landing at `/Users/asadullokhn/CascadeProjects/Personal/balitrip/index.html` and the in-progress itinerary scaffold at `/Users/asadullokhn/CascadeProjects/Personal/balitrip/trip/`.

---

# Tripkit Improvement Spec — Synthesized & Decision-Ready

**Verified source tree:** `/Users/asadullokhn/CascadeProjects/Personal/balitrip/split/{index.html,app.js,styles.css}`, landing `/Users/asadullokhn/CascadeProjects/Personal/balitrip/index.html`, itinerary scaffold `/Users/asadullokhn/CascadeProjects/Personal/balitrip/trip/`. All line refs below confirmed against this tree.

**Guiding constraint (the through-line):** every change must be invisible at ≤6 people and only activate above a threshold. The chosen threshold is **`doc.people.length <= 8` keeps today's exact inline UI**; >8 switches to condensed modes. This single rule resolves the biggest cross-review tension (scaling reviewers want avatars/pickers; the look-preservation requirement wants no regression). No build step, no framework, integer-IDR money, whole-doc sync preserved throughout.

---

## (A) MUST-FIX DEFECTS

Deduped across all five reviews. Conflicts resolved (noted inline). Effort S = <½ day, M = ~1 day, L = multi-day.

### A1. Failed writes never roll back — UI silently lies *(robustness #1, flows F8)*
- **Problem:** `toggleItemSharer`/`setItemSharers`/`toggleExpenseMember`/`setExpenseMembers` (app.js:383-397) mutate `doc` in place, `render()`, then fire the PUT. `pushDoc` (78-87) only handles 401/403; on 500/network/timeout it just calls `setSync("offline")` and re-throws into a void. The optimistic mutation stays applied, settlement recomputes from bad state, and the change vanishes on the next poll — looks like data loss.
- **World-class fix:** Snapshot the affected entity before mutating (`const snap = structuredClone(rc)`), pass a rollback closure into `pushDoc(promise, rollback)`. In the catch, for any non-401 error, run `rollback(); render()` and fire a toast ("Couldn't save — change undone", with Retry). 401 still locks.
- **File/region:** app.js:78-87 (add 2nd param), 383-397 (snapshot before each mutate).
- **Effort:** S

### A2. Lost updates between two phones on whole-entity PUT *(robustness #2)*
- **Problem:** `saveReceipt`/`saveExpense` (380-381) PUT the entire receipt/expense object. Two phones editing different items of the same receipt within the 4s window → last writer clobbers the other. `doc.rev` exists but is never sent on writes. Routine at 10+ people splitting bill-tapping across devices.
- **World-class fix (chosen):** Optimistic concurrency via rev. Client sends `If-Match: <doc.rev>` header (add in `api()`, 43-55) on all mutating calls; Go server (stdlib) compares against stored rev and returns **409** on mismatch. Client on 409: re-fetch, toast "Someone else edited — refreshed", and re-apply the local delta if the targeted item still exists. **Fallback chosen over full PATCH-per-item** (the other reviewer's alt) to avoid a large API surface change — but the server change is the one item here that touches synced data, so gate it behind the rev check and keep the existing PUT body shape.
- **Risk to synced data:** This is the highest-risk change. Mitigation: ship the client `If-Match` send + server 409 together in one step; keep the old behavior (ignore header) until the server understands it, so an old client never breaks. Back up `receipts.json`/store before deploying.
- **File/region:** app.js:43-55 (api header), 380-381; Go handler for receipt/expense PUT.
- **Effort:** M

### A3. Forms close on submit even when validation fails — silent data loss *(modals #2, flows F4, robustness #11)*
- **Problem:** All five forms use `method="dialog"` so the `<dialog>` closes on submit *before* JS validates. Empty person name (app.js:423), adjustment with from==to or amount 0 (560-561, no error element exists in that dialog), 0-rupiah expense (529), empty shares — all close silently with no feedback.
- **World-class fix:** Replace `method="dialog"` submit with a real `submit` listener calling `ev.preventDefault()`. Validate, render inline `.field__err` under the offending field, focus first invalid field, and only `dialog.close()` inside `pushDoc().then()` on success. Add an error `<p>` to the adjustment dialog (index.html:205-223).
- **File/region:** index.html:124-223 (forms + add adjust error el); app.js:422-427, 477-483, 527-532, 556-562.
- **Effort:** M

### A4. The 4s poll destroys in-progress edits *(robustness #4, scaling #4, modals #2)*
- **Problem:** `startPolling` (704-711) calls `adoptDoc(d); render()` on any rev change with only a `document.hidden` guard. A poll landing mid-tap or while a dialog has unsaved `rcItems`/`exShares` state blows away the user's work and loses scroll/focus.
- **World-class fix:** Add a poll guard: skip `adoptDoc+render` when `document.querySelector("dialog[open]")`, when an `inflight` counter > 0, or when the sheet is mid-drag. Stash the pending doc; apply it on dialog close / inflight→0. If the open dialog targets a now-changed entity, toast "updated elsewhere". Also capture/restore `scrollY` around poll-triggered renders.
- **File/region:** app.js:704-711; add `inflight` counter incremented/decremented in `pushDoc` (78-87).
- **Effort:** S

### A5. No disable-during-inflight → double-submit duplicates *(modals #3, robustness #5)*
- **Problem:** Submit handlers fire `pushDoc` and the dialog closes immediately; no button disable. Double-tap on slow connection → two people / two receipts / two expenses (POST has no idempotency). Chip bursts fire racing whole-receipt PUTs.
- **World-class fix:** On submit, disable the primary button + set `aria-busy`, swap label to "Saving…", re-enable in `.finally`. Generate a client `clientId` per create (POST body) so server can dedupe. Coalesce chip bursts: debounce the per-entity PUT ~250ms so only the latest state is sent. Pairs with A3 (keep dialog open until resolve).
- **File/region:** app.js:422-432, 477-488, 527-537, 556-562, 588 (login); 383-397 (debounce).
- **Effort:** M

### A6. Destructive actions & all landing trip CRUD use native `confirm()`/`prompt()`/`alert()` *(modals #5/#10, a11y #9, robustness #3, flows F5)*
- **Problem:** Delete person/receipt/expense use `confirm()` (429, 485, 534). Landing uses `prompt("Trip name")`, chained `prompt()` for name+currency on new trip, `prompt("Admin password")` + `alert` for login (index.html:145, 147, 160-161, 176-178). Unstyled, unfocusable, suppressible in iOS PWA, two different login UXs. This is the single biggest "doesn't feel considered" gap.
- **World-class fix:** One themed `.dialog` confirm component (focus-trapped, Esc/Enter, danger-styled primary, focus defaults to Cancel for destructive). A real "New trip"/"Edit trip" dialog: name field + currency `<select>` (validated, not free-text). Unify both pages on the themed login dialog (shake on error — `.shake` already exists styles.css:277). For person-delete, show impact ("appears on 7 items across 3 receipts — those shares are removed") computed from `compute()` data.
- **File/region:** index.html dialogs + landing inline script (145-178); app.js:428-432, 484-488, 533-537.
- **Effort:** M

### A7. Dialogs: no focus-return, no autofocus, no labelledby, Esc bypasses Cancel logic *(a11y #1, modals #1)*
- **Problem:** `showModal()` gives a free trap + Esc, but: no `aria-labelledby` → SR announces generic "dialog"; nothing autofocused (lands on container); native `cancel` event on Esc closes without running Cancel/reset logic (leaves `rcItems`/`exShares`/`pnColor` stale); on close, focus lands on `<body>` because `render()` regenerated the trigger.
- **World-class fix:** Add `aria-labelledby="pnTitle"` etc. to each `<dialog>`. Autofocus the primary input on open (reuse the delayed-focus pattern at app.js:676). Add a `cancel`/`close` listener running the same dirty-guard/reset as Cancel. Capture `document.activeElement` on open; on close refocus it, or for re-rendered list items refocus the card's edit button by stable `data-id`.
- **File/region:** index.html:124-223; app.js:412-419, 458-473, 512-523, 549-554.
- **Effort:** M

### A8. Settle FAB/sheet not keyboard/SR complete — no focus move, trap, Esc, or aria-expanded *(modals #6, a11y #2)*
- **Problem:** FAB (index.html:112-115) is `div role=button` with no `aria-expanded`; label stays "Show settle up" when open. Sheet opens via class toggle (app.js:654) with no focus move into it, no trap, no Esc-close, no focus return to FAB. SR users can tab the dimmed page behind the scrim.
- **World-class fix:** Make FAB a real `<button>`; toggle `aria-expanded` and label text per state. On mobile-open, give `#settle` `role="dialog" aria-modal="true" aria-label="Settle up"`, move focus to the grip/title, trap Tab, close on Esc, `inert` the page behind, return focus to FAB on close. Make the grip a real toggle (currently close-only, 659).
- **File/region:** index.html:88-115; app.js:651-667.
- **Effort:** M

### A9. Uneven-split modes carry stale numbers across modes and never validate totals *(modals #9, scaling #3, robustness #11, flows F4)*
- **Problem:** The 4-way segmented control (`setExMode` app.js:493) reuses share values across modes (50% becomes 50 shares becomes Rp 50). `renderExParts` (494-511) shows no running total. BY_PERCENTAGE summing to 90% silently discounts 10% to nobody (compute 116); BY_AMOUNT not summing to total mis-allocates; BY_SHARES all-zeros hits the `||1` fallback (118).
- **World-class fix:** On mode switch, reseed sensibly (Amount → `amount/n` each; % → `100/n`). Add a sticky live summary bar in the dialog: "Σ 100% ✓" / "Σ 92% — 8% unallocated" (red when off) for %, "Σ Rp X of Rp Y" for amounts. Block save (inline error) when % ≠ 100 or amounts ≠ total. Add a "split remainder evenly" quick-fix.
- **File/region:** app.js:493, 494-511, 527-532; styles.css:437-441 + new `.ex-summary`.
- **Effort:** M

### A10. Money rounding never reconciles — displayed per-person shares don't sum to the grand *(robustness #6)*
- **Problem:** `compute()` scales each line by `ratio = grand/sumItems` (98), divides by sharer count producing fractional rupiah, and rounds only at the very end in `settle()` (138). Per-line "each" text (236) and receipt grand are formatted from unrounded values, so the sum of displayed shares ≠ displayed grand. For a money app this erodes trust at any size, worse at 10 sharers.
- **World-class fix:** One rounding policy: round per-person consumed once using largest-remainder distribution so rounded shares sum exactly to the receipt grand. Show a "rounding: +Rp N to X" footnote when a residual exists. Never display a number you didn't total from.
- **File/region:** app.js:90-133, 232-238, 135-149.
- **Effort:** M

### A11. Color palette has only 8 entries — collisions at 9+ people *(scaling #10, a11y #5, modals #17)*
- **Problem:** `PALETTE` (app.js:10) has 8 colors; `personColor` wraps with `% PALETTE.length` (62). At 9+ people two people share a color, breaking the dot/name identity that transfers, person rows, and the planned avatars all rely on. **Prerequisite** for the scaling avatar work (B). Separately, several palette colors fail 4.5:1 as *text* on the dark theme (coral, lilac, pink, blue per a11y #5).
- **World-class fix:** When index ≥ palette length, generate distinct hues via golden-angle HSL (`hsl((i*137.5)%360, 65%, 62%)`); or expand the static palette to ~16. Stop coloring *name text* — keep color on the dot/chip fill only, render names in `--text` (fixes the contrast failure at the same time). Warn on duplicate manual swatch pick.
- **File/region:** app.js:10, 62, 202, 251, 302-310, 337; styles.css:177-179.
- **Effort:** S

### A12. Tap targets below 44px on the most-tapped controls *(a11y #3)*
- **Problem:** `.ghost-btn--sm` ~26px (styles.css:207, used for all +Cost/+Receipt/+Person/Photo), `.edit-btn` 30px (400), `.ri-del`/`.adjust__del`/number inputs tiny (430, 194, 427), landing `.icon-btn` 28px (index.html:51), `.swatch` 28px (447), chips ~36px under 600px (349). The base `.chip` (~30px, styles.css:124) is the highest-frequency target.
- **World-class fix:** `min-height:44px` on buttons; expand icon-button hit areas with padding or a `::before` overlay without changing visual size. Bump chip vertical padding at the mobile breakpoint.
- **File/region:** styles.css:124, 194, 207, 349, 400, 427, 430, 447; index.html:51.
- **Effort:** S

### A13. Deleting a person orphans references; adjustments silently vanish *(robustness #7)*
- **Problem:** Person delete is a server DELETE (431); the client never strips `it.sharedBy`/`e.shares` keys. `compute()` defensively filters by `personById[id]` (101, 111, 124), so remaining sharers' per-head cost silently *rises* with no notice, a stale phone re-introduces the deleted id on its next PUT, and adjustments referencing the deleted person are silently skipped (124) — money quietly disappears.
- **World-class fix:** Server cascades atomically on person delete: strip from all `sharedBy`/`shares`; for adjustments referencing the person, **block delete** (with the impact message from A6) or convert to an orphaned-balance note rather than silently dropping. Client shows what changed.
- **Risk to synced data:** Server-side cascade mutates the stored doc — back up before deploying, do it transactionally with the rev bump.
- **File/region:** app.js:428-432; Go person-DELETE handler.
- **Effort:** M

---

## (B) 10+ PEOPLE SCALING PLAN

**The dominant breakage** (every reviewer): each assignable line renders one chip per person. N×M chips painted on every render and every 4s poll — 6 people/20 items = 120 chips; 20 people/40 items = 800 buttons + 800 listeners rebuilt on every collaborative edit.

### Chosen approach: "summary-by-default, expand-to-edit", gated at `people.length > 8`

**The fallback that keeps ≤6 (≤8) identical:** wrap every condensed component in `if (doc.people.length <= 8) { /* today's exact inline chip code */ } else { /* condensed */ }`. At your current 6-person trip, literally nothing changes — same DOM, same look. This is the explicit contract that resolves the look-vs-scale tension.

**B1. Collapsed avatar stacks (highest leverage — kills the N×M wall).**
- Default per line: render assigned sharers as an overlapping 22px initial-avatar stack (max ~6 shown, then `+N`), colored by `personColor` (needs A11 first), plus the existing per-share `split-note`. Unassigned line = one "Assign" button instead of N chips.
- Tapping the stack opens the picker (B2). New `peopleChipsOrStack()` helper near `personChip` (app.js:155-164); new `.avatar`/`.avatar-stack`/`.avatar--more` CSS near `.chips` (styles.css:123).
- **Fallback:** `people.length <= 8` → today's inline chips, untouched.

**B2. Reusable searchable person-picker (`<dialog>` sheet).**
- One `openPeoplePicker(selectedIds, onSave)` used by receipts and expenses. Search input filters `doc.people` on `input`; alphabetical with selected pinned to top; persistent Select-all/Clear in the header (promote the existing `mkMini` "Everyone/Clear"); "Same as last item" / recently-used pinned (frequent-sharers, scaling #8). Writes back via existing `setItemSharers`/`setExpenseMembers` so settlement math is untouched.
- New dialog in index.html near the dialog cluster (~202); wiring in app.js.

**B3. Expense uneven-split as single-column list above ~8.** Switch `.ex-parts` from `flex-wrap` to a one-per-row name-left/input-right list when participants > 8 (covered structurally by A9's summary bar + "distribute equally"). Below 8, current wrap stays.

**B4. Render perf — event delegation + render skipping (works with A4).** One click listener on `#receipts`/`#shared` reading `data-pid`/`data-rid` (chips already carry `dataset.pid`) instead of N×M `addEventListener`. The avatar collapse already cuts steady-state DOM ~N×. Preserve scroll position on poll re-render. (Full diffing is explicitly *not* needed — out of scope.)

**B5. Settle panel grouping at scale.** Collapsible "All settled (n)" group hiding net≈0 people; a one-line headline ("3 payments settle Rp 4.2M across 20 people"); sort per-person list by net so actionable rows are on top. `renderSettle` (316-363). Fixed sheet already scrolls — this just reduces rows.

**B6. PDF "Everyone / Everyone except X" collapse.** In `buildReport` (612-648), items shared by all (or all-but-few) print "Everyone"/"Everyone except X" instead of 20 comma-joined names. Add `allOrExcept(names)` helper.

**Nice-to-have at scale (additive, low risk):** avatar-initial people bar above 8 (scaling #7); alphabetical sort on payer/adjustment `<select>`s (scaling #9, modals #15); group unassigned counts by receipt (scaling #11).

**Top 3 scaling items first:** A11 palette (prerequisite) → B1 avatar stacks → B2 picker.

---

## (C) ENTERPRISE ROBUSTNESS — minimal designs

**C1. Toast system (~30 lines, framework-free).** Fixed bottom container + `toast(msg, {type:'ok'|'err', action})` with auto-dismiss and optional action button. No toast CSS exists yet (add to styles.css). Add `aria-live="polite"` (or `assertive` for errors). This is the dependency for C2/C4/C6 and replaces every `alert()`. **Routes:** save success ("Saved"), save failure+revert ("Couldn't save — undone", Retry), 403, OCR errors, silent revert.

**C2. Rollback on failed write.** As A1: snapshot → mutate → render → save; catch restores snapshot, re-renders, toasts. Closure passed into `pushDoc`.

**C3. Inflight counter + poll guard.** Single `let inflight = 0`, `pushDoc` does `inflight++` / `finally inflight--`. Poll (A4) skips `adoptDoc+render` when `inflight>0` OR a `dialog[open]` exists OR sheet mid-drag; stashes the pending doc and applies on settle. Disabled submit buttons (A5) read the same inflight discipline.

**C4. Concurrent-edit handling.** Rev-guarded writes (A2): `If-Match: rev` → server 409 → client re-fetches, toasts "Someone else edited — refreshed", re-applies local delta if the item still exists. While a dialog is open and rev changes underneath, toast "This was updated elsewhere" rather than stomping (ties to C3).

**C5. Adjustment delete → toast-with-Undo instead of confirm.** Keep the deleted adjustment in memory, re-POST on Undo (robustness #13). More world-class than a blocking confirm for a reversible action. (Deletes of people/receipts/expenses keep the themed confirm from A6 since they're heavier.)

**C6. localStorage quota safety.** `adoptDoc` cache write (63) currently swallows QuotaExceeded silently. On quota error, clear other `balitrip-trip-*` keys and retry once; if still failing, skip caching but toast once. Prevents silent stale-data-after-reload.

---

## (D) ACCESSIBILITY & MOBILE CHECKLIST

- [ ] **Dialogs:** `aria-labelledby` on each `<dialog>`; autofocus first field on open; focus-return to invoker on close; `cancel`/`close` runs reset logic (A7).
- [ ] **Settle sheet:** real `<button>` FAB, `aria-expanded`, `role=dialog aria-modal`, focus move + trap + Esc, `inert` behind, focus return (A8).
- [ ] **Lock screens (both pages):** `role=dialog aria-modal aria-labelledby`, focus input in-frame (drop the 60ms timeout), trap focus, `aria-label` on landing input; keep `role=alert` error (a11y #8).
- [ ] **Segmented controls** (split mode, adjust kind): `role=radiogroup` + `role=radio aria-checked` + arrow-key nav (a11y #4).
- [ ] **Swatches:** `role=radio`/`aria-checked` + `aria-label="Coral"` color names (a11y #4, modals #17).
- [ ] **Tap targets ≥44px** on all buttons/inputs/chips/swatches (A12).
- [ ] **Color:** names in `--text` not palette color; color on dots/fills only; +/− net gets a textual sign + non-color glyph; raise pressed-chip mix to ~35-40% or add a check glyph (a11y #5/#18, A11).
- [ ] **Live regions:** `aria-live=polite` on `#syncLabel`, `#progressLabel`, and the settle transfers wrapper; throttle to avoid poll spam (a11y #6).
- [ ] **Settlement SR semantics:** coherent per-row `aria-label` ("Asad owes Rp 50,000; consumed 200,000, paid 150,000"); dots `aria-hidden`; replace literal `→`/`▾` with `aria-hidden` glyph + visually-hidden words; `role=list` structure (a11y #7).
- [ ] **Icon buttons:** `aria-label` naming the target ("Edit receipt: Dinner", "Remove item", "Remove adjustment"); glyph `aria-hidden` (a11y #10, modals #12).
- [ ] **Number inputs:** `aria-label` per field ("Quantity", "{name}'s share"); `placeholder` is not a label (a11y #15).
- [ ] **New-row focus:** focus the new `.ri-name` input after `+ Item` (append, don't full-rebuild — preserves focus) (a11y #11, modals #8).
- [ ] **Reduced motion:** add `animation: none !important` to the `prefers-reduced-motion` block (currently only kills transitions, so `shake`/`spin` keyframes still run) (a11y #12).
- [ ] **Safe-area:** add `env(safe-area-inset-left/right)` to `.settle-fab`, `.layout`, scrim for landscape notches (a11y #17).
- [ ] **Landing cards:** move admin edit/delete buttons out of the `<a>` wrapper (nested interactive in a link) (a11y #16).
- [ ] **Sheet drag:** live finger-follow + velocity snap; grip 44px hit area (a11y #13).
- [ ] **OCR/AI spinner overlay:** `role=status aria-live=polite` with start→done messages (a11y itinerary brief).

---

## (E) ITINERARY EDITING UI — DESIGN BRIEF

All five reviewers converged on the same shape. Synthesized below; vanilla-JS implementable, reusing existing idioms. The scaffold already exists at `/balitrip/trip/`.

**Data model (rides in the trip `doc`, syncs via existing `pushDoc`/poll/`rev` — no new money model):**
```
doc.itinerary = { days: [ { id, date, title, order, stops: [
  { id, name, time, notes, category, order,
    lat, lng,                       // optional, AI/geocode-filled
    costRef: { type:'expense'|'receipt', id } | null } ] } ] }
```
`costRef` references an existing expense/receipt — **reference by id only, never duplicate the amount**, so settlement stays the single source of truth.

**Shell:** Day accordion, **collapsed by default** (the scaling discipline — a 10-day trip must not paint 80 stop editors). Each day header shows title + stop count + a small avatar/category preview; sticky on scroll (reuse `.settle__title` sticky, styles.css:339). True semantic list: days as `<ol>` of `<section role=listitem>` with `<h2>`; stops nested `<ol>` of `<article>` (SR landmark navigation). Optional Leaflet map as enhancement only — text-first itinerary fully usable without it; every marker has a focusable list entry. Edit gated by `canEdit`; AI-generate admin-only (mirror `.admin-only` + OCR privacy note).

**Reorder (no DnD-only):** Primary = ▲/▼ move buttons on every day and stop (≥44px, touch-reliable, keyboard/SR-operable, `aria-live` announcing "Day 2 moved to position 1 of 5"). Enhancement = native HTML5 drag-and-drop on desktop with a visible grip (reuse `.sheet-grip` styling). Cross-day move = a "Day" select in the stop dialog (simpler + accessible than cross-list drag). Persist an explicit integer `order` field (not array index) so concurrent reorders merge predictably; reorder uses the same optimistic `render()`→`pushDoc(PUT)` flow, debounced (A5).

**Add/edit/delete stop:** Themed `.dialog` reused for add+edit (the `openReceipt` pattern). Fields: name (required), time, location/notes, category (`.seg` of icons), and the cost-link control. Delete = toast-with-Undo (C5). All dialogs inherit the **fixed** focus model from A7 (autofocus, focus-return, labelledby) — fix the splitter first so the itinerary doesn't inherit the bugs.

**Stop ↔ cost link (the headline cross-feature seam):**
- *Show linked:* if `costRef` resolves, render a money chip — "Rp 450,000 · split 4 ways" via existing `expenseShareText` + `money()` — deep-linking to `/split/?t=<id>#expense-<costId>` (add scroll-and-flash to expense cards).
- *Link existing:* a searchable picker (same component as B2 in spirit) listing `doc.expenses`+`doc.receipts` by title+amount; "None" default.
- *Create + link:* "+ Add as shared cost" opens the splitter's **existing expense dialog** pre-filled (`title=stop.name`, payer=me, EVENLY, everyone); pass an `onCreated(expenseId)` callback so the itinerary captures the new id and writes it to `costRef`. This is the most valuable flow: "we just paid the waterfall entry → tap stop → add as cost → it's in settle-up."
- *Backlink:* linked expense card shows a "📍 Day 2, Tegalalang" chip → `/trip/?t=<id>#stop-<stopId>`.
- *Integrity:* deleting an expense **nulls** any `costRef` pointing at it (server-side, alongside A13 person cascade); the stop shows a "linked cost removed" warning chip (reuse the `needsReview` ⚠ pattern, app.js:262) rather than a stale number.

**AI generation (DeepSeek, admin-only, mirror OCR exactly):** Form dialog (destination, days, start date, pace `.seg`, interest chips, free-text) → full-screen spinner overlay with `role=status` ("Drafting your itinerary…") → **draft-confirm state, never auto-commit** (mirror the OCR receipt draft reuse). Result lands in the *same editable view* as a draft with a banner ("Review — nothing saved yet"), warnings banner for low-confidence pins (`⚠`), and explicit **Append / Replace / Discard** (destructive confirm if an itinerary exists) + a **Regenerate** that preserves form inputs. Errors → toast (C1) with the OCR 503/422/401 mapping. Geocoded lat/lng flagged as AI-estimated. Server-side `POST /api/trips/{id}/itinerary/generate` (admin-gated), `PUT /api/trips/{id}/itinerary` to persist, parses model JSON with Go stdlib `encoding/json` (OCR pattern).

**States:** Empty = dual-CTA card ("✨ Generate with AI" admin / "+ Add your first day" everyone), matching `.empty-hint`/`.card--new` voice. Loading/offline reuse `setSync`. Optimistic + debounced writes; dirty-guard before discarding a draft. Caches in the same localStorage doc blob → readable offline. Concurrent edit: merge by `order`/`id`, toast "edited elsewhere — refreshed" (C4), not last-write-wins on the whole array.

**Nice-to-have:** per-day cost roll-up badge ("Day 2 · Rp 1.2M") from the reverse lookup; "Today" auto-focus on open via existing date helpers; Leaflet route polyline updating live on reorder (visual payoff for the reorder interaction).

---

## (F) SUGGESTED IMPLEMENTATION ORDER

Each step is independently shippable. Foundations first because itinerary and scaling inherit them.

**Step 0 — Backup & guardrails (before any server change).** Back up `receipts.json`/store; confirm no-build-step preserved (all changes are hand-edited `.js`/`.css`/`.html` + Go stdlib). *Risk note: A2 and A13 are the only changes that touch synced/stored data — ship each with a backup and a backward-compatible server (old client must keep working). Everything else is client-only and reversible.*

**Step 1 — Robustness foundation (client-only, no data risk).** C1 toast system → A1/C2 rollback → A4/C3 inflight + poll guard → A5 disable-during-inflight + debounce. Ships the safety net every later step relies on. *(S+S+S+M)*

**Step 2 — Form & dialog correctness (client-only).** A3 validate-don't-close → A7 dialog focus model → A9 split-mode reseed + live totals → A6 replace all native confirm/prompt/alert (themed dialogs + unified login). Biggest perceived-quality jump. *(M each)*

**Step 3 — A11y & mobile pass (client-only, mostly CSS).** A12 tap targets → A11 palette + name-color fix → D checklist (live regions, segmented/swatch roles, icon labels, reduced-motion, safe-area, landing card anchors). *(S/M)*

**Step 4 — Scaling (client-only, gated at >8 so ≤6 is byte-identical).** B4 event delegation → B1 avatar stacks → B2 searchable picker → B3/B5/B6 (split list, settle grouping, PDF collapse). *(M)*

**Step 5 — Money & sync integrity (touches server — highest risk, do last with backups).** A10 largest-remainder rounding (client) → A2 rev/If-Match + 409 (client+server, backward-compatible) → A13 person-delete cascade + adjustment protection (server). *(M each)*

**Step 6 — Itinerary feature (builds on fixed dialogs/sync from Steps 1-5).** (E) shell + accordion → manual add/edit/reorder (move buttons first, DnD enhancement) → stop↔cost link (show, link, create+link, backlink, integrity) → AI generate with draft-confirm → map enhancement + roll-ups. *(L)*

**Rationale:** Steps 1-2 are the trust/quality foundation and carry zero data risk; Step 5 is deferred to last precisely because it touches synced data; the itinerary (Step 6) deliberately comes after the dialog/sync bugs are fixed so it inherits correct patterns rather than propagating the splitter's defects (the unanimous reviewer recommendation).