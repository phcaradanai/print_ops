package winpool

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/snmp"
)

func TestNewDefaults(t *testing.T) {
	e := New()
	if !e.SNMPEnabled {
		t.Error("SNMPEnabled should default to true")
	}
	if e.SNMPCommunity != "public" {
		t.Errorf("SNMPCommunity = %q, want public", e.SNMPCommunity)
	}
	if e.DeviceVerifyTimeout != 90*time.Second {
		t.Errorf("DeviceVerifyTimeout = %v, want 90s", e.DeviceVerifyTimeout)
	}
	if e.DevicePollInterval != time.Second {
		t.Errorf("DevicePollInterval = %v, want 1s", e.DevicePollInterval)
	}
	if e.snmpHosts == nil {
		t.Error("New() must install an SNMP host resolver")
	}
}

func TestResolveSNMPTarget(t *testing.T) {
	cases := []struct {
		name          string
		enabled       bool
		community     string
		options       map[string]string
		wantNil       bool
		wantHost      string
		wantCommunity string
	}{
		{
			name:          "explicit host uses executor community",
			enabled:       true,
			community:     "public",
			options:       map[string]string{"snmp_host": "192.168.1.50"},
			wantHost:      "192.168.1.50",
			wantCommunity: "public",
		},
		{
			name:          "job community overrides executor community",
			enabled:       true,
			community:     "public",
			options:       map[string]string{"snmp_host": "192.168.1.50", "snmp_community": "lab-ro"},
			wantHost:      "192.168.1.50",
			wantCommunity: "lab-ro",
		},
		{
			name:          "wsd ipv6 link local host is passed through untouched",
			enabled:       true,
			community:     "public",
			options:       map[string]string{"snmp_host": "fe80::5257:9cff:fe4f:6a3c%6"},
			wantHost:      "fe80::5257:9cff:fe4f:6a3c%6",
			wantCommunity: "public",
		},
		{
			name:      "job opts out",
			enabled:   true,
			community: "public",
			options:   map[string]string{"snmp_host": "192.168.1.50", "snmp_enabled": "false"},
			wantNil:   true,
		},
		{
			name:      "job opt out is case insensitive",
			enabled:   true,
			community: "public",
			options:   map[string]string{"snmp_host": "192.168.1.50", "snmp_enabled": "FALSE"},
			wantNil:   true,
		},
		{
			name:      "executor disabled",
			enabled:   false,
			community: "public",
			options:   map[string]string{"snmp_host": "192.168.1.50"},
			wantNil:   true,
		},
		{
			name:          "empty executor community falls back to public",
			enabled:       true,
			community:     "",
			options:       map[string]string{"snmp_host": "192.168.1.50"},
			wantHost:      "192.168.1.50",
			wantCommunity: "public",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := New()
			e.SNMPEnabled = tc.enabled
			e.SNMPCommunity = tc.community

			got := e.resolveSNMPTarget(context.Background(), printer.PrintJob{Options: tc.options}, "EPSON_LAB_01")
			if tc.wantNil {
				if got != nil {
					t.Fatalf("expected no target, got %+v", got)
				}
				return
			}
			if got == nil {
				t.Fatal("expected a target, got nil")
			}
			if got.Host != tc.wantHost {
				t.Errorf("host = %q, want %q", got.Host, tc.wantHost)
			}
			if got.Community != tc.wantCommunity {
				t.Errorf("community = %q, want %q", got.Community, tc.wantCommunity)
			}
		})
	}
}

// TestResolveSNMPTargetWithoutResolver covers a hand-built Executor: no
// resolver and no explicit host must degrade to "skip SNMP", never a panic.
func TestResolveSNMPTargetWithoutResolver(t *testing.T) {
	e := &Executor{SNMPEnabled: true, SNMPCommunity: "public"}
	if got := e.resolveSNMPTarget(context.Background(), printer.PrintJob{}, "EPSON_LAB_01"); got != nil {
		t.Errorf("expected no target without a resolver, got %+v", got)
	}
}

