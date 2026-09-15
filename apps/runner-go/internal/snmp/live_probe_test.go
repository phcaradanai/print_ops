package snmp

import (
	"os"
	"strconv"
	"testing"
)

// TestLiveProbe talks to a real printer. It is skipped unless
// PRINTOPS_SNMP_LIVE_HOST is set, so CI stays hermetic.
//
//	PRINTOPS_SNMP_LIVE_HOST="fe80::5257:9cff:fe4f:6a3c%6" go test ./internal/snmp -run TestLiveProbe -v
func TestLiveProbe(t *testing.T) {
	host := os.Getenv("PRINTOPS_SNMP_LIVE_HOST")
	if host == "" {
		t.Skip("PRINTOPS_SNMP_LIVE_HOST not set")
	}

	port := 161
	if v := os.Getenv("PRINTOPS_SNMP_LIVE_PORT"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil {
			t.Fatalf("PRINTOPS_SNMP_LIVE_PORT=%q: %v", v, err)
		}
		port = parsed
	}

	state, err := ReadDeviceState(host, Options{Port: port})
	if err != nil {
		t.Fatalf("ReadDeviceState(%s): %v", host, err)
	}
	if state.PageCount == nil {
		t.Fatalf("no page counter returned from %s", host)
	}
	t.Logf("live state: %s blocked=%v errors=%v", state.Describe(), state.Blocked, state.Errors)

	pages, err := ReadPageCount(host, Options{Port: port})
	if err != nil {
		t.Fatalf("ReadPageCount(%s): %v", host, err)
	}
	if pages != *state.PageCount {
		t.Fatalf("page count mismatch: %d vs %d", pages, *state.PageCount)
	}
}
