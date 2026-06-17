package main

import "net/http"

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
