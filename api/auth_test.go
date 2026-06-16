package main

import (
	"testing"
	"time"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	h := hashPassword("correct horse battery staple")
	if !verifyPassword("correct horse battery staple", h) {
		t.Fatal("correct password failed to verify")
	}
	if verifyPassword("wrong", h) {
		t.Fatal("wrong password verified")
	}
	// uses ':' separator (not '$') to survive docker-compose env interpolation
	if !containsByte(h, ':') {
		t.Fatalf("hash missing ':' separator: %q", h)
	}
}

func TestPasswordHashIsSalted(t *testing.T) {
	a := hashPassword("same")
	b := hashPassword("same")
	if a == b {
		t.Fatal("two hashes of the same password are identical — salt not applied")
	}
}

func TestVerifyPasswordRejectsGarbage(t *testing.T) {
	for _, bad := range []string{"", "nosalt", "zz:zz", ":", "deadbeef:"} {
		if verifyPassword("x", bad) {
			t.Fatalf("verifyPassword accepted malformed stored value %q", bad)
		}
	}
}

func TestSessionSignVerify(t *testing.T) {
	cfgSessionSecret = []byte("test-secret-32-bytes-xxxxxxxxxxxx")
	exp := time.Now().Add(time.Hour).Unix()
	tok := signSession(exp)
	if !validSession(tok) {
		t.Fatal("freshly signed session did not validate")
	}
}

func TestSessionExpiry(t *testing.T) {
	cfgSessionSecret = []byte("test-secret-32-bytes-xxxxxxxxxxxx")
	expired := signSession(time.Now().Add(-time.Minute).Unix())
	if validSession(expired) {
		t.Fatal("expired session validated")
	}
}

func TestSessionTamperResistance(t *testing.T) {
	cfgSessionSecret = []byte("test-secret-32-bytes-xxxxxxxxxxxx")
	exp := time.Now().Add(time.Hour).Unix()
	tok := signSession(exp)
	// flip the last character of the signature
	bad := tok[:len(tok)-1] + flip(tok[len(tok)-1:])
	if validSession(bad) {
		t.Fatal("tampered session validated")
	}
	// a different secret must reject a token signed with the original
	cfgSessionSecret = []byte("a-completely-different-secret-key")
	if validSession(tok) {
		t.Fatal("token validated under a different secret")
	}
}

func TestSessionGarbage(t *testing.T) {
	cfgSessionSecret = []byte("test-secret-32-bytes-xxxxxxxxxxxx")
	for _, bad := range []string{"", "v1", "v1|x", "v1|123", "v2|123|abc", "x|y|z"} {
		if validSession(bad) {
			t.Fatalf("validSession accepted garbage %q", bad)
		}
	}
}

func containsByte(s string, b byte) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return true
		}
	}
	return false
}

func flip(s string) string {
	if s == "0" {
		return "1"
	}
	return "0"
}
