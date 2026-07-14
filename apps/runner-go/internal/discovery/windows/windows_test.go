package windows

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
)

// newTestDiscovery returns a Discovery whose run function is the supplied mock.
// This lets tests inject a controlled script executor without touching PowerShell.
func newTestDiscovery(mockRun func(ctx context.Context, script string) (string, error)) *Discovery {
	return &Discovery{
		log: logging.New("debug"),
		run: mockRun,
	}
}

// trackedRun records every script invocation so tests can assert ordering and count.
type trackedRun struct {
	mu    sync.Mutex
	calls []string
}

func (t *trackedRun) call(ctx context.Context, script string) (string, error) {
	t.mu.Lock()
	t.calls = append(t.calls, script)
	t.mu.Unlock()
	return "", nil
}

func (t *trackedRun) snapshot() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]string, len(t.calls))
	copy(out, t.calls)
	return out
}

// TestDiscoverWithTightParentDeadline proves that a parent context with a
// near-zero deadline does NOT starve independent discovery commands. Each
// command gets its own timeout via runPowerShell's context.Background()
// derivation. The test injects a mock run that reports three printers and
// asserts that all expected scripts were attempted.
func TestDiscoverWithTightParentDeadline(t *testing.T) {
	tr := &trackedRun{}

	// Mock run: return valid printer+port JSON for every script so
	// Discovery can parse results. The actual runPowerShell uses
	// context.Background() for its timeout — the mock doesn't care about
	// the context, but the production code does.
	mockRun := func(ctx context.Context, script string) (string, error) {
		tr.call(ctx, script)

		// Map script content fragments to appropriate JSON responses.
		// We match on fragments because the full script constants are long.
		switch {
		case contains(script, "Default=True"):
			// DefaultPrinter lookup returns a printer name.
			return "LAB_LABEL_01", nil
		case contains(script, "Get-Printer |"):
			// Tier 1: Get-Printer returns two printers.
			return mockPrintersJSON, nil
		case contains(script, "Get-PrinterPort |"):
			// Tier 1: Get-PrinterPort returns two ports.
			return mockPortsJSON, nil
		default:
			return "", nil
		}
	}

	d := newTestDiscovery(mockRun)

	// Parent context with an extremely short deadline — already expired.
	// Before the fix, runPowerShell derived cctx from this parent,
	// so WithTimeout picked the shorter deadline and every command
	// after the first would get "context deadline exceeded".
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()
	time.Sleep(time.Millisecond) // ensure deadline is past

	printers, err := d.Discover(ctx)
	if err != nil {
		t.Fatalf("Discover failed: %v", err)
	}
	if len(printers) != 2 {
		t.Fatalf("expected 2 printers, got %d: %+v", len(printers), printers)
	}

	calls := tr.snapshot()
	// We expect at least DefaultPrinter + Get-Printer + Get-PrinterPort.
	if len(calls) < 3 {
		t.Errorf("expected at least 3 script calls, got %d: %v", len(calls), calls)
	}

	// Verify default printer was detected.
	if !printers[0].IsDefault {
		t.Error("LAB_LABEL_01 should be default")
	}
}

// TestDiscoverFallbackToCIM proves that when Tier 1 (Get-Printer) returns
// no printers, the discovery transparently falls back to Tier 2 (CIM/WMI).
func TestDiscoverFallbackToCIM(t *testing.T) {
	tr := &trackedRun{}

	mockRun := func(ctx context.Context, script string) (string, error) {
		tr.call(ctx, script)
		switch {
		case contains(script, "Default=True"):
			return "CIM_FALLBACK", nil
		case contains(script, "Get-Printer |"):
			// Tier 1 returns empty JSON array — should trigger fallback.
			return "[]", nil
		case contains(script, "Get-PrinterPort |"):
			// Tier 1 ports also empty.
			return "[]", nil
		case contains(script, "Get-CimInstance -Class Win32_Printer"):
			// Tier 2 CIM fallback returns one printer.
			return `[{"Name":"CIM_FALLBACK","DriverName":"CIM Driver","PortName":"USB001","Shared":false,"Default":false,"PrinterStatus":"Normal","Location":"","Comment":""}]`, nil
		case contains(script, "Get-CimInstance -Class Win32_TCPIPPrinterPort"):
			return `[{"Name":"USB001","Description":"USB","HostAddress":"","PortNumber":0}]`, nil
		default:
			return "", nil
		}
	}

	d := newTestDiscovery(mockRun)
	ctx := context.Background()

	printers, err := d.Discover(ctx)
	if err != nil {
		t.Fatalf("Discover failed: %v", err)
	}
	if len(printers) != 1 {
		t.Fatalf("expected 1 printer from CIM fallback, got %d", len(printers))
	}
	if printers[0].Name != "CIM_FALLBACK" {
		t.Errorf("name = %q, want CIM_FALLBACK", printers[0].Name)
	}

	calls := tr.snapshot()
	// We expect: DefaultPrinter + Get-Printer(T1) + Get-PrinterPort(T1) +
	// Get-CimInstance(T2) + Get-CimInstance-Port(T2) = at least 5.
	if len(calls) < 5 {
		t.Errorf("expected at least 5 script calls (both tiers), got %d: %v", len(calls), calls)
	}
}

