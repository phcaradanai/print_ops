// Package fake provides a simulated PrintExecutor for development and testing.
// It never touches a real printer; instead it simulates render/print latency
// and can be forced to fail via job options or environment.
package fake

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
)

// defaultLatency is the simulated print latency when none is configured.
const defaultLatency = 50 * time.Millisecond

// Executor is the fake PrintExecutor.
type Executor struct {
	// Latency overrides the simulated print duration. Zero uses defaultLatency
	// or the PRINTOPS_FAKE_LATENCY_MS environment variable.
	Latency time.Duration
	// ForceFail, when true, makes every job fail regardless of options.
	ForceFail bool
}

// New returns a fake executor honoring PRINTOPS_FAKE_* environment overrides.
func New() *Executor {
	e := &Executor{}
	if v := os.Getenv("PRINTOPS_FAKE_LATENCY_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms >= 0 {
			e.Latency = time.Duration(ms) * time.Millisecond
		}
	}
	if strings.EqualFold(os.Getenv("PRINTOPS_FAKE_FORCE_FAIL"), "true") {
		e.ForceFail = true
	}
	return e
}

// Name implements PrintExecutor.
func (e *Executor) Name() string { return "fake" }

// Execute simulates printing. A job fails when ForceFail is set or when its
// Options contain fake_result=fail (case-insensitive).
func (e *Executor) Execute(ctx context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	start := time.Now()
	latency := e.Latency
	if latency == 0 {
		latency = defaultLatency
	}
	if v := job.Options["fake_latency_ms"]; v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms >= 0 {
			latency = time.Duration(ms) * time.Millisecond
		}
	}

	// Simulate work while respecting cancellation.
	select {
	case <-time.After(latency):
	case <-ctx.Done():
		finished := time.Now()
		return &printer.PrintResult{
			Status:      printer.StatusFailed,
			Executor:    e.Name(),
			SafeMessage: "fake print cancelled",
			DurationMs:  finished.Sub(start).Milliseconds(),
			StartedAt:   start,
			FinishedAt:  finished,
			Evidence:    map[string]any{"executor": "fake", "reason": "context_cancelled"},
			Err:         ctx.Err(),
		}, nil
	}

	finished := time.Now()
	shouldFail := e.ForceFail || strings.EqualFold(job.Options["fake_result"], "fail")

	if shouldFail {
		return &printer.PrintResult{
			Status:      printer.StatusFailed,
			Executor:    e.Name(),
			SafeMessage: "fake print failed (simulated)",
			DurationMs:  finished.Sub(start).Milliseconds(),
			StartedAt:   start,
			FinishedAt:  finished,
			Evidence: map[string]any{
				"executor":     "fake",
				"payload_size": len(job.RenderedPayload),
				"copies":       job.Copies,
			},
			Err: errors.New("simulated fake failure"),
		}, nil
	}

	return &printer.PrintResult{
		Status:      printer.StatusSuccess,
		Executor:    e.Name(),
		SafeMessage: "fake print completed",
		DurationMs:  finished.Sub(start).Milliseconds(),
		StartedAt:   start,
		FinishedAt:  finished,
		Evidence: map[string]any{
			"executor":     "fake",
			"payload_size": len(job.RenderedPayload),
			"copies":       job.Copies,
			"printer_code": job.PrinterCode,
		},
	}, nil
}
