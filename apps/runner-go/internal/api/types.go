// Package api also defines the API-facing DTOs used by the runner. These
// intentionally mirror the existing Fastify/TypeScript domain models so the Go
// runner is wire-compatible without changing the API.
package api

import (
	"encoding/json"
	"time"
)

// JobStatus mirrors the API's JobStatus union (subset relevant to the runner).
type JobStatus string

const (
	JobQueued   JobStatus = "QUEUED"
	JobRunning  JobStatus = "RUNNING"
	JobDone     JobStatus = "DONE"
	JobFailed   JobStatus = "FAILED"
	JobCanceled JobStatus = "CANCELED"
)

// Job is the runner-facing projection of the API's Job model. Only fields the
// runner needs are decoded; unknown fields are ignored.
//
// RenderedPrintPayload holds the bytes to send to the printer. It is treated
// as SENSITIVE and must never be logged in raw form.
type Job struct {
	ID                   string          `json:"id"`
	RequestID            string          `json:"request_id"`
	Status               JobStatus       `json:"status"`
	PrinterCode          string          `json:"printer_code"`
	PrinterID            string          `json:"printer_id,omitempty"`
	TemplateCode         string          `json:"template_code,omitempty"`
	Copies               int             `json:"copies,omitempty"`
	Payload              json.RawMessage `json:"payload,omitempty"`
	RenderedPrintPayload string          `json:"renderedPrintPayload,omitempty"`
	MimeType             string          `json:"mimeType,omitempty"`
	Priority             string          `json:"priority,omitempty"`
	SourceSystem         string          `json:"source_system,omitempty"`
	TraceID              string          `json:"trace_id,omitempty"`
	CreatedAt            time.Time       `json:"createdAt,omitempty"`
	QueuedAt             *time.Time      `json:"queuedAt,omitempty"`
}

// PrinterInfo carries the printer metadata needed for local execution.
type PrinterInfo struct {
	ID            string `json:"id"`
	Code          string `json:"code"`
	Protocol      string `json:"protocol"`
	ConnectionURI string `json:"connectionUri"`
}

// JobEventRequest is the payload for runner job event reporting. It is sent to
// the new POST /api/v1/runners/:runnerId/jobs/:jobId/events endpoint.
type JobEventRequest struct {
	EventType   string         `json:"event_type"`
	TraceID     string         `json:"trace_id"`
	JobID       string         `json:"job_id"`
	RunnerID    string         `json:"runner_id"`
	Timestamp   time.Time      `json:"timestamp"`
	DurationMs  int64          `json:"duration_ms,omitempty"`
	Status      string         `json:"status,omitempty"`
	SafeMessage string         `json:"safe_message,omitempty"`
	Evidence    map[string]any `json:"evidence,omitempty"`
}

// JobResultRequest is the payload for runner job result reporting. It is sent to
// the new POST /api/v1/runners/:runnerId/jobs/:jobId/result endpoint.
type JobResultRequest struct {
	TraceID     string         `json:"trace_id"`
	JobID       string         `json:"job_id"`
	RunnerID    string         `json:"runner_id"`
	Status      string         `json:"status"`
	Executor    string         `json:"executor"`
	SafeMessage string         `json:"safe_message"`
	DurationMs  int64          `json:"duration_ms"`
	StartedAt   time.Time      `json:"started_at"`
	FinishedAt  time.Time      `json:"finished_at"`
	Evidence    map[string]any `json:"evidence,omitempty"`
}

// NextJobRequest is the body for POST /api/v1/runners/:runnerId/jobs/next.
type NextJobRequest struct {
	RunnerID   string `json:"runner_id"`
	WaitMillis int    `json:"wait_ms,omitempty"`
}

// NextJobResponse is returned by the next-job endpoint. It includes the job
// and the printer metadata needed for local execution.
type NextJobResponse struct {
	Job     *Job         `json:"job"`
	Printer *PrinterInfo `json:"printer,omitempty"`
}