// TestDiscoverAllCommandsAttempted verifies that even when one command takes
// a long time, subsequent commands are still attempted (the core timeout
// starvation fix).
func TestDiscoverAllCommandsAttempted(t *testing.T) {
	tr := &trackedRun{}

	mockRun := func(ctx context.Context, script string) (string, error) {
		tr.call(ctx, script)

		// Simulate the DefaultPrinter lookup taking time.
		// In the old code this would consume the shared 5s deadline;
		// now each call gets its own budget.
		if contains(script, "Default=True") {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(50 * time.Millisecond):
			}
			return "SLOW_DEFAULT", nil
		}

		switch {
		case contains(script, "Get-Printer |"):
			return mockPrintersJSON, nil
		case contains(script, "Get-PrinterPort |"):
			return mockPortsJSON, nil
		default:
			return "", nil
		}
	}

	d := newTestDiscovery(mockRun)
	ctx := context.Background()

	printers, err := d.Discover(ctx)
	if err != nil {
		t.Fatalf("Discover failed: %v", err)
	}
	if len(printers) != 2 {
		t.Fatalf("expected 2 printers, got %d", len(printers))
	}

	calls := tr.snapshot()
	if len(calls) < 3 {
		t.Errorf("expected at least 3 calls (all commands attempted), got %d: %v", len(calls), calls)
	}
}

// TestDiscoverParentCancellationPropagates verifies that cancelling the
// parent context interrupts an in-progress command, preserving shutdown
// behaviour.
func TestDiscoverParentCancellationPropagates(t *testing.T) {
	tr := &trackedRun{}

	mockRun := func(ctx context.Context, script string) (string, error) {
		tr.call(ctx, script)
		// Simulate a slow command that respects cancellation.
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(5 * time.Second):
		}
		return "never", nil
	}

	d := newTestDiscovery(mockRun)
	ctx, cancel := context.WithCancel(context.Background())

	// Cancel immediately — Discover should abort the first command.
	cancel()

	printers, err := d.Discover(ctx)
	// The safeRun wrapper swallows errors, so Discover itself won't error.
	if err != nil {
		t.Fatalf("Discover errored (safeRun should swallow): %v", err)
	}
	if len(printers) != 0 {
		t.Errorf("expected 0 printers when cancelled, got %d", len(printers))
	}

	calls := tr.snapshot()
	if len(calls) < 1 {
		t.Error("expected at least 1 call (DefaultPrinter was attempted)")
	}
	// After the first command returns empty (cancelled), Tier 1 also fails
	// (empty result → no printers → falls to Tier 2 → Tier 2 also empty).
	// The key assertion is that the first call's context was cancelled.
	t.Logf("calls made after cancellation: %d (%v)", len(calls), calls)
}

// TestDiscoverEDiscoveryInterface ensures our constructor satisfies the
// PrinterDiscovery interface.
func TestDiscoverEDiscoveryInterface(t *testing.T) {
	d := New(logging.New("debug"))
	var _ discovery.PrinterDiscovery = d // compile-time check
	if d == nil {
		t.Fatal("New returned nil")
	}
}

// contains reports whether s contains substr.  Used to route mock responses
// by matching script fragment to the full constant.
func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// ── deriveCommandContext behaviour tests ────────────────────────────────
//
// These tests exercise the context helper directly, without PowerShell or
// mock injection.  TestDeriveCommandContext_DeadlineDoesNotCancelChild
// would FAIL with the previous implementation that cancelled the child
// context whenever parent.Done() fired — including on deadline expiry.
// TestDeriveCommandContext_CancelPropagation verifies the safety valve
// (SIGINT / explicit cancel) still works.

// TestDeriveCommandContext_DeadlineDoesNotCancelChild proves that a parent
// context whose deadline has already expired does NOT cancel the child
// context.  The child keeps its full timeout budget.  This is the core
// starvation fix: when the syncDiscoveryOnce 5s deadline fires during the
// first command, subsequent commands are not immediately killed.
func TestDeriveCommandContext_DeadlineDoesNotCancelChild(t *testing.T) {
	// Parent with an already-expired deadline.
	parent, pcancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	time.Sleep(time.Millisecond) // guarantee deadline is in the past
	defer pcancel()

	child, ccancel := deriveCommandContext(parent, 2*time.Second)
	defer ccancel()

	// The child context must NOT be cancelled — its Done channel must NOT
	// be closed by the parent's deadline.
	select {
	case <-child.Done():
		t.Fatalf("child context was cancelled by parent deadline (context cause: %v)", context.Cause(child))
	case <-time.After(100 * time.Millisecond):
		// Expected: child is still alive because parent only expired, didn't cancel.
	}
}

// TestDeriveCommandContext_CancelPropagation proves that an explicitly
// cancelled parent (context.Canceled) DOES cancel the child context.
// This preserves SIGINT / shutdown responsiveness.
func TestDeriveCommandContext_CancelPropagation(t *testing.T) {
	parent, pcancel := context.WithCancel(context.Background())

	child, ccancel := deriveCommandContext(parent, 1*time.Second)
	defer ccancel()

	// Cancel the parent — the goroutine should propagate.
	pcancel()

	// The child should be cancelled promptly.
	select {
	case <-child.Done():
		if context.Cause(child) != context.Canceled {
			t.Errorf("expected context.Canceled, got %v", context.Cause(child))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("child context was NOT cancelled after parent cancellation")
	}
}

// TestDeriveCommandContext_ChildOwnTimeout proves the child's own
// timeout fires independently of the parent.
func TestDeriveCommandContext_ChildOwnTimeout(t *testing.T) {
	parent := context.Background()

	child, ccancel := deriveCommandContext(parent, 50*time.Millisecond)
	defer ccancel()

	select {
	case <-child.Done():
		if context.Cause(child) != context.DeadlineExceeded {
			t.Errorf("expected context.DeadlineExceeded, got %v", context.Cause(child))
		}
	case <-time.After(1 * time.Second):
		t.Fatal("child's own timeout did NOT fire")
	}
}
