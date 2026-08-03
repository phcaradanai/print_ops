// Package printer defines the print execution contract (PrintExecutor) and the
// shared PrintJob / PrintResult models used by all executor backends
// (fake, rawtcp, ...). Label-language payload builders live in sub-packages
// (zpl, tspl).
package printer

import (
	"context"
	"time"
)

// PrintJob is the minimal, executor-facing view of a job. It is intentionally
// decoupled from the API's rich Job model: the jobs package maps between them.
//
// RenderedPayload holds the bytes to send to the printer. It is treated as
// SENSITIVE and must never be logged raw.
type PrintJob struct {
	JobID           string
	TraceID         string
	PrinterID       string
	PrinterCode     string
	MimeType        string
	Copies          int
	RenderedPayload []byte
	// Options carries executor hints (e.g. fake success/fail, address:port).
	Options map[string]string
}

// ResultStatus is the terminal execution status.
type ResultStatus string

const (
	StatusSuccess    ResultStatus = "SUCCESS"
	StatusUnverified ResultStatus = "UNVERIFIED"
	StatusFailed     ResultStatus = "FAILED"
)

// PrintResult is the outcome of executing a PrintJob.
type PrintResult struct {
	Status      ResultStatus
	Executor    string
	SafeMessage string
	DurationMs  int64
	StartedAt   time.Time
	FinishedAt  time.Time
	// Evidence contains non-sensitive facts about the execution.
	Evidence map[string]any
	// Err is the underlying error on failure (may be nil).
	Err error
}

// PrintExecutor executes a rendered print job against a printer.
type PrintExecutor interface {
	// Name returns a short executor identifier (e.g. "fake", "rawtcp").
	Name() string
	// Execute performs the print. Implementations MUST respect ctx deadlines,
	// MUST NOT panic, and MUST NOT log raw payload bytes.
	Execute(ctx context.Context, job PrintJob) (*PrintResult, error)
}
