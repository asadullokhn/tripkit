package main

import "net/http"

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
