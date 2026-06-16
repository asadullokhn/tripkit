package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookie = "blt_session"
	pwIterations  = 200_000
	sessionTTL    = 30 * 24 * time.Hour
)

// config (set in main from env)
var (
	cfgPasscode      string
	cfgAdminHash     string // "saltHex$hashHex"
	cfgSessionSecret []byte
)

// --- password hashing (stdlib stretched SHA-256) ---

func stretch(pw string, salt []byte) []byte {
	h := sha256.Sum256(append(salt, []byte(pw)...))
	for i := 1; i < pwIterations; i++ {
		h = sha256.Sum256(append(salt, h[:]...))
	}
	return h[:]
}

func hashPassword(pw string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(stretch(pw, salt))
}

func verifyPassword(pw, stored string) bool {
	parts := strings.SplitN(stored, ":", 2)
	if len(parts) != 2 {
		return false
	}
	salt, err := hex.DecodeString(parts[0])
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	got := stretch(pw, salt)
	return subtle.ConstantTimeCompare(got, want) == 1
}

// --- session cookie (HMAC-signed, stateless) ---

func signSession(expiry int64) string {
	payload := "v1|" + strconv.FormatInt(expiry, 10)
	mac := hmac.New(sha256.New, cfgSessionSecret)
	mac.Write([]byte(payload))
	return payload + "|" + hex.EncodeToString(mac.Sum(nil))
}

func validSession(val string) bool {
	parts := strings.Split(val, "|")
	if len(parts) != 3 || parts[0] != "v1" {
		return false
	}
	expiry, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || time.Now().Unix() > expiry {
		return false
	}
	payload := parts[0] + "|" + parts[1]
	mac := hmac.New(sha256.New, cfgSessionSecret)
	mac.Write([]byte(payload))
	want := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(parts[2]), []byte(want)) == 1
}

func isAdmin(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	return validSession(c.Value)
}

func hasPasscode(r *http.Request) bool {
	if cfgPasscode == "" {
		return true // no passcode configured -> reads open
	}
	got := r.Header.Get("X-Passcode")
	if got == "" {
		got = r.URL.Query().Get("pass")
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(cfgPasscode)) == 1
}

// sameOrigin: basic CSRF guard for cookie-authed writes.
func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser client (curl) — no ambient cookie risk
	}
	// compare host[:port] of Origin to the request Host
	o := origin
	if i := strings.Index(o, "://"); i >= 0 {
		o = o[i+3:]
	}
	return o == r.Host
}

// --- middleware ---

func requirePasscode(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if isAdmin(r) || hasPasscode(r) {
			next(w, r)
			return
		}
		httpError(w, http.StatusUnauthorized, "passcode required")
	}
}

// requireEditor: passcode users OR admins may edit receipts / expenses / ledger
// (the collaborative "tap who shared + add costs" flow). Admin cookie writes still
// get the CSRF origin check; passcode writes use the header (no ambient-cookie risk).
func requireEditor(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if isAdmin(r) {
			if !sameOrigin(r) {
				httpError(w, http.StatusForbidden, "bad origin")
				return
			}
			next(w, r)
			return
		}
		if hasPasscode(r) {
			next(w, r)
			return
		}
		httpError(w, http.StatusUnauthorized, "passcode required")
	}
}

func requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !isAdmin(r) {
			httpError(w, http.StatusUnauthorized, "login required")
			return
		}
		if !sameOrigin(r) {
			httpError(w, http.StatusForbidden, "bad origin")
			return
		}
		next(w, r)
	}
}

// --- rate limiter (per-IP token bucket for /api/login) ---

type rateLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
	max  int
	win  time.Duration
}

func newRateLimiter(max int, win time.Duration) *rateLimiter {
	return &rateLimiter{hits: map[string][]time.Time{}, max: max, win: win}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cut := now.Add(-rl.win)
	kept := rl.hits[key][:0]
	for _, t := range rl.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.max {
		rl.hits[key] = kept
		return false
	}
	rl.hits[key] = append(kept, now)
	return true
}

func clientIP(r *http.Request) string {
	if h := r.Header.Get("X-Real-IP"); h != "" {
		return h
	}
	if h := r.Header.Get("X-Forwarded-For"); h != "" {
		return strings.TrimSpace(strings.SplitN(h, ",", 2)[0])
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = host[:i]
	}
	return host
}

var loginLimiter = newRateLimiter(8, 5*time.Minute)

// --- handlers ---

func handleLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !loginLimiter.allow(clientIP(r)) {
		httpError(w, http.StatusTooManyRequests, "too many attempts")
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, http.StatusBadRequest, "bad request")
		return
	}
	if cfgAdminHash == "" || !verifyPassword(in.Password, cfgAdminHash) {
		httpError(w, http.StatusUnauthorized, "wrong password")
		return
	}
	exp := time.Now().Add(sessionTTL).Unix()
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: signSession(exp), Path: "/",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
		Expires: time.Unix(exp, 0),
	})
	writeJSON(w, map[string]bool{"admin": true})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
	writeJSON(w, map[string]bool{"admin": false})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]bool{
		"admin":        isAdmin(r),
		"loginEnabled": cfgAdminHash != "",
		"ocrEnabled":   cfgOCRKey != "" && cfgOCRBase != "" && cfgOCRModel != "",
		"aiEnabled":    cfgLLMKey != "" && cfgLLMBase != "" && cfgLLMModel != "",
	})
}