// TestWaitForDeviceConfirmationTimeout pins the outcome when no device read
// succeeds during the whole window — a device that goes quiet mid-verify.
// This is the "we don't know" branch (outcomeUnverifiable), NOT a real
// negative: nothing disproves the print, so the caller reports UNVERIFIED to
// avoid a retry that would risk a duplicate page. An earlier version of this
// test asserted the "did not advance" wording here, which is exactly the
// HIGH-2 defect: it treated an unreachable device as a proven no-page.
func TestWaitForDeviceConfirmationTimeout(t *testing.T) {
	e := New()
	e.DeviceVerifyTimeout = 30 * time.Millisecond
	e.DevicePollInterval = 5 * time.Millisecond

	got := e.waitForDeviceConfirmation(
		context.Background(),
		snmpTarget{Host: "printer.invalid.", Community: "public"},
		4200,
		2,
	)
	if got.Confirmed {
		t.Error("an unreachable device must not be reported as confirmed")
	}
	if got.Inconclusive {
		t.Error("a timeout is a verdict, not an interruption")
	}
	if !got.Unverifiable {
		t.Errorf("a device that never answered must be Unverifiable (we-don't-know), not a proven no-page; Outcome=%v", got.Outcome)
	}
	if got.Outcome != outcomeUnverifiable {
		t.Errorf("Outcome = %v, want outcomeUnverifiable", got.Outcome)
	}
	if got.PagesAfter != 4200 {
		t.Errorf("PagesAfter = %d, want the unchanged baseline 4200", got.PagesAfter)
	}
	if !strings.Contains(got.Detail, "stopped answering") {
		t.Errorf("Detail = %q, want it to say the device stopped answering", got.Detail)
	}
}

// TestWaitForDeviceConfirmationContextCancelled pins the distinction the
// caller depends on: a cancelled context is not a device verdict, so the wait
// must be reported as interrupted rather than as the device refusing. Execute
// turns that into PRINT_NOT_VERIFIABLE — no verdict is not proof of printing.
func TestWaitForDeviceConfirmationContextCancelled(t *testing.T) {
	e := New()
	e.DeviceVerifyTimeout = 10 * time.Second
	e.DevicePollInterval = 5 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	got := e.waitForDeviceConfirmation(ctx, snmpTarget{Host: "printer.invalid.", Community: "public"}, 7, 1)
	if got.Confirmed {
		t.Error("a cancelled wait must not report confirmation")
	}
	if !got.Inconclusive {
		t.Error("a cancelled wait must be inconclusive so the trace says interrupted, not refused")
	}
	if !strings.Contains(got.Detail, "interrupted") {
		t.Errorf("Detail = %q, want it to say verification was interrupted", got.Detail)
	}
}

// TestDescribeVerificationGap pins the three operator-actionable reasons a
// print can end up unverified, so the message never collapses back into an
// undiagnosable "not confirmed".
func TestDescribeVerificationGap(t *testing.T) {
	pages := int64(4200)
	cases := []struct {
		name         string
		target       *snmpTarget
		deviceBefore *snmp.DeviceState
		want         string
	}{
		{
			name: "no snmp address resolved",
			want: "No SNMP address could be derived",
		},
		{
			name:   "device did not answer",
			target: &snmpTarget{Host: "192.168.1.50", Community: "public"},
			want:   "did not answer SNMP on port 161",
		},
		{
			name:         "device exposes no page counter",
			target:       &snmpTarget{Host: "192.168.1.50", Community: "public"},
			deviceBefore: &snmp.DeviceState{},
			want:         "exposes no page counter",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := describeVerificationGap("EPSON_LAB_01", tc.target, tc.deviceBefore)
			if !strings.Contains(got, tc.want) {
				t.Errorf("describeVerificationGap = %q, want it to mention %q", got, tc.want)
			}
		})
	}

	// A device that reports a counter is not a gap at all — the caller never
	// reaches this helper in that case.
	if got := describeVerificationGap("EPSON_LAB_01", cases[2].target, &snmp.DeviceState{PageCount: &pages}); got == "" {
		t.Error("describeVerificationGap must always explain itself")
	}
}

// TestWaitForDeviceConfirmationReadThenStuck pins the "real negative" branch:
// the counter WAS read but did not advance by the expected delta. That is a
// proven no-page, so the outcome is not-confirmed (→ FAILED, retry-safe) —
// the exact opposite of the unreachable case. HIGH-2 was the conflation of
// these two, so both are pinned here in the same package.
func TestWaitForDeviceConfirmationReadThenStuck(t *testing.T) {
	e := New()
	e.DeviceVerifyTimeout = 30 * time.Millisecond
	e.DevicePollInterval = 5 * time.Millisecond

	stuck := int64(100)
	e.readDeviceStateFn = func(host string, opts snmp.Options) (*snmp.DeviceState, error) {
		// Always answers, always reports the same counter, never blocked.
		c := stuck
		return &snmp.DeviceState{PageCount: &c}, nil
	}

	got := e.waitForDeviceConfirmation(
		context.Background(),
		snmpTarget{Host: "192.168.1.50", Community: "public"},
		100,
		2,
	)
	if got.Confirmed {
		t.Error("a stationary counter must not be reported as confirmed")
	}
	if got.Inconclusive {
		t.Error("a stationary counter is a verdict, not an interruption")
	}
	if got.Unverifiable {
		t.Error("a counter that was read must NOT be Unverifiable — retry is safe")
	}
	if got.Outcome != outcomeNotConfirmed {
		t.Errorf("Outcome = %v, want outcomeNotConfirmed", got.Outcome)
	}
	if got.PagesAfter != 100 {
		t.Errorf("PagesAfter = %d, want 100 (the read counter)", got.PagesAfter)
	}
	if !strings.Contains(got.Detail, "did not advance") {
		t.Errorf("Detail = %q, want it to mention the counter not advancing", got.Detail)
	}
	if !strings.Contains(got.Detail, "expected +2") {
		t.Errorf("Detail = %q, want it to state the expected page delta", got.Detail)
	}
}

