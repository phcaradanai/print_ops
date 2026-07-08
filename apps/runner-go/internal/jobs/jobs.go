// Package jobs implements the runner job poll loop, execution orchestration,
// trace/timing reporting, and runner state (uptime/last_job_at/last_error)
// shared with the heartbeat loop.
//
// Design goals:
//   - No busy loop: a configurable poll interval with exponential backoff on
//     consecutive API errors up to a bounded ceiling.
//   - Full timing trail: poll_started_at, job_received_at, execution_started_at,
//     execution_finished_at, result_reported_at are captured and reported as
//     runner trace events.
//   - No sensitive data in logs/events: payload bytes are never emitted.
package jobs

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/api"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/telemetry"
)

// Config tunes the poll loop.
type Config struct {
	Interval       time.Duration // base poll interval
	MaxBackoff     time.Duration // ceiling for error backoff (default 10s)
	LongPollWaitMs int           // hint to API for long-poll wait (0=disabled)
}

// DefaultConfig returns sensible MVP defaults.
func DefaultConfig(interval time.Duration) Config {
	return Config{Interval: interval, MaxBackoff: 10 * time.Second, LongPollWaitMs: 0}
}

// Looper runs the poll+execute loop.
type Looper struct {
	Client    *api.Client
	Executor  printer.PrintExecutor
	Metrics   *telemetry.Metrics
	Log       *logging.Logger
	RunnerID  string
	Discovery string // discovery_mode (for events evidence)
	Mode      string // executor_mode label
	Cfg       Config

	// Shared runner state for heartbeat.
	startedAt time.Time
	lastJobAt atomic.Value // time.Time
	lastError atomic.Value // string

	// atomic counters
	completed atomic.Int64
	failed    atomic.Int64

	closeOnce sync.Once
}

// New returns a Looper ready to Run.
func New(client *api.Client, exec printer.PrintExecutor, metrics *telemetry.Metrics, log *logging.Logger, runnerID, discovery, mode string, cfg Config) *Looper {
	l := &Looper{
		Client:    client,
		Executor:  exec,
		Metrics:   metrics,
		Log:       log,
		RunnerID:  runnerID,
		Discovery: discovery,
		Mode:      mode,
		Cfg:       cfg,
		startedAt: time.Now(),
	}
	l.lastJobAt.Store(time.Time{})
	l.lastError.Store("")
	return l
}

// Run blocks until ctx is cancelled.
func (l *Looper) Run(ctx context.Context) {
	interval := l.Cfg.Interval
	if interval <= 0 {
		interval = 750 * time.Millisecond
	}
	backoff := interval

	for {
		select {
		case <-ctx.Done():
			l.Log.Info("jobs loop stopped")
			return
		default:
		}

		handled, err := l.pollOnce(ctx)
		if err != nil {
			l.lastError.Store(err.Error())
			// Exponential backoff on error, capped.
			backoff *= 2
			if backoff > l.Cfg.MaxBackoff {
				backoff = l.Cfg.MaxBackoff
			}
			l.Log.Warn("poll failed; backing off", "error", err.Error(), "backoff_ms", backoff.Milliseconds())
			if !sleepCtx(ctx, backoff) {
				return
			}
			continue
		}

		// Reset backoff on success/no-job.
		backoff = interval
		if !handled {
			// No job available: sleep for the poll interval to avoid busy loop.
			if !sleepCtx(ctx, interval) {
				return
			}
		}
		// When handled, immediately loop to drain the queue fast (no sleep).
	}
}

