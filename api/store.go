package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

var errNotFound = errors.New("not found")

type Store struct {
	mu       sync.Mutex
	dir      string // data dir
	tripsDir string // data/trips
}

func newStore(dir string) (*Store, error) {
	tripsDir := filepath.Join(dir, "trips")
	if err := os.MkdirAll(tripsDir, 0o755); err != nil {
		return nil, err
	}
	return &Store{dir: dir, tripsDir: tripsDir}, nil
}

func randID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339) }

func (s *Store) path(id string) string { return filepath.Join(s.tripsDir, id+".json") }

// safeID guards against path traversal: trip ids are hex/slug only.
func safeID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// --- low-level (caller holds s.mu) ---

func (s *Store) readDoc(id string) (*TripDoc, error) {
	b, err := os.ReadFile(s.path(id))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errNotFound
		}
		return nil, err
	}
	var d TripDoc
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, err
	}
	d.normalize()
	return &d, nil
}

func (s *Store) writeDoc(d *TripDoc) error {
	d.Rev++
	d.UpdatedAt = nowUTC()
	d.normalize()
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	p := s.path(d.Trip.ID)
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// --- public API (each locks) ---

func (s *Store) list() ([]TripSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.tripsDir)
	if err != nil {
		return nil, err
	}
	var out []TripSummary
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		id := e.Name()[:len(e.Name())-len(".json")]
		d, err := s.readDoc(id)
		if err != nil {
			continue
		}
		// only list canonical trip files (filename stem == trip id). Guards against
		// stray copies/backups landing in this dir and appearing as phantom trips.
		if d.Trip.ID != id {
			continue
		}
		out = append(out, d.summary())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	if out == nil {
		out = []TripSummary{}
	}
	return out, nil
}

func (s *Store) get(id string) (*TripDoc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readDoc(id)
}

func (s *Store) create(name, currency, info string) (*TripDoc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := randID(5)
	if currency == "" {
		currency = "IDR"
	}
	d := &TripDoc{
		Trip:   Trip{ID: id, Name: name, BaseCurrency: currency, Info: info, CreatedAt: nowUTC()},
		People: []Person{}, Receipts: []Receipt{}, Expenses: []Expense{}, Adjustments: []Adjustment{},
	}
	if err := s.writeDoc(d); err != nil {
		return nil, err
	}
	return d, nil
}

func (s *Store) delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(s.path(id))
	if os.IsNotExist(err) {
		return errNotFound
	}
	return err
}

// mutate loads a trip, runs fn (which edits it), then persists. Atomic under the lock.
func (s *Store) mutate(id string, fn func(d *TripDoc) error) (*TripDoc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.readDoc(id)
	if err != nil {
		return nil, err
	}
	if err := fn(d); err != nil {
		return nil, err
	}
	if err := s.writeDoc(d); err != nil {
		return nil, err
	}
	return d, nil
}

// seedIfEmpty installs a bundled seed trip when no trips exist yet (fresh clone / demo).
func (s *Store) seedIfEmpty(seedPath string) {
	if seedPath == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, _ := os.ReadDir(s.tripsDir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".json" {
			return // already have trips
		}
	}
	b, err := os.ReadFile(seedPath)
	if err != nil {
		return
	}
	var d TripDoc
	if err := json.Unmarshal(b, &d); err != nil {
		return
	}
	if !safeID(d.Trip.ID) {
		d.Trip.ID = randID(5)
	}
	if d.Trip.CreatedAt == "" {
		d.Trip.CreatedAt = nowUTC()
	}
	d.Rev = 0
	d.normalize()
	b2, _ := json.MarshalIndent(&d, "", "  ")
	_ = os.WriteFile(s.path(d.Trip.ID), b2, 0o644)
}
