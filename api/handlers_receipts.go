package main

import "net/http"

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