// pollOnce attempts one poll+execute cycle. Returns handled=true if a job was
// processed (regardless of success/failure), handled=false if no job was found.
func (l *Looper) pollOnce(ctx context.Context) (bool, error) {
	pollStartedAt := time.Now()

	// Bound the poll call.
	pollCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	pollTimer := telemetry.StartTimer()
	job, printerInfo, err := l.Client.NextJob(pollCtx, l.RunnerID, l.Cfg.LongPollWaitMs)
	pollLatency := pollTimer.ElapsedMs()
	l.Metrics.Observe(telemetry.MetricAPIRoundtripMs, pollLatency)
	l.Metrics.Observe(telemetry.MetricJobPickupLatencyMs, pollLatency)

	if err != nil {
		return false, err
	}
	if job == nil {
		return false, nil
	}

	jobReceivedAt := time.Now()
	l.lastJobAt.Store(jobReceivedAt)

	traceID := job.TraceID
	if traceID == "" {
		traceID = job.ID
	}
	log := l.Log.With("job_id", job.ID, "trace_id", traceID)

	// Trace: job received.
	l.reportEvent(ctx, log, job.ID, traceID, "RUNNER_JOB_RECEIVED", pollStartedAt, pollLatency, "received", "job received from queue")

	executionStartedAt := time.Now()
	log.Info("execution starting", "execution_started_at", executionStartedAt)

	// Trace: execution started.
	l.reportEvent(ctx, log, job.ID, traceID, "RUNNER_EXECUTION_STARTED", executionStartedAt, 0, "starting", "executor starting")

	// Build PrintJob with the rendered payload and printer metadata from the
	// NextJob response. This is the critical fix: the API now sends the actual
	// rendered bytes and printer connection info so the runner can execute
	// against the real printer instead of using the fake executor.
	pj := printer.PrintJob{
		JobID:           job.ID,
		TraceID:         traceID,
		PrinterID:       job.PrinterID,
		PrinterCode:     job.PrinterCode,
		MimeType:        job.MimeType,
		Copies:          job.Copies,
		RenderedPayload: []byte(job.RenderedPrintPayload),
		Options:         map[string]string{},
	}

	// Populate printer connection options from the printer info returned by
	// the API. These are used by the multi-executor dispatcher to select the
	// correct executor and by the concrete executors to connect.
	if printerInfo != nil {
		pj.Options["printer_protocol"] = printerInfo.Protocol
		pj.Options["printer_connection_uri"] = printerInfo.ConnectionURI
		pj.Options["windows_printer_name"] = printerInfo.Code

		// Parse rawtcp address:port from connection URI (e.g. tcp://1.2.3.4:9100).
		if printerInfo.ConnectionURI != "" {
			if addr, port, ok := parseTCPAddress(printerInfo.ConnectionURI); ok {
				pj.Options["rawtcp_address"] = addr
				pj.Options["rawtcp_port"] = port
			}
		}
	}

	execCtx, execCancel := context.WithTimeout(ctx, 30*time.Second)
	result, execErr := l.Executor.Execute(execCtx, pj)
	execCancel()

	executionFinishedAt := time.Now()
	execMs := executionFinishedAt.Sub(executionStartedAt).Milliseconds()
	l.Metrics.Observe(telemetry.MetricRunnerExecMs, execMs)

	if execErr != nil {
		l.failed.Add(1)
		l.lastError.Store(execErr.Error())
		l.reportEvent(ctx, log, job.ID, traceID, "RUNNER_EXECUTION_FAILED", executionFinishedAt, execMs, "failed", safeErr(execErr))
		l.reportResult(ctx, log, job.ID, traceID, "FAILED", execMs, executionStartedAt, executionFinishedAt, execErr)
		return true, nil
	}
	if result != nil && result.Status == printer.StatusFailed {
		l.failed.Add(1)
		if result.Err != nil {
			l.lastError.Store(result.Err.Error())
		}
		l.reportEvent(ctx, log, job.ID, traceID, "RUNNER_EXECUTION_FAILED", executionFinishedAt, result.DurationMs, "failed", result.SafeMessage)
		l.reportResult(ctx, log, job.ID, traceID, "FAILED", result.DurationMs, result.StartedAt, result.FinishedAt, result.Err)
		return true, nil
	}

	// Spooler sent + printer ack (fake equivalents for MVP).
	l.reportEvent(ctx, log, job.ID, traceID, spoolerEventName(l.Mode), executionFinishedAt, execMs/2, "sent", "payload handed to spooler")
	l.reportEvent(ctx, log, job.ID, traceID, ackEventName(l.Mode), executionFinishedAt, execMs/2, "acked", "printer acknowledged")

	l.completed.Add(1)
	l.reportEvent(ctx, log, job.ID, traceID, "RUNNER_EXECUTION_SUCCEEDED", executionFinishedAt, execMs, "succeeded", "execution completed")

	// Report result (terminal).
	if result != nil {
		l.reportResult(ctx, log, job.ID, traceID, "SUCCESS", result.DurationMs, result.StartedAt, result.FinishedAt, nil)
	} else {
		l.reportResult(ctx, log, job.ID, traceID, "SUCCESS", execMs, executionStartedAt, executionFinishedAt, nil)
	}

	// Best-effort: also call legacy execute endpoint for backward compatibility.
	if err := l.Client.ReportExecution(ctx, job.ID, l.RunnerID); err != nil {
		log.Debug("legacy execute report skipped", "error", err.Error())
	}

	return true, nil
}

