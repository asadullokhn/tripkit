package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// config (set in main from env) — a text LLM with an OpenAI-compatible
// chat-completions endpoint. DeepSeek works here (text-only, cheap).
var (
	cfgLLMBase  string // e.g. https://api.deepseek.com
	cfgLLMKey   string
	cfgLLMModel string // e.g. deepseek-chat
)

const itinerarySystemPrompt = `You are a travel planner. Produce a day-by-day trip itinerary as JSON only — no prose.
Schema:
{
  "title": string,
  "days": [
    {
      "label": string,        // e.g. "Day 1"
      "title": string,        // short route summary, e.g. "Arrival → Old Town"
      "stops": [
        {
          "name": string,
          "type": string,        // one of: start|fuel|food|breakfast|hotel|beach|viewpoint|waterfall|garden|palace|museum|activity|finish
          "note": string,        // 1 short practical sentence (tips, cost hints, timing)
          "lat": number,         // best-known latitude; 0 if unknown
          "lng": number,         // best-known longitude; 0 if unknown
          "mode": string,        // how you ARRIVE here, one of: car|scooter|taxi|public|bike|walk|boat|flight
          "durationMin": number, // planned visit length in minutes (integer, >=0)
          "cost": number,        // estimated TOTAL cost for the whole group in whole IDR (integer, 0 if free/unknown)
          "links": {
            "maps":    string,   // Google Maps search URL: https://www.google.com/maps/search/?api=1&query=<url-encoded place name>
            "booking": string,   // Agoda/Booking search or deep link for hotel-type stops, else ""
            "tickets": string    // official-site or ticket-search link for paid attractions, else ""
          }
        }
      ]
    }
  ]
}
Rules: realistic, geographically sensible ordering; 3-6 stops per day; include the start, lodging, and food stops; concise notes; valid coordinates where you know them, else 0. Always set a sensible mode and durationMin per stop; estimate cost for the whole group in whole IDR (0 if free). Build the maps link from the place name exactly as specified. Output ONLY the JSON object.`

func handleGenerateItinerary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	if cfgLLMKey == "" || cfgLLMBase == "" || cfgLLMModel == "" {
		httpError(w, http.StatusServiceUnavailable, "ai not configured (set DEEPSEEK_API_KEY, DEEPSEEK_API_BASE, DEEPSEEK_MODEL)")
		return
	}
	doc, err := store.get(id)
	if err != nil {
		notFound(w)
		return
	}
	var in struct {
		Destination string `json:"destination"`
		Days        int    `json:"days"`
		Notes       string `json:"notes"`
	}
	if err := readJSON(r, &in); err != nil || strings.TrimSpace(in.Destination) == "" {
		httpError(w, http.StatusBadRequest, "destination required")
		return
	}
	if in.Days < 1 {
		in.Days = 3
	}
	if in.Days > 14 {
		in.Days = 14
	}

	userMsg := fmt.Sprintf("Destination: %s\nNumber of days: %d", in.Destination, in.Days)
	if block := profilePrompt(doc.Profile); block != "" {
		userMsg += "\n" + block
	}
	if strings.TrimSpace(in.Notes) != "" {
		userMsg += "\nAdditional notes: " + in.Notes
	}
	userMsg += "\nKeep it compact: short stop notes (max ~12 words) and at most 5 stops per day, so the whole trip fits in one JSON response."

	reqBody := map[string]any{
		"model":           cfgLLMModel,
		"temperature":     0.4,
		"max_tokens":      8192,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []any{
			map[string]any{"role": "system", "content": itinerarySystemPrompt},
			map[string]any{"role": "user", "content": userMsg},
		},
	}
	bj, _ := json.Marshal(reqBody)

	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	url := strings.TrimRight(cfgLLMBase, "/") + "/chat/completions"
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bj))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfgLLMKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			httpError(w, http.StatusGatewayTimeout, "ai provider timed out")
			return
		}
		httpError(w, http.StatusBadGateway, "ai provider unreachable")
		return
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		httpError(w, http.StatusBadGateway, fmt.Sprintf("ai provider error (%d)", resp.StatusCode))
		return
	}

	var chat struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBytes, &chat); err != nil || len(chat.Choices) == 0 {
		httpError(w, http.StatusBadGateway, "ai provider returned no result")
		return
	}
	content := strings.TrimSpace(chat.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")

	var draft Itinerary
	if err := json.Unmarshal([]byte(content), &draft); err != nil {
		httpError(w, http.StatusUnprocessableEntity, "could not parse itinerary")
		return
	}
	// assign ids so the client can edit immediately; this is a DRAFT (not saved).
	// also normalize/clamp the new per-stop fields the model returns.
	for di := range draft.Days {
		draft.Days[di].ID = "d" + randID(4)
		for si := range draft.Days[di].Stops {
			s := &draft.Days[di].Stops[si]
			s.ID = "s" + randID(4)
			if !validMode(s.Mode) {
				s.Mode = "car"
			}
			if s.DurationMin < 0 {
				s.DurationMin = 0
			}
			if s.Cost < 0 {
				s.Cost = 0
			}
		}
	}
	writeJSON(w, map[string]any{"draft": draft})
}

