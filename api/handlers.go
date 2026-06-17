package main

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var store *Store

// --- helpers ---

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

func tripID(r *http.Request) (string, bool) {
	id := r.PathValue("id")
	return id, safeID(id)
}

func notFound(w http.ResponseWriter) { httpError(w, http.StatusNotFound, "not found") }

// --- trips ---

func handleListTrips(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	list, err := store.list()
	if err != nil {
		httpError(w, 500, "list failed")
		return
	}
	writeJSON(w, list)
}

func handleCreateTrip(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, BaseCurrency, Info string }
	if err := readJSON(r, &in); err != nil || in.Name == "" {
		httpError(w, 400, "name required")
		return
	}
	d, err := store.create(in.Name, in.BaseCurrency, in.Info)
	if err != nil {
		httpError(w, 500, "create failed")
		return
	}
	writeJSON(w, d)
}

func handleGetTrip(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	d, err := store.get(id)
	if err != nil {
		notFound(w)
		return
	}
	writeJSON(w, d)
}

func handleUpdateTrip(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	var in struct{ Name, BaseCurrency, Info *string }
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		if in.Name != nil {
			d.Trip.Name = *in.Name
		}
		if in.BaseCurrency != nil {
			d.Trip.BaseCurrency = *in.BaseCurrency
		}
		if in.Info != nil {
			d.Trip.Info = *in.Info
		}
		return nil
	})
	respondMutate(w, d, err)
}

func handleDeleteTrip(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	if err := store.delete(id); err != nil {
		notFound(w)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func respondMutate(w http.ResponseWriter, d *TripDoc, err error) {
	if err == errNotFound {
		notFound(w)
		return
	}
	if err != nil {
		httpError(w, 400, err.Error())
		return
	}
	writeJSON(w, d)
}

// --- people ---

func handlePersonPost(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	var p Person
	if err := readJSON(r, &p); err != nil || p.Name == "" {
		httpError(w, 400, "name required")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		p.ID = "p" + randID(4)
		d.People = append(d.People, p)
		return nil
	})
	respondMutate(w, d, err)
}

func handlePersonPut(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	pid := r.PathValue("pid")
	if !ok || pid == "" {
		notFound(w)
		return
	}
	var in Person
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		for i := range d.People {
			if d.People[i].ID == pid {
				if in.Name != "" {
					d.People[i].Name = in.Name
				}
				if in.Color != "" {
					d.People[i].Color = in.Color
				}
				return nil
			}
		}
		return errNotFound
	})
	respondMutate(w, d, err)
}

func handlePersonDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	pid := r.PathValue("pid")
	if !ok || pid == "" {
		notFound(w)
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		out := d.People[:0]
		for _, p := range d.People {
			if p.ID != pid {
				out = append(out, p)
			}
		}
		d.People = out
		// scrub references
		for ri := range d.Receipts {
			for ii := range d.Receipts[ri].Items {
				d.Receipts[ri].Items[ii].SharedBy = without(d.Receipts[ri].Items[ii].SharedBy, pid)
			}
		}
		for ei := range d.Expenses {
			delete(d.Expenses[ei].Shares, pid)
		}
		return nil
	})
	respondMutate(w, d, err)
}

func without(s []string, x string) []string {
	out := s[:0]
	for _, v := range s {
		if v != x {
			out = append(out, v)
		}
	}
	return out
}

// --- receipts ---

func handleReceiptPost(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	var rc Receipt
	if err := readJSON(r, &rc); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		rc.ID = "r" + randID(4)
		for i := range rc.Items {
			rc.Items[i].ID = "i" + randID(4)
		}
		d.Receipts = append(d.Receipts, rc)
		return nil
	})
	respondMutate(w, d, err)
}

func handleReceiptPut(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	rid := r.PathValue("rid")
	if !ok || rid == "" {
		notFound(w)
		return
	}
	var in Receipt
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		for i := range d.Receipts {
			if d.Receipts[i].ID == rid {
				in.ID = rid
				for j := range in.Items {
					if in.Items[j].ID == "" {
						in.Items[j].ID = "i" + randID(4)
					}
				}
				d.Receipts[i] = in
				return nil
			}
		}
		return errNotFound
	})
	respondMutate(w, d, err)
}

func handleReceiptDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	rid := r.PathValue("rid")
	if !ok || rid == "" {
		notFound(w)
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		out := d.Receipts[:0]
		for _, rc := range d.Receipts {
			if rc.ID != rid {
				out = append(out, rc)
			}
		}
		d.Receipts = out
		return nil
	})
	respondMutate(w, d, err)
}

// --- expenses (shared trip costs) ---

func handleExpensePost(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	var e Expense
	if err := readJSON(r, &e); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		e.ID = "e" + randID(4)
		d.Expenses = append(d.Expenses, e)
		return nil
	})
	respondMutate(w, d, err)
}