func (l *Looper) reportEvent(ctx context.Context, log *logging.Logger, jobID, traceID, eventType string, ts time.Time, durMs int64, status, msg string) {
	req := api.JobEventRequest{
		EventType:   eventType,
		TraceID:     traceID,
		JobID:       jobID,
		RunnerID:    l.RunnerID,
		Timestamp:   ts,
		DurationMs:  durMs,
		Status:      status,
		SafeMessage: msg,
		Evidence: map[string]any{
			"discovery_mode": l.Discovery,
			"executor_mode":  l.Mode,
			"runner_id":      l.RunnerID,
		},
	}
	t := telemetry.StartTimer()
	err := l.Client.ReportEvent(ctx, l.RunnerID, req)
	reportMs := t.ElapsedMs()
	l.Metrics.Observe(telemetry.MetricResultReportMs, reportMs)
	if err != nil {
		log.Warn("event report failed", "event", eventType, "error", err.Error())
	} else {
		log.Debug("event reported", "event", eventType, "report_ms", reportMs)
	}
}

func (l *Looper) reportResult(ctx context.Context, log *logging.Logger, jobID, traceID, status string, durMs int64, startedAt, finishedAt time.Time, execErr error) {
	req := api.JobResultRequest{
		TraceID:     traceID,
		JobID:       jobID,
		RunnerID:    l.RunnerID,
		Status:      status,
		Executor:    l.Mode,
		SafeMessage: statusMessage(status, execErr),
		DurationMs:  durMs,
		StartedAt:   startedAt,
		FinishedAt:  finishedAt,
		Evidence: map[string]any{
			"discovery_mode": l.Discovery,
			"executor_mode":  l.Mode,
		},
	}
	t := telemetry.StartTimer()
	err := l.Client.ReportResult(ctx, l.RunnerID, req)
	reportMs := t.ElapsedMs()
	l.Metrics.Observe(telemetry.MetricResultReportMs, reportMs)
	if err != nil {
		log.Warn("result report failed", "error", err.Error())
	} else {
		log.Info("result reported", "status", status, "report_ms", reportMs)
	}
}

// State implementation for heartbeat.StateProvider.

// Uptime returns elapsed time since the looper started.
func (l *Looper) Uptime() time.Duration { return time.Since(l.startedAt) }

// LastJobAt returns the last time a job was received (zero if none).
func (l *Looper) LastJobAt() time.Time {
	v := l.lastJobAt.Load()
	t, _ := v.(time.Time)
	return t
}

// LastError returns the last error message (empty if none).
func (l *Looper) LastError() string {
	v := l.lastError.Load()
	s, _ := v.(string)
	return s
}

// Counters for diagnostics.
func (l *Looper) Completed() int64 { return l.completed.Load() }
func (l *Looper) Failed() int64    { return l.failed.Load() }

func sleepCtx(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func spoolerEventName(mode string) string {
	if mode == "fake" {
		return "FAKE_SPOOLER_SENT"
	}
	return "RUNNER_SPOOLER_SENT"
}

func ackEventName(mode string) string {
	if mode == "fake" {
		return "FAKE_PRINTER_ACK"
	}
	return "RUNNER_PRINTER_ACK"
}

func safeErr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func statusMessage(status string, err error) string {
	if status == "SUCCESS" {
		return "execution completed"
	}
	if err != nil {
		return err.Error()
	}
	return "execution failed"
}

// ErrNoJob is returned by PollJob helpers when no job is available. Kept for
// tests/external callers; the loop treats nil job as "no job" instead.
var ErrNoJob = errors.New("no job available")
