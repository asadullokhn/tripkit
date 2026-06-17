package main

import (
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"
)

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
