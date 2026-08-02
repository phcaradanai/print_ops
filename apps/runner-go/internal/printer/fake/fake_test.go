package fake

import (
	"context"
	"testing"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
)

func TestExecute_Success(t *testing.T) {
	e := &Executor{Latency: 5 * time.Millisecond}
	job := printer.PrintJob{
		JobID:           "job-1",
		PrinterCode:     "LAB_LABEL_01",
		Copies:          1,
		RenderedPayload: []byte("dummy"),
	}
	res, err := e.Execute(context.Background(), job)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if res.Status != printer.StatusSuccess {
		t.Errorf("status = %q, want SUCCESS", res.Status)
	}
	if res.Executor != "fake" {
		t.Errorf("executor = %q, want fake", res.Executor)
	}
	if res.DurationMs < 0 {
		t.Error("duration should be non-negative")
	}
	if res.Evidence["executor"] != "fake" {
		t.Error("evidence should contain executor=fake")
	}
}

func TestExecute_FailureViaOptions(t *testing.T) {
	e := &Executor{Latency: 1 * time.Millisecond}
	job := printer.PrintJob{
		JobID:   "job-fail",
		Options: map[string]string{"fake_result": "fail"},
	}
	res, err := e.Execute(context.Background(), job)
	if err != nil {
		t.Fatalf("Execute should not return go error on simulated failure: %v", err)
	}
	if res.Status != printer.StatusFailed {
		t.Errorf("status = %q, want FAILED", res.Status)
	}
	if res.Err == nil {
		t.Error("failed result should carry an Err")
	}
}

func TestExecute_FailureViaForceFail(t *testing.T) {
	e := &Executor{Latency: 1 * time.Millisecond, ForceFail: true}
	job := printer.PrintJob{JobID: "job-force-fail"}
	res, _ := e.Execute(context.Background(), job)
	if res.Status != printer.StatusFailed {
		t.Errorf("status = %q, want FAILED", res.Status)
	}
}

func TestExecute_RespectsContextCancellation(t *testing.T) {
	e := &Executor{Latency: 5 * time.Second} // long
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	res, err := e.Execute(ctx, printer.PrintJob{JobID: "job-cancel"})
	if err != nil {
		t.Fatalf("Execute returned go error: %v", err)
	}
	if res.Status != printer.StatusFailed {
		t.Errorf("status = %q, want FAILED on cancellation", res.Status)
	}
	if res.Evidence["reason"] != "context_cancelled" {
		t.Errorf("evidence reason = %v, want context_cancelled", res.Evidence["reason"])
	}
}

func TestExecute_LatencyFromJobOptions(t *testing.T) {
	e := &Executor{} // no struct latency; uses default
	job := printer.PrintJob{
		JobID:   "job-latency-opt",
		Options: map[string]string{"fake_latency_ms": "30"},
	}
	start := time.Now()
	res, _ := e.Execute(context.Background(), job)
	elapsed := time.Since(start)
	if elapsed < 25*time.Millisecond {
		t.Errorf("job option latency not honored; elapsed = %v", elapsed)
	}
	if res.DurationMs < 25 {
		t.Errorf("DurationMs = %d, want >= 25", res.DurationMs)
	}
}
