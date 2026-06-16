package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// config (set in main from env)
var (
	cfgOCRBase  string // OpenAI-compatible base, e.g. https://generativelanguage.googleapis.com/v1beta/openai
	cfgOCRKey   string
	cfgOCRModel string // a VISION model, e.g. gemini-2.5-flash, gpt-4o-mini, qwen-vl-...
)

const ocrSystemPrompt = `You read a photo of a restaurant or store receipt and output ONLY a JSON object, no prose.
Schema:
{
  "title": string|null,        // restaurant/store name
  "date": string|null,         // ISO yyyy-mm-dd if visible
  "time": string|null,         // HH:MM if visible
  "currency": string|null,     // e.g. "IDR"
  "items": [ { "name": string, "quantity": number, "unit_price": number, "line_total": number } ],
  "tax": number|null,          // tax / PB1 / PPN line
  "service": number|null,      // service charge / SC line
  "grand_total": number|null
}
Rules:
- Prices are integers in the smallest sensible unit (whole rupiah for IDR). Indonesian receipts use "." as a THOUSANDS separator: "45.000" means 45000, NOT 45.
- Put tax / PB1 / PPN into "tax" and service charge / SC into "service" — never as items.
- If quantity is missing assume 1. If a field is unknown use null. NEVER invent items or numbers.
- line_total should equal quantity * unit_price when both are known.`

type ocrItem struct {
	Name      string  `json:"name"`
	Quantity  float64 `json:"quantity"`
	UnitPrice float64 `json:"unit_price"`
	LineTotal float64 `json:"line_total"`
}
type ocrResult struct {
	Title      *string   `json:"title"`
	Date       *string   `json:"date"`
	Time       *string   `json:"time"`
	Currency   *string   `json:"currency"`
	Items      []ocrItem `json:"items"`
	Tax        *float64  `json:"tax"`
	Service    *float64  `json:"service"`
	GrandTotal *float64  `json:"grand_total"`
}

func handleOCR(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if cfgOCRKey == "" || cfgOCRBase == "" || cfgOCRModel == "" {
		httpError(w, http.StatusServiceUnavailable, "ocr not configured (set OCR_API_BASE, OCR_API_KEY, OCR_MODEL)")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20) // 8 MiB
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		httpError(w, http.StatusRequestEntityTooLarge, "image too large or invalid form")
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		httpError(w, http.StatusBadRequest, "missing image field")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		httpError(w, http.StatusBadRequest, "cannot read image")
		return
	}
	mime := http.DetectContentType(data)
	switch mime {
	case "image/jpeg", "image/png", "image/webp":
	default:
		httpError(w, http.StatusUnsupportedMediaType, "only jpeg/png/webp")
		return
	}

	dataURI := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	reqBody := map[string]any{
		"model":           cfgOCRModel,
		"temperature":     0,
		"max_tokens":      4096,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []any{
			map[string]any{"role": "system", "content": ocrSystemPrompt},
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "text", "text": "Extract this receipt as JSON."},
				map[string]any{"type": "image_url", "image_url": map[string]string{"url": dataURI}},
			}},
		},
	}
	bj, _ := json.Marshal(reqBody)

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	url := strings.TrimRight(cfgOCRBase, "/") + "/chat/completions"
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bj))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfgOCRKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			httpError(w, http.StatusGatewayTimeout, "ocr provider timed out")
			return
		}
		httpError(w, http.StatusBadGateway, "ocr provider unreachable")
		return
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		// don't leak upstream body/key
		httpError(w, http.StatusBadGateway, fmt.Sprintf("ocr provider error (%d)", resp.StatusCode))
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
		httpError(w, http.StatusBadGateway, "ocr provider returned no result")
		return
	}
	content := strings.TrimSpace(chat.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")

	var res ocrResult
	if err := json.Unmarshal([]byte(content), &res); err != nil {
		httpError(w, http.StatusUnprocessableEntity, "could not parse receipt")
		return
	}

	draft, warnings := res.toDraft()
	if len(draft.Items) == 0 && draft.GrandTotal == 0 {
		httpError(w, http.StatusUnprocessableEntity, "no_receipt_detected")
		return
	}
	writeJSON(w, map[string]any{"draft": draft, "warnings": warnings})
}

// toDraft maps the model output into a receipt draft (no ids), with reconciliation warnings.
func (res ocrResult) toDraft() (Receipt, []string) {
	var warnings []string
	rcp := Receipt{Items: []Item{}}
	if res.Title != nil {
		rcp.Title = *res.Title
	}
	if res.Date != nil {
		rcp.Date = *res.Date
	}
	if res.Time != nil {
		rcp.Time = *res.Time
	}
	itemsSum := 0
	for _, it := range res.Items {
		q := int(it.Quantity)
		if q <= 0 {
			q = 1
		}
		unit := int(it.UnitPrice)
		line := int(it.LineTotal)
		if line == 0 && unit != 0 {
			line = unit * q
		}
		if unit == 0 && q != 0 && line != 0 {
			unit = line / q
		}
		if unit != 0 && line != 0 && unit*q != line {
			warnings = append(warnings, fmt.Sprintf("%q: qty×unit (%d) ≠ line total (%d)", it.Name, unit*q, line))
		}
		itemsSum += line
		rcp.Items = append(rcp.Items, Item{Name: it.Name, Quantity: q, UnitPrice: unit, LineTotal: line, SharedBy: []string{}})
	}
	tax, svc := 0, 0
	if res.Tax != nil {
		tax = int(*res.Tax)
	}
	if res.Service != nil {
		svc = int(*res.Service)
	}
	if res.GrandTotal != nil {
		rcp.GrandTotal = int(*res.GrandTotal)
	} else {
		rcp.GrandTotal = itemsSum + tax + svc
	}
	expected := itemsSum + tax + svc
	if rcp.GrandTotal != 0 && expected != 0 && rcp.GrandTotal != expected {
		warnings = append(warnings, fmt.Sprintf("items+tax+service (%d) ≠ grand total (%d) — check for missing lines", expected, rcp.GrandTotal))
	}
	return rcp, warnings
}
