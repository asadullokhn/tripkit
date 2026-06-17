package main

import (
	"encoding/json"
	"io"
	"net/http"
)

var store *Store

// --- shared HTTP helpers ---
// Domain handlers live in handlers_<domain>.go (trips, people, receipts,
// expenses, itinerary, adjustments, rsvp, og). They all share these helpers and
// the package-level store.

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

// respondMutate writes the standard response for a store.mutate() call:
// 404 if the trip is gone, 400 on a validation error, else the updated doc.
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