func handleExpensePut(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	eid := r.PathValue("eid")
	if !ok || eid == "" {
		notFound(w)
		return
	}
	var in Expense
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		for i := range d.Expenses {
			if d.Expenses[i].ID == eid {
				in.ID = eid
				d.Expenses[i] = in
				return nil
			}
		}
		return errNotFound
	})
	respondMutate(w, d, err)
}

func handleExpenseDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	eid := r.PathValue("eid")
	if !ok || eid == "" {
		notFound(w)
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		out := d.Expenses[:0]
		for _, e := range d.Expenses {
			if e.ID != eid {
				out = append(out, e)
			}
		}
		d.Expenses = out
		return nil
	})
	respondMutate(w, d, err)
}

// --- itinerary ---

// handlePublicItinerary is the ONLY unauthenticated read: a trip's itinerary
// (places/times) + trip name + people names, for sharing a plan to recruit
// travellers. It deliberately exposes NO financial data (no amounts, no spend).
func handlePublicItinerary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	d, err := store.get(id)
	if err != nil {
		notFound(w)
		return
	}
	people := make([]map[string]string, 0, len(d.People))
	for _, p := range d.People {
		people = append(people, map[string]string{"id": p.ID, "name": p.Name, "color": p.Color})
	}
	signups := d.Signups
	if signups == nil {
		signups = []Signup{}
	}
	capacity := 0
	if d.Profile != nil {
		capacity = d.Profile.Capacity
	}
	out := map[string]any{
		"trip":      map[string]string{"id": d.Trip.ID, "name": d.Trip.Name},
		"people":    people,
		"itinerary": d.Itinerary,
		"signups":   signups,  // public join wall: names + party counts (no money)
		"capacity":  capacity, // max travelers; 0 = no cap
		"rev":       d.Rev,
	}
	// SANITIZED profile only — never money (no dailyTarget, no homeCurrency).
	if d.Profile != nil {
		out["profile"] = map[string]any{
			"startDate":   d.Profile.StartDate,
			"pace":        d.Profile.Pace,
			"budgetLevel": d.Profile.BudgetLevel,
			"interests":   d.Profile.Interests,
			"dietary":     d.Profile.Dietary,
			"adults":      d.Profile.Adults,
			"kids":        d.Profile.Kids,
			"mobility":    d.Profile.Mobility,
		}
	}
	writeJSON(w, out)
}

// handleProfilePut sets the trip's planning profile (editor tier). Body = Profile JSON.
// Returns the full TripDoc (mirrors handleItineraryPut).
func handleProfilePut(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	var in Profile
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		d.Profile = &in
		return nil
	})
	respondMutate(w, d, err)
}

func handleItineraryPut(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	var in Itinerary
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		for di := range in.Days {
			if in.Days[di].ID == "" {
				in.Days[di].ID = "d" + randID(4)
			}
			if in.Days[di].Stops == nil {
				in.Days[di].Stops = []Stop{}
			}
			for si := range in.Days[di].Stops {
				if in.Days[di].Stops[si].ID == "" {
					in.Days[di].Stops[si].ID = "s" + randID(4)
				}
			}
		}
		d.Itinerary = &in
		return nil
	})
	respondMutate(w, d, err)
}

func handleItineraryDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		d.Itinerary = nil
		return nil
	})
	respondMutate(w, d, err)
}

// --- adjustments ---

func handleAdjustmentPost(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	var a Adjustment
	if err := readJSON(r, &a); err != nil || a.FromID == "" || a.ToID == "" || a.Amount <= 0 {
		httpError(w, 400, "from, to, amount required")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		if a.Kind != "payment" {
			a.Kind = "debt"
		}
		a.ID = "a" + randID(4)
		d.Adjustments = append(d.Adjustments, a)
		return nil
	})
	respondMutate(w, d, err)
}

func handleAdjustmentDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	aid := r.PathValue("aid")
	if !ok || aid == "" {
		notFound(w)
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		out := d.Adjustments[:0]
		for _, a := range d.Adjustments {
			if a.ID != aid {
				out = append(out, a)
			}
		}
		d.Adjustments = out
		return nil
	})
	respondMutate(w, d, err)
}

// --- RSVP join wall ---

// The RSVP POST is public (no passcode), so cap submissions per IP.
var rsvpLimiter = newRateLimiter(20, time.Hour)

