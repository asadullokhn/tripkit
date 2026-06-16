// balitrip API — multi-trip expense-splitter backend.
// Stores one JSON document per trip on a mounted volume. Reads are passcode-gated;
// writes require an admin session (login). Optional receipt OCR via a configurable
// OpenAI-compatible vision API. Standard library only.
package main

import (
	"crypto/rand"
	"fmt"
	"log"
	"net/http"
	"os"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	// `api -hashpw <password>` prints an ADMIN_PASSWORD_HASH and exits.
	if len(os.Args) >= 2 && os.Args[1] == "-hashpw" {
		pw := ""
		if len(os.Args) >= 3 {
			pw = os.Args[2]
		}
		if pw == "" {
			fmt.Fprintln(os.Stderr, "usage: api -hashpw <password>")
			os.Exit(2)
		}
		fmt.Println(hashPassword(pw))
		return
	}

	dataDir := env("DATA_DIR", "/data")
	cfgPasscode = env("PASSCODE", "")
	cfgAdminHash = env("ADMIN_PASSWORD_HASH", "")
	cfgOCRBase = env("OCR_API_BASE", "")
	cfgOCRKey = env("OCR_API_KEY", "")
	cfgOCRModel = env("OCR_MODEL", "")
	cfgLLMBase = env("DEEPSEEK_API_BASE", "https://api.deepseek.com")
	cfgLLMKey = env("DEEPSEEK_API_KEY", "")
	cfgLLMModel = env("DEEPSEEK_MODEL", "deepseek-chat")

	if s := env("SESSION_SECRET", ""); s != "" {
		cfgSessionSecret = []byte(s)
	} else {
		cfgSessionSecret = make([]byte, 32)
		_, _ = rand.Read(cfgSessionSecret)
		log.Println("WARNING: SESSION_SECRET not set — generated a random one; logins won't survive a restart.")
	}
	if cfgAdminHash == "" {
		log.Println("WARNING: ADMIN_PASSWORD_HASH not set — editing is disabled (read-only).")
	}

	st, err := newStore(dataDir)
	if err != nil {
		log.Fatal("store:", err)
	}
	store = st
	store.seedIfEmpty(env("SEED_FILE", ""))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) })

	// auth
	mux.HandleFunc("POST /api/login", handleLogin)
	mux.HandleFunc("POST /api/logout", handleLogout)
	mux.HandleFunc("GET /api/me", handleMe)

	// trips
	mux.HandleFunc("GET /api/trips", requirePasscode(handleListTrips))
	mux.HandleFunc("POST /api/trips", requireAdmin(handleCreateTrip))
	mux.HandleFunc("GET /api/trips/{id}", requirePasscode(handleGetTrip))
	mux.HandleFunc("PUT /api/trips/{id}", requireAdmin(handleUpdateTrip))
	mux.HandleFunc("DELETE /api/trips/{id}", requireAdmin(handleDeleteTrip))

	// people
	mux.HandleFunc("POST /api/trips/{id}/people", requireAdmin(handlePersonPost))
	mux.HandleFunc("PUT /api/trips/{id}/people/{pid}", requireAdmin(handlePersonPut))
	mux.HandleFunc("DELETE /api/trips/{id}/people/{pid}", requireAdmin(handlePersonDelete))

	// receipts — editor tier (friends with passcode can add/edit/assign)
	mux.HandleFunc("POST /api/trips/{id}/receipts", requireEditor(handleReceiptPost))
	mux.HandleFunc("PUT /api/trips/{id}/receipts/{rid}", requireEditor(handleReceiptPut))
	mux.HandleFunc("DELETE /api/trips/{id}/receipts/{rid}", requireEditor(handleReceiptDelete))

	// expenses (shared trip costs) — editor tier
	mux.HandleFunc("POST /api/trips/{id}/expenses", requireEditor(handleExpensePost))
	mux.HandleFunc("PUT /api/trips/{id}/expenses/{eid}", requireEditor(handleExpensePut))
	mux.HandleFunc("DELETE /api/trips/{id}/expenses/{eid}", requireEditor(handleExpenseDelete))

	// adjustments (ledger) — editor tier
	mux.HandleFunc("POST /api/trips/{id}/adjustments", requireEditor(handleAdjustmentPost))
	mux.HandleFunc("DELETE /api/trips/{id}/adjustments/{aid}", requireEditor(handleAdjustmentDelete))

	// bank account — editor tier (anyone with passcode sets their payout details)
	mux.HandleFunc("PUT /api/trips/{id}/people/{pid}/bank", requireEditor(handlePersonBank))

	// settlement plan — admin publishes/clears; payments tracked against it
	mux.HandleFunc("PUT /api/trips/{id}/settlement", requireAdmin(handleSettlementPut))
	mux.HandleFunc("DELETE /api/trips/{id}/settlement", requireAdmin(handleSettlementDelete))
	mux.HandleFunc("POST /api/trips/{id}/settlement/{tid}/proof", requireEditor(handleProofUpload))
	mux.HandleFunc("GET /api/trips/{id}/settlement/{tid}/proof", requirePasscode(handleProofGet))
	mux.HandleFunc("POST /api/trips/{id}/settlement/{tid}/verify", requireAdmin(handleVerify))
	mux.HandleFunc("POST /api/trips/{id}/settlement/{tid}/unverify", requireAdmin(handleUnverify))

	// itinerary — PUBLIC read (shareable plan, no money), editor to edit, admin to AI-generate / clear
	mux.HandleFunc("GET /api/trips/{id}/itinerary", handlePublicItinerary)
	mux.HandleFunc("PUT /api/trips/{id}/itinerary", requireEditor(handleItineraryPut))
	mux.HandleFunc("DELETE /api/trips/{id}/itinerary", requireAdmin(handleItineraryDelete))
	mux.HandleFunc("POST /api/trips/{id}/itinerary/generate", requireAdmin(handleGenerateItinerary))

	// OCR — editor tier (any passcode user can upload a receipt photo);
	// rate-limited per IP since it costs money and leaves the box.
	mux.HandleFunc("POST /api/ocr", requireEditor(handleOCR))

	addr := ":" + env("PORT", "8080")
	log.Printf("tripkit API on %s (data: %s, login=%v, ocr=%v, ai=%v)", addr, dataDir, cfgAdminHash != "", cfgOCRKey != "", cfgLLMKey != "")
	log.Fatal(http.ListenAndServe(addr, mux))
}
