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
          "type": string,     // one of: start|fuel|food|breakfast|hotel|beach|viewpoint|waterfall|garden|palace|museum|activity|finish
          "note": string,     // 1 short practical sentence (tips, cost hints, timing)
          "lat": number,      // best-known latitude; 0 if unknown
          "lng": number       // best-known longitude; 0 if unknown
        }
      ]
    }
  ]
}
Rules: realistic, geographically sensible ordering; 3-6 stops per day; include the start, lodging, and food stops; concise notes; valid coordinates where you know them, else 0. Output ONLY the JSON object.`

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
	if _, err := store.get(id); err != nil {
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
	if strings.TrimSpace(in.Notes) != "" {
		userMsg += "\nPreferences: " + in.Notes
	}

	reqBody := map[string]any{
		"model":           cfgLLMModel,
		"temperature":     0.4,
		"max_tokens":      4096,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []any{
			map[string]any{"role": "system", "content": itinerarySystemPrompt},
			map[string]any{"role": "user", "content": userMsg},
		},
	}
	bj, _ := json.Marshal(reqBody)

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
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
	for di := range draft.Days {
		draft.Days[di].ID = "d" + randID(4)
		for si := range draft.Days[di].Stops {
			draft.Days[di].Stops[si].ID = "s" + randID(4)
		}
	}
	writeJSON(w, map[string]any{"draft": draft})
}