// handleRSVP appends a public RSVP to the join wall. PUBLIC (no auth) so anyone
// with the shared link can say "I'm in"; rate-limited per IP. Names + party
// counts only — never money.
func handleRSVP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	if !rsvpLimiter.allow(clientIP(r)) {
		httpError(w, http.StatusTooManyRequests, "too many sign-ups — try again later")
		return
	}
	var in struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		httpError(w, 400, "name required")
		return
	}
	if len(name) > 40 {
		name = name[:40]
	}
	count := in.Count
	if count < 1 {
		count = 1
	}
	if count > 10 {
		count = 10
	}
	_, err := store.mutate(id, func(d *TripDoc) error {
		if len(d.Signups) >= 200 {
			return nil // cap reached — silently ignore beyond 200
		}
		d.Signups = append(d.Signups, Signup{Name: name, Count: count, At: nowUTC()})
		return nil
	})
	if err == errNotFound {
		notFound(w)
		return
	}
	if err != nil {
		httpError(w, 400, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- link previews (Open Graph / Twitter card) ---

// handleOG serves a tiny HTML doc with rich link-preview meta (og:* / twitter:*)
// for a shared /trip link, so pasting it into a chat shows title + description +
// cover. PUBLIC (no auth) — social crawlers must reach it. nginx routes only
// crawler user-agents here; humans get the doc too but are immediately bounced to
// the real SPA via a meta-refresh + a plain link.
func handleOG(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("t")
	if !safeID(id) {
		notFound(w)
		return
	}
	d, err := store.get(id)
	if err != nil {
		notFound(w)
		return
	}

	name := strings.TrimSpace(d.Trip.Name)
	if name == "" {
		name = "Trip"
	}
	desc := ogDescription(d)

	scheme := "https"
	tripURL := fmt.Sprintf("%s://%s/trip/?t=%s", scheme, r.Host, id)
	imageURL := fmt.Sprintf("%s://%s/og-cover.png", scheme, r.Host)

	eName := html.EscapeString(name)
	eDesc := html.EscapeString(desc)
	eURL := html.EscapeString(tripURL)
	eImage := html.EscapeString(imageURL)
	ePath := html.EscapeString("/trip/?t=" + id)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%[1]s · Tripkit</title>
<meta property="og:title" content="%[1]s">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tripkit">
<meta property="og:description" content="%[2]s">
<meta property="og:url" content="%[3]s">
<meta property="og:image" content="%[4]s">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="%[1]s">
<meta name="twitter:description" content="%[2]s">
<meta name="twitter:image" content="%[4]s">
<meta http-equiv="refresh" content="0; url=%[5]s">
</head>
<body>
<p><a href="%[5]s">%[1]s — open the trip</a></p>
</body>
</html>
`, eName, eDesc, eURL, eImage, ePath)
}

// ogDescription builds a human-readable link-preview description from a trip doc,
// e.g. "4-day trip · 20 stops · 13–16 Jun — see the plan and join on Tripkit."
func ogDescription(d *TripDoc) string {
	days, stops := 0, 0
	if d.Itinerary != nil {
		days = len(d.Itinerary.Days)
		for _, day := range d.Itinerary.Days {
			stops += len(day.Stops)
		}
	}

	parts := []string{}
	if days == 1 {
		parts = append(parts, "1-day trip")
	} else if days > 1 {
		parts = append(parts, fmt.Sprintf("%d-day trip", days))
	} else {
		parts = append(parts, "Trip")
	}
	if stops == 1 {
		parts = append(parts, "1 stop")
	} else if stops > 1 {
		parts = append(parts, fmt.Sprintf("%d stops", stops))
	}
	if rng := dateRange(d, days); rng != "" {
		parts = append(parts, rng)
	}

	return strings.Join(parts, " · ") + " — see the plan and join on Tripkit."
}

// dateRange formats the trip's calendar span from Profile.StartDate (ISO yyyy-mm-dd)
// across `days` days, e.g. "13–16 Jun" or "30 Jun – 2 Jul". Returns "" if no start
// date or fewer than 1 day.
func dateRange(d *TripDoc, days int) string {
	if d.Profile == nil || strings.TrimSpace(d.Profile.StartDate) == "" || days < 1 {
		return ""
	}
	start, err := time.Parse("2006-01-02", strings.TrimSpace(d.Profile.StartDate))
	if err != nil {
		return ""
	}
	end := start.AddDate(0, 0, days-1)
	if days == 1 {
		return fmt.Sprintf("%d %s", start.Day(), start.Format("Jan"))
	}
	if start.Month() == end.Month() {
		return fmt.Sprintf("%d–%d %s", start.Day(), end.Day(), start.Format("Jan"))
	}
	return fmt.Sprintf("%d %s – %d %s", start.Day(), start.Format("Jan"), end.Day(), end.Format("Jan"))
}

// handleRSVPDelete removes the signup at index idx (organizer moderation). Admin only.
func handleRSVPDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	idx, err := strconv.Atoi(r.PathValue("idx"))
	if err != nil || idx < 0 {
		httpError(w, 400, "bad index")
		return
	}
	_, err = store.mutate(id, func(d *TripDoc) error {
		if idx >= len(d.Signups) {
			return errNotFound
		}
		d.Signups = append(d.Signups[:idx], d.Signups[idx+1:]...)
		return nil
	})
	if err == errNotFound {
		notFound(w)
		return
	}
	if err != nil {
		httpError(w, 400, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
