package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// proofDir returns (and ensures) the per-trip proof image directory.
func proofDir(tripID string) (string, error) {
	dir := filepath.Join(store.dir, "proofs", tripID)
	return dir, os.MkdirAll(dir, 0o755)
}

// --- bank account (editor tier: anyone with the passcode sets their payout details) ---

func handlePersonBank(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	pid := r.PathValue("pid")
	if !ok || pid == "" {
		notFound(w)
		return
	}
	var in struct {
		BankAccount string `json:"bankAccount"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	if len(in.BankAccount) > 200 {
		in.BankAccount = in.BankAccount[:200]
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		for i := range d.People {
			if d.People[i].ID == pid {
				d.People[i].BankAccount = strings.TrimSpace(in.BankAccount)
				return nil
			}
		}
		return errNotFound
	})
	respondMutate(w, d, err)
}

// --- publish / clear settlement plan (admin) ---

func handleSettlementPut(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	var in struct {
		Transfers []Transfer `json:"transfers"`
	}
	if err := readJSON(r, &in); err != nil {
		httpError(w, 400, "bad request")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		// preserve status/proof for transfers that still exist (same from/to)
		prev := map[string]Transfer{}
		if d.Settlement != nil {
			for _, t := range d.Settlement.Transfers {
				prev[t.FromID+">"+t.ToID] = t
			}
		}
		out := make([]Transfer, 0, len(in.Transfers))
		for _, t := range in.Transfers {
			nt := Transfer{ID: "t" + randID(4), FromID: t.FromID, ToID: t.ToID, Amount: t.Amount, Status: "pending"}
			if p, found := prev[t.FromID+">"+t.ToID]; found && p.Amount == t.Amount {
				nt.Status = p.Status
				nt.ProofRef = p.ProofRef
				nt.ID = p.ID
			}
			out = append(out, nt)
		}
		d.Settlement = &Settlement{Published: true, GeneratedAt: nowUTC(), Transfers: out}
		return nil
	})
	respondMutate(w, d, err)
}

func handleSettlementDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	if !ok {
		notFound(w)
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		d.Settlement = nil
		return nil
	})
	respondMutate(w, d, err)
}

// findTransfer locates a transfer in the published settlement.
func findTransfer(d *TripDoc, tid string) *Transfer {
	if d.Settlement == nil {
		return nil
	}
	for i := range d.Settlement.Transfers {
		if d.Settlement.Transfers[i].ID == tid {
			return &d.Settlement.Transfers[i]
		}
	}
	return nil
}

// --- proof upload (editor tier) ---

func handleProofUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, ok := tripID(r)
	tid := r.PathValue("tid")
	if !ok || tid == "" {
		notFound(w)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		httpError(w, http.StatusRequestEntityTooLarge, "image too large or invalid form")
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		httpError(w, 400, "missing image field")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		httpError(w, 400, "cannot read image")
		return
	}
	mime := http.DetectContentType(data)
	ext := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
	if ext == "" {
		httpError(w, http.StatusUnsupportedMediaType, "only jpeg/png/webp")
		return
	}
	dir, err := proofDir(id)
	if err != nil {
		httpError(w, 500, "storage error")
		return
	}
	fname := tid + ext
	if err := os.WriteFile(filepath.Join(dir, fname), data, 0o644); err != nil {
		httpError(w, 500, "write error")
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		t := findTransfer(d, tid)
		if t == nil {
			return errNotFound
		}
		// remove any stale proof of a different extension
		for _, e := range []string{".jpg", ".png", ".webp"} {
			if e != ext {
				_ = os.Remove(filepath.Join(dir, tid+e))
			}
		}
		t.ProofRef = fname
		if t.Status != "verified" {
			t.Status = "submitted"
		}
		t.UpdatedAt = nowUTC()
		return nil
	})
	respondMutate(w, d, err)
}

func handleProofGet(w http.ResponseWriter, r *http.Request) {
	id, ok := tripID(r)
	tid := r.PathValue("tid")
	if !ok || tid == "" {
		notFound(w)
		return
	}
	d, err := store.get(id)
	if err != nil {
		notFound(w)
		return
	}
	t := findTransfer(d, tid)
	if t == nil || t.ProofRef == "" {
		notFound(w)
		return
	}
	// guard: proofRef must be a bare filename
	if strings.ContainsAny(t.ProofRef, "/\\") {
		notFound(w)
		return
	}
	dir, _ := proofDir(id)
	data, err := os.ReadFile(filepath.Join(dir, t.ProofRef))
	if err != nil {
		notFound(w)
		return
	}
	ct := map[string]string{".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}[filepath.Ext(t.ProofRef)]
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

// --- verify / unverify (admin) ---

func handleVerify(w http.ResponseWriter, r *http.Request) {
	setTransferStatus(w, r, "verified")
}
func handleUnverify(w http.ResponseWriter, r *http.Request) {
	setTransferStatus(w, r, "reopen")
}

func setTransferStatus(w http.ResponseWriter, r *http.Request, action string) {
	id, ok := tripID(r)
	tid := r.PathValue("tid")
	if !ok || tid == "" {
		notFound(w)
		return
	}
	d, err := store.mutate(id, func(d *TripDoc) error {
		t := findTransfer(d, tid)
		if t == nil {
			return errNotFound
		}
		if action == "verified" {
			t.Status = "verified"
		} else { // reopen
			if t.ProofRef != "" {
				t.Status = "submitted"
			} else {
				t.Status = "pending"
			}
		}
		t.UpdatedAt = nowUTC()
		return nil
	})
	respondMutate(w, d, err)
}
