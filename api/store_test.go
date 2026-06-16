package main

import (
	"os"
	"testing"
)

func TestSafeID(t *testing.T) {
	good := []string{"bali-2026", "abc123", "A_b-9", "x"}
	for _, id := range good {
		if !safeID(id) {
			t.Fatalf("safeID rejected valid id %q", id)
		}
	}
	bad := []string{"", "../etc", "a/b", "a.b", "a b", "a$b", "../../x", string(make([]byte, 65))}
	for _, id := range bad {
		if safeID(id) {
			t.Fatalf("safeID accepted unsafe id %q", id)
		}
	}
}

func TestStoreCreateGetListDelete(t *testing.T) {
	st, err := newStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	d, err := st.create("My Trip", "", "note")
	if err != nil {
		t.Fatal(err)
	}
	if d.Trip.BaseCurrency != "IDR" {
		t.Fatalf("empty currency should default to IDR, got %q", d.Trip.BaseCurrency)
	}
	if d.Trip.ID == "" || !safeID(d.Trip.ID) {
		t.Fatalf("created trip has unsafe/empty id %q", d.Trip.ID)
	}

	got, err := st.get(d.Trip.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Trip.Name != "My Trip" {
		t.Fatalf("round-trip name mismatch: %q", got.Trip.Name)
	}

	list, err := st.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != d.Trip.ID {
		t.Fatalf("list did not return the created trip: %+v", list)
	}

	if err := st.delete(d.Trip.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.get(d.Trip.ID); err != errNotFound {
		t.Fatalf("expected errNotFound after delete, got %v", err)
	}
}

func TestStoreMutateBumpsRev(t *testing.T) {
	st, _ := newStore(t.TempDir())
	d, _ := st.create("T", "IDR", "")
	startRev := d.Rev
	out, err := st.mutate(d.Trip.ID, func(doc *TripDoc) error {
		doc.People = append(doc.People, Person{ID: "p1", Name: "Alice"})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Rev != startRev+1 {
		t.Fatalf("rev should increment on mutate: %d -> %d", startRev, out.Rev)
	}
	reloaded, _ := st.get(d.Trip.ID)
	if len(reloaded.People) != 1 || reloaded.People[0].Name != "Alice" {
		t.Fatal("mutation was not persisted atomically")
	}
}

func TestStoreMutateMissing(t *testing.T) {
	st, _ := newStore(t.TempDir())
	if _, err := st.mutate("nope", func(*TripDoc) error { return nil }); err != errNotFound {
		t.Fatalf("expected errNotFound, got %v", err)
	}
}

func TestSeedIfEmpty(t *testing.T) {
	dir := t.TempDir()
	st, _ := newStore(dir)
	seed := dir + "/seed.json"
	if err := os.WriteFile(seed, []byte(`{"trip":{"id":"demo","name":"Demo","baseCurrency":"IDR"},"people":[{"id":"a","name":"A"}]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	st.seedIfEmpty(seed)
	list, _ := st.list()
	if len(list) != 1 || list[0].ID != "demo" {
		t.Fatalf("seed did not install demo trip: %+v", list)
	}
	// second call must be a no-op (trips already exist)
	st.seedIfEmpty(seed)
	if list2, _ := st.list(); len(list2) != 1 {
		t.Fatalf("seedIfEmpty re-seeded a non-empty store: %d trips", len(list2))
	}
}

func TestNormalizeFillsNilSlices(t *testing.T) {
	d := &TripDoc{}
	d.normalize()
	if d.People == nil || d.Receipts == nil || d.Expenses == nil || d.Adjustments == nil {
		t.Fatal("normalize left a nil slice")
	}
}
