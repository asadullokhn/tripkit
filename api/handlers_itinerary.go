package main

import "net/http"

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