// TestWaitForDeviceConfirmationAdvances pins the confirmed branch: the counter
// advances by >= copies → confirmed, the only SUCCESS path.
func TestWaitForDeviceConfirmationAdvances(t *testing.T) {
	e := New()
	e.DeviceVerifyTimeout = 30 * time.Millisecond
	e.DevicePollInterval = 5 * time.Millisecond

	current := int64(100)
	e.readDeviceStateFn = func(host string, opts snmp.Options) (*snmp.DeviceState, error) {
		// First poll keeps the baseline, the second advances by 2.
		c := current
		current += 2
		return &snmp.DeviceState{PageCount: &c}, nil
	}

	got := e.waitForDeviceConfirmation(
		context.Background(),
		snmpTarget{Host: "192.168.1.50", Community: "public"},
		100,
		2,
	)
	if !got.Confirmed {
		t.Errorf("a counter that advanced by the delta must be confirmed; Outcome=%v Detail=%s", got.Outcome, got.Detail)
	}
	if got.Outcome != outcomeConfirmed {
		t.Errorf("Outcome = %v, want outcomeConfirmed", got.Outcome)
	}
}

func TestReadDeviceStateUnreachableReturnsNil(t *testing.T) {
	e := New()
	if got := e.readDeviceState(snmpTarget{Host: "printer.invalid.", Community: "public"}); got != nil {
		t.Errorf("an unreachable printer must read as nil, got %+v", got)
	}
}

func TestBuildSNMPHostScript(t *testing.T) {
	script := buildSNMPHostScript("EPSON L3250 Series")
	if !strings.Contains(script, "$PrinterName = 'EPSON L3250 Series'") {
		t.Errorf("printer name was not substituted:\n%s", script)
	}
	if strings.Contains(script, "__PRINTER_NAME__") {
		t.Error("placeholder was left in the script")
	}
	for _, want := range []string{
		"Get-PrinterPort",
		"PrinterHostAddress",
		`HKLM:\SYSTEM\CurrentControlSet\Enum\SWD\DAFWSDProvider`,
		`'\[([0-9a-fA-F:%]+)\]'`,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("script is missing %q", want)
		}
	}
}

// TestBuildSNMPHostScriptEscapesQuotes stops a printer name with an apostrophe
// from terminating the PowerShell string literal.
func TestBuildSNMPHostScriptEscapesQuotes(t *testing.T) {
	script := buildSNMPHostScript("Bob's Printer")
	if !strings.Contains(script, "$PrinterName = 'Bob''s Printer'") {
		t.Errorf("apostrophe was not doubled:\n%s", script)
	}
}

func TestFirstNonEmptyLine(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"whitespace only", "  \r\n \t \n", ""},
		{"single line", "192.168.1.50\r\n", "192.168.1.50"},
		{"leading blank lines", "\r\n\r\n192.168.1.50\r\n", "192.168.1.50"},
		{"first of many", "fe80::1%6\r\n192.168.1.50\r\n", "fe80::1%6"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := firstNonEmptyLine(tc.in); got != tc.want {
				t.Errorf("firstNonEmptyLine(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestSNMPHostResolverCache(t *testing.T) {
	r := newSNMPHostResolver()
	r.cache["EPSON_A"] = "192.168.1.50"
	r.cache["EPSON_B"] = ""

	if got := r.Resolve(context.Background(), "EPSON_A"); got != "" && got != "192.168.1.50" {
		t.Errorf("cached resolution = %q, want the cached value", got)
	}

	r.Forget("EPSON_A")
	if _, ok := r.cache["EPSON_A"]; ok {
		t.Error("Forget should drop the named entry")
	}
	if _, ok := r.cache["EPSON_B"]; !ok {
		t.Error("Forget should leave other entries alone")
	}

	r.Forget("")
	if len(r.cache) != 0 {
		t.Errorf("Forget(\"\") should clear the cache, %d entries left", len(r.cache))
	}
}

func TestResolveEmptyPrinterName(t *testing.T) {
	r := newSNMPHostResolver()
	if got := r.Resolve(context.Background(), "   "); got != "" {
		t.Errorf("blank printer name should resolve to empty, got %q", got)
	}
}
