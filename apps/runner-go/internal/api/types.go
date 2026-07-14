// Package api also defines the API-facing DTOs used by the runner. These
// intentionally mirror the existing Fastify/TypeScript domain models so the Go
// runner is wire-compatible without changing the API.
package api

import (
	"encoding/json"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
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

// DiscoverySyncItem is the API-facing DTO for a single discovered printer in a
// discovery sync payload. It directly mirrors the TypeScript DiscoveryItem
// contract so the API can store printer metadata without any field mismatch.
// This is intentionally separate from the internal discovery.DiscoveredPrinter
// model so the internal model can carry extra fields (URI, Status, ShareName,
// etc.) without leaking them to the API and without changing the API contract.
type DiscoverySyncItem struct {
	LocalPrinterName string         `json:"localPrinterName"`
	DriverName       string         `json:"driverName,omitempty"`
	PortName         string         `json:"portName,omitempty"`
	ConnectionType   string         `json:"connectionType"`
	IsDefault        bool           `json:"isDefault"`
	IsShared         bool           `json:"isShared"`
	Attributes       map[string]any `json:"attributes,omitempty"`
	ComputerName     string         `json:"computerName,omitempty"`
	OsName           string         `json:"osName,omitempty"`
}

// ToDiscoverySyncItem maps an internal DiscoveredPrinter to the API-facing
// DiscoverySyncItem DTO. The internal model stays clean; this function is the
// single translation point.
//
//   - localPrinterName comes from dp.Name (the discovered printer name).
//   - driver, port, connectionType, isDefault, isShared map 1:1.
//   - attributes collects dp.Raw plus any useful metadata.
//   - computerName / osName come from the runner's own host and OS.
func ToDiscoverySyncItem(dp discovery.DiscoveredPrinter, computerName, osName string) DiscoverySyncItem {
	attrs := make(map[string]any, len(dp.Raw)+2)
	for k, v := range dp.Raw {
		attrs[k] = v
	}
	// Surfacing status is useful for dashboard display.
	if dp.Status != "" {
		attrs["status"] = dp.Status
	}
	// Location and comment provide operator context.
	if dp.Location != "" {
		attrs["location"] = dp.Location
	}
	if dp.Comment != "" {
		attrs["comment"] = dp.Comment
	}

	return DiscoverySyncItem{
		LocalPrinterName: dp.Name,
		DriverName:       dp.DriverName,
		PortName:         dp.PortName,
		ConnectionType:   string(dp.ConnectionType),
		IsDefault:        dp.IsDefault,
		IsShared:         dp.IsShared,
		Attributes:       attrs,
		ComputerName:     computerName,
		OsName:           osName,
	}
}

// ToDiscoverySyncItems maps a slice of discovered printers. See
// ToDiscoverySyncItem for field mapping details.
func ToDiscoverySyncItems(printers []discovery.DiscoveredPrinter, computerName, osName string) []DiscoverySyncItem {
	if len(printers) == 0 {
		return []DiscoverySyncItem{}
	}
	items := make([]DiscoverySyncItem, len(printers))
	for i, dp := range printers {
		items[i] = ToDiscoverySyncItem(dp, computerName, osName)
	}
	return items
}
