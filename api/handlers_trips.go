package main

import "net/http"

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
