package multi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// stubExecutor returns a fixed result and error.
type stubExecutor struct {
	name   string
	result *printer.PrintResult
	err    error
}

func (s *stubExecutor) Name() string { return s.name }
func (s *stubExecutor) Execute(_ context.Context, _ printer.PrintJob) (*printer.PrintResult, error) {
	return s.result, s.err
}

// recordingExecutor captures the context and job passed to Execute.
type recordingExecutor struct {
	mu      sync.Mutex
	name    string
	lastCtx context.Context
	lastJob printer.PrintJob
	result  *printer.PrintResult
	err     error
}

func (r *recordingExecutor) Name() string { return r.name }
func (r *recordingExecutor) Execute(ctx context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	r.mu.Lock()
	r.lastCtx = ctx
	r.lastJob = job
	r.mu.Unlock()
	return r.result, r.err
}

func (r *recordingExecutor) lastContext() context.Context {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.lastCtx
}

// contextAssertExecutor asserts that ctx is not nil and records whether it was called.
type contextAssertExecutor struct {
	called bool
}

func (c *contextAssertExecutor) Name() string { return "ctx-assert" }
func (c *contextAssertExecutor) Execute(ctx context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	c.called = true
	if ctx == nil {
		return nil, errors.New("context must not be nil")
	}
	select {
	case <-ctx.Done():
		return &printer.PrintResult{
			Status:   printer.StatusFailed,
			Executor: c.Name(),
			Err:      ctx.Err(),
		}, ctx.Err()
	default:
		return &printer.PrintResult{
			Status:   printer.StatusSuccess,
			Executor: c.Name(),
			Evidence: map[string]any{"ok": true},
		}, nil
	}
}

// makeJob is a helper to construct a PrintJob with protocol option.
func makeJob(protocol string) printer.PrintJob {
	return printer.PrintJob{
		JobID:     "job-1",
		TraceID:   "trace-1",
		PrinterID: "printer-1",
		Options:   map[string]string{"printer_protocol": protocol},
	}
}

// ---------------------------------------------------------------------------
// Zero-value safety
// ---------------------------------------------------------------------------

func TestRegister_ZeroValue_NoPanic(t *testing.T) {
	var d Dispatcher // zero value — Executors is nil
	exec := &stubExecutor{name: "test"}

	// Must not panic.
	d.Register("  RAW-TCP-9100  ", exec)

	if d.Executors == nil {
		t.Fatal("Executors map should be initialized after Register on zero value")
	}
	if got := d.Executors["raw-tcp-9100"]; got != exec {
		t.Fatalf("expected executor %v, got %v", exec, got)
	}
}

func TestExecute_ZeroValue_NoPanic(t *testing.T) {
	var d Dispatcher // zero value — Executors is nil, Default is nil
	job := makeJob("raw-tcp-9100")

	result, err := d.Execute(context.Background(), job)
	if err == nil {
		t.Fatal("expected error from noop on zero-value Dispatcher")
	}
	if result == nil {
		t.Fatal("expected non-nil result from noopExecutor")
	}
	if result.Status != printer.StatusFailed {
		t.Fatalf("expected StatusFailed, got %s", result.Status)
	}
	if !strings.Contains(result.SafeMessage, "no executor") {
		t.Fatalf("expected no-executor message, got %q", result.SafeMessage)
	}
}

// ---------------------------------------------------------------------------
// Protocol matching — direct
// ---------------------------------------------------------------------------