func validMode(m string) bool {
	switch m {
	case "car", "scooter", "taxi", "public", "bike", "walk", "boat", "flight":
		return true
	}
	return false
}

// profilePrompt turns the trip Profile into a deterministic preferences block
// appended to the user prompt. Nil-safe. Money fields are never sent.
func profilePrompt(p *Profile) string {
	if p == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString("Traveller preferences (honor these):")
	switch p.Pace {
	case "relaxed":
		b.WriteString("\n- Pace: relaxed — keep it light, 2-3 stops per day, unhurried.")
	case "packed":
		b.WriteString("\n- Pace: packed — fit in more, 5-6 stops per day.")
	case "balanced":
		b.WriteString("\n- Pace: balanced — about 4 stops per day.")
	}
	switch p.BudgetLevel {
	case "shoestring":
		b.WriteString("\n- Budget: shoestring — favor free/cheap stops, warungs and street food; note frugal tips.")
	case "mid":
		b.WriteString("\n- Budget: mid-range — sensible mix of value and comfort.")
	case "comfort":
		b.WriteString("\n- Budget: comfort — nicer venues are fine; prioritize good experiences over saving.")
	case "lux":
		b.WriteString("\n- Budget: luxury — premium venues, fine dining and high-end stays welcome.")
	}
	if len(p.Interests) > 0 {
		b.WriteString("\n- Interests: " + strings.Join(p.Interests, ", ") + " — bias stop selection toward these.")
	}
	if len(p.Dietary) > 0 {
		b.WriteString("\n- Dietary (HARD CONSTRAINT): " + strings.Join(p.Dietary, ", ") +
			". Only suggest venues that satisfy this — e.g. if halal, never suggest non-halal or pork venues.")
	}
	if p.Adults > 0 || p.Kids > 0 {
		b.WriteString(fmt.Sprintf("\n- Group: %d adult(s), %d kid(s).", p.Adults, p.Kids))
		if p.Kids > 0 {
			b.WriteString(" Keep stops kid-friendly and age-appropriate.")
		}
	}
	switch p.Mobility {
	case "easy":
		b.WriteString("\n- Mobility: easy — avoid hard hikes, long treks or many stairs; prefer accessible stops.")
	case "moderate":
		b.WriteString("\n- Mobility: moderate — some walking is fine, avoid strenuous treks.")
	case "active":
		b.WriteString("\n- Mobility: active — hikes and physical activities are welcome.")
	}
	if strings.TrimSpace(p.StartDate) != "" {
		b.WriteString("\n- Start date: " + p.StartDate +
			" — account for season (wet/dry) and the weekday (weekend crowds, closures).")
	}
	if b.Len() == len("Traveller preferences (honor these):") {
		return ""
	}
	return b.String()
}
