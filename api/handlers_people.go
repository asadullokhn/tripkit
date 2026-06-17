package main

import "net/http"

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
