package main

import (
	"encoding/json"
	"io"
	"net/http"
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
	writeJSON(w, map[string]any{
		"trip":      map[string]string{"id": d.Trip.ID, "name": d.Trip.Name},
		"people":    people,
		"itinerary": d.Itinerary,
		"rev":       d.Rev,
	})
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