func TestSelectExecutor_DirectMatch(t *testing.T) {
	fake := &stubExecutor{name: "fake"}
	raw := &stubExecutor{name: "rawtcp"}

	d := New(fake)
	d.Register("raw-tcp-9100", raw)

	tests := []struct {
		protocol string
		wantName string
	}{
		{"raw-tcp-9100", "rawtcp"},
		{"RAW-TCP-9100", "rawtcp"}, // case-insensitive
		{"Raw-Tcp-9100", "rawtcp"},
		{"  raw-tcp-9100  ", "rawtcp"}, // trimmed
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("protocol=%q", tt.protocol), func(t *testing.T) {
			job := makeJob(tt.protocol)
			got := d.selectExecutor(job)
			if got.Name() != tt.wantName {
				t.Errorf("expected %q, got %q", tt.wantName, got.Name())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Protocol aliases (table-driven)
// ---------------------------------------------------------------------------

func TestSelectExecutor_ProtocolAliases(t *testing.T) {
	raw := &stubExecutor{name: "rawtcp"}
	zpl := &stubExecutor{name: "zpl"}
	tspl := &stubExecutor{name: "tspl"}
	windows := &stubExecutor{name: "winspool"}
	cups := &stubExecutor{name: "cups"}
	def := &stubExecutor{name: "default"}

	d := New(def)
	d.Register("raw-tcp-9100", raw)
	d.Register("zpl", zpl)
	d.Register("tspl", tspl)
	d.Register("windows-spooler", windows)
	d.Register("cups", cups)

	tests := []struct {
		protocol string
		wantName string // resolved executor name
	}{
		// Raw / TCP / 9100 aliases
		{protocol: "raw", wantName: "rawtcp"},
		{protocol: "tcp", wantName: "rawtcp"},
		{protocol: "9100", wantName: "rawtcp"},
		{protocol: "raw-tcp", wantName: "rawtcp"},
		{protocol: "RAW-TCP-9100", wantName: "rawtcp"},
		{protocol: "tcp-9100", wantName: "rawtcp"},
		{protocol: "raw-9100", wantName: "rawtcp"},
		// ZPL aliases
		{protocol: "zpl", wantName: "zpl"},
		{protocol: "ZPL", wantName: "zpl"},
		{protocol: "zpl-ii", wantName: "zpl"},
		{protocol: "zpl2", wantName: "zpl"},
		// TSPL aliases
		{protocol: "tspl", wantName: "tspl"},
		{protocol: "TSPL", wantName: "tspl"},
		// Windows / spooler aliases
		{protocol: "windows", wantName: "winspool"},
		{protocol: "spooler", wantName: "winspool"},
		{protocol: "winspool", wantName: "winspool"},
		{protocol: "windows-spooler", wantName: "winspool"},
		// CUPS aliases
		{protocol: "cups", wantName: "cups"},
		{protocol: "CUPS", wantName: "cups"},
		// Unknown protocol → default
		{protocol: "lpr", wantName: "default"},
		{protocol: "ipp", wantName: "default"},
		{protocol: "unknown", wantName: "default"},
		// Empty protocol → default
		{protocol: "", wantName: "default"},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("in=%q→%s", tt.protocol, tt.wantName), func(t *testing.T) {
			job := makeJob(tt.protocol)
			got := d.selectExecutor(job)
			if got.Name() != tt.wantName {
				t.Errorf("selectExecutor(%q) = %q, want %q", tt.protocol, got.Name(), tt.wantName)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Default fallback – empty protocol, no match
// ---------------------------------------------------------------------------

func TestSelectExecutor_DefaultFallback(t *testing.T) {
	def := &stubExecutor{name: "default"}
	d := New(def)

	// Empty protocol → default
	job := makeJob("")
	got := d.selectExecutor(job)
	if got.Name() != "default" {
		t.Errorf("empty protocol: expected default, got %q", got.Name())
	}

	// Missing option key entirely
	job2 := printer.PrintJob{JobID: "j2"}
	got2 := d.selectExecutor(job2)
	if got2.Name() != "default" {
		t.Errorf("missing protocol option: expected default, got %q", got2.Name())
	}

	// Unknown protocol → default
	job3 := makeJob("unknown-protocol")
	got3 := d.selectExecutor(job3)
	if got3.Name() != "default" {
		t.Errorf("unknown protocol: expected default, got %q", got3.Name())
	}
}

// ---------------------------------------------------------------------------
// Noop fallback – no Default configured
// ---------------------------------------------------------------------------

func TestSelectExecutor_NoopFallback(t *testing.T) {
	d := New(nil) // nil default

	// Empty protocol → noop
	job := makeJob("")
	got := d.selectExecutor(job)
	if got.Name() != "noop" {
		t.Errorf("empty protocol with nil default: expected noop, got %q", got.Name())
	}

	// Unknown protocol → noop
	job2 := makeJob("unknown")
	got2 := d.selectExecutor(job2)
	if got2.Name() != "noop" {
		t.Errorf("unknown protocol with nil default: expected noop, got %q", got2.Name())
	}

	// Verify noop produces an error.
	result, err := got2.Execute(context.Background(), job2)
	if err == nil {
		t.Fatal("noop should return an error")
	}
	if result.Status != printer.StatusFailed {
		t.Errorf("noop should return StatusFailed, got %s", result.Status)
	}
}

// ---------------------------------------------------------------------------
// Context propagation and cancellation
// ---------------------------------------------------------------------------

func TestExecute_ContextPassedToExecutor(t *testing.T) {
	rec := &recordingExecutor{
		name:   "rec",
		result: &printer.PrintResult{Status: printer.StatusSuccess, Executor: "rec"},
	}
	d := New(rec)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	job := makeJob("")
	_, _ = d.Execute(ctx, job)

	lastCtx := rec.lastContext()
	if lastCtx == nil {
		t.Fatal("executor received nil context")
	}
	if lastCtx != ctx {
		t.Error("executor received a different context than the one passed to Execute")
	}
}

func TestExecute_ContextCancellation(t *testing.T) {
	ca := &contextAssertExecutor{}
	d := New(ca)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	job := makeJob("cups")
	result, err := d.Execute(ctx, job)

	if !ca.called {
		t.Fatal("executor was not called")
	}
	if result == nil {
		t.Fatal("expected non-nil result on cancellation")
	}
	if result.Status != printer.StatusFailed {
		t.Errorf("expected StatusFailed on cancellation, got %s", result.Status)
	}
	if err == nil {
		t.Fatal("expected error from cancelled context")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}
	// dispatched_executor evidence should still be set even on cancellation.
	if result.Evidence == nil || result.Evidence["dispatched_executor"] != "ctx-assert" {
		t.Errorf("expected dispatched_executor in evidence, got %v", result.Evidence)
	}
}

func TestExecute_ContextTimeout(t *testing.T) {
	ca := &contextAssertExecutor{}
	d := New(ca)

	ctx, cancel := context.WithTimeout(context.Background(), 0) // immediate timeout
	defer cancel()

	// Let the deadline trigger.
	time.Sleep(time.Millisecond)

	job := makeJob("zpl")
	result, err := d.Execute(ctx, job)

	if !ca.called {
		t.Fatal("executor was not called")
	}
	if result == nil {
		t.Fatal("expected non-nil result on timeout")
	}
	if err == nil {
		t.Fatal("expected error from timed-out context")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("expected context.DeadlineExceeded, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Executor error propagation
// ---------------------------------------------------------------------------

func TestExecute_ErrorPropagation(t *testing.T) {
	customErr := errors.New("printer on fire")
	failExec := &stubExecutor{
		name: "failer",
		result: &printer.PrintResult{
			Status:      printer.StatusFailed,
			Executor:    "failer",
			SafeMessage: "failed",
			Err:         customErr,
		},
		err: customErr,
	}

	d := New(failExec)
	job := makeJob("raw")
	result, err := d.Execute(context.Background(), job)

	if err == nil {
		t.Fatal("expected error to be propagated")
	}
	if !errors.Is(err, customErr) {
		t.Errorf("expected customErr, got %v", err)
	}
	if result.Status != printer.StatusFailed {
		t.Errorf("expected StatusFailed, got %s", result.Status)
	}
	if result.Executor != "failer" {
		t.Errorf("expected executor 'failer', got %q", result.Executor)
	}
	// dispatched_executor should still be set.
	if ev, ok := result.Evidence["dispatched_executor"]; !ok || ev != "failer" {
		t.Errorf("expected dispatched_executor='failer', got %v", result.Evidence["dispatched_executor"])
	}
}

func TestExecute_ErrorWithoutResult(t *testing.T) {
	// Executor returns (nil, error) — should propagate the error.
	errExec := &stubExecutor{
		name:   "err-only",
		result: nil,
		err:    errors.New("boom"),
	}
	d := New(errExec)
	job := makeJob("tcp")
	_, err := d.Execute(context.Background(), job)

	if err == nil {
		t.Fatal("expected error")
	}
	if err.Error() != "boom" {
		t.Errorf("expected 'boom', got %q", err.Error())
	}
}

// ---------------------------------------------------------------------------
// Successful execution + dispatched_executor evidence
// ---------------------------------------------------------------------------

func TestExecute_DispatchedExecutorEvidence(t *testing.T) {
	exec := &stubExecutor{
		name: "fake",
		result: &printer.PrintResult{
			Status:   printer.StatusSuccess,
			Executor: "fake",
			Evidence: map[string]any{"payload_size": 1024, "copies": 2},
		},
	}

	d := New(exec)
	job := makeJob("fake")
	result, err := d.Execute(context.Background(), job)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != printer.StatusSuccess {
		t.Fatalf("expected StatusSuccess, got %s", result.Status)
	}
	// dispatched_executor must be present.
	dispatched, ok := result.Evidence["dispatched_executor"]
	if !ok {
		t.Fatal("expected dispatched_executor in Evidence")
	}
	if dispatched != "fake" {
		t.Errorf("dispatched_executor = %q, want %q", dispatched, "fake")
	}
	// Original evidence must be preserved.
	if result.Evidence["payload_size"] != 1024 {
		t.Errorf("payload_size = %v, want 1024", result.Evidence["payload_size"])
	}
}

func TestExecute_NilEvidenceInitialized(t *testing.T) {
	exec := &stubExecutor{
		name: "nil-ev",
		result: &printer.PrintResult{
			Status:   printer.StatusSuccess,
			Executor: "nil-ev",
			// Evidence is nil.
		},
	}

	d := New(exec)
	job := makeJob("nil-ev")
	result, err := d.Execute(context.Background(), job)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Evidence == nil {
		t.Fatal("Evidence should be initialized when nil")
	}
	if result.Evidence["dispatched_executor"] != "nil-ev" {
		t.Errorf("expected dispatched_executor='nil-ev', got %v", result.Evidence["dispatched_executor"])
	}
}

// ---------------------------------------------------------------------------
// Nil Default on constructed Dispatcher
// ---------------------------------------------------------------------------

func TestExecute_NilDefault_FallsBackToNoop(t *testing.T) {
	d := New(nil)
	job := makeJob("no-match")
	result, err := d.Execute(context.Background(), job)

	if err == nil {
		t.Fatal("expected error from noop")
	}
	if result.Status != printer.StatusFailed {
		t.Errorf("expected StatusFailed, got %s", result.Status)
	}
	// dispatched_executor should be "noop".
	if ev, ok := result.Evidence["dispatched_executor"]; !ok || ev != "noop" {
		t.Errorf("expected dispatched_executor='noop', got %v", result.Evidence["dispatched_executor"])
	}
}

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

func TestDispatcher_Name(t *testing.T) {
	d := New(nil)
	if d.Name() != "multi" {
		t.Errorf("expected Name=multi, got %q", d.Name())
	}
}

// ---------------------------------------------------------------------------
// Concurrent access safety (optional, best-effort)
// ---------------------------------------------------------------------------

func TestDispatcher_ConcurrentRegisterAndExecute(t *testing.T) {
	d := New(&stubExecutor{name: "default"})
	var wg sync.WaitGroup
	regCount := 20
	execCount := 20

	// Concurrent registrations.
	for i := 0; i < regCount; i++ {
		wg.Add(1)
		go func(proto string) {
			defer wg.Done()
			d.Register(proto, &stubExecutor{name: proto})
		}(fmt.Sprintf("proto-%d", i))
	}

	// Concurrent executions.
	for i := 0; i < execCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = d.Execute(context.Background(), makeJob(""))
		}()
	}

	wg.Wait()
	// If we get here without panicking or data race, it's a pass.
}
