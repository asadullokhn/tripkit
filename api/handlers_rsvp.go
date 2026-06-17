package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

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
