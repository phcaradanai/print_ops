// Package winpool implements a PrintExecutor that sends raw bytes to a Windows
// printer via the spooler API. It uses PowerShell + .NET RawPrinterHelper to
// bypass the print driver and send the payload directly (needed for ZPL/TSPL
// label printers that don't understand GDI/Page Description Language).
//
// SUCCESS is reported only when a device-level channel proved a page came out.
// The executor watches the device's own page counter over SNMP, because the
// spooler reports a job done once it has handed the bytes to the driver — on a
// real EPSON that is roughly 15 seconds before the page appears. The spooler may
// DISPROVE a print but may never PROVE one: when no device channel answers, the
// job is reported as unverified (PRINT_NOT_VERIFIABLE) with the reason the
// device could not be asked, never as success.
//
// STATUS: production for Windows label printers. No-op on non-Windows.
package winpool

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/snmp"
)

// errCodeNotVerifiable marks a job that was handed to the spooler without any
// device channel able to confirm a page came out. It matches the errorCode the
// TypeScript WindowsSpoolerAdapter returns for the same situation.
const errCodeNotVerifiable = "PRINT_NOT_VERIFIABLE"

// Executor sends raw payload bytes to a Windows printer share via the spooler.
type Executor struct {
	PrinterName    string
	CommandTimeout time.Duration
	// VerifyJobAcceptance, when true, queries the print queue after sending
	// to confirm the job was accepted (not silently dropped). Default true.
	VerifyJobAcceptance bool
	// QueuePollInterval controls how often we re-check the queue while waiting
	// for the job to be accepted. Default 200ms.
	QueuePollInterval time.Duration
	// QueueAcceptTimeout is the max time to wait for job acceptance confirmation.
	// Default 10s.
	QueueAcceptTimeout time.Duration

	// SNMPEnabled turns device-level confirmation on. Default true. Disabling
	// it leaves the executor with spooler-acceptance semantics only.
	SNMPEnabled bool
	// SNMPCommunity is the SNMPv1 read community. Default "public".
	SNMPCommunity string
	// DeviceVerifyTimeout is the max time to wait for the device page counter
	// to advance after the spooler accepted the job. Default 90s.
	DeviceVerifyTimeout time.Duration
	// DevicePollInterval controls how often the page counter is re-read.
	// Default 1s.
	DevicePollInterval time.Duration

	// snmpHosts caches printer name -> SNMP address resolutions.
	snmpHosts *snmpHostResolver
	// readDeviceStateFn overrides the SNMP reader for tests; nil = production
	// (snmp.ReadDeviceState). This is the only seam that lets the not-confirmed
	// and unverifiable branches of waitForDeviceConfirmation be exercised
	// without a live printer, which is why HIGH-2 went unnoticed before.
	readDeviceStateFn readDeviceStateFn
	// printerLocks serialises send+verify per printer. prtMarkerLifeCount is a
	// device-global counter, so two jobs on one printer race on it — job A's
	// verify can see the +1 job B produced and report SUCCESS for a page that
	// was never A's (MEDIUM-5). Locking makes the counter delta attributable
	// to a single job. This covers this executor only (one host); a second
	// host sharing the printer is documented as residual risk.
	printerLockMu sync.Mutex
	printerLocks  map[string]*sync.Mutex
}

// New returns a Windows spooler executor with queue and device verification
// enabled.
func New() *Executor {
	return &Executor{
		CommandTimeout:      30 * time.Second,
		VerifyJobAcceptance: true,
		QueuePollInterval:   200 * time.Millisecond,
		QueueAcceptTimeout:  10 * time.Second,
		SNMPEnabled:         true,
		SNMPCommunity:       defaultSNMPCommunity,
		DeviceVerifyTimeout: defaultDeviceVerifyTimeout,
		DevicePollInterval:  defaultDevicePollInterval,
		snmpHosts:           newSNMPHostResolver(),
	}
}

// Name implements PrintExecutor.
func (e *Executor) Name() string { return "windows-spooler" }

// Execute sends the raw payload to the printer via PowerShell, then verifies
// that the job was actually accepted by the spooler queue.
func (e *Executor) Execute(ctx context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	start := time.Now()

	if runtime.GOOS != "windows" {
		return e.fail(start, job, "windows-spooler executor requires Windows", fmt.Errorf("not windows: %s", runtime.GOOS)), nil
	}

	printerName := e.resolvePrinterName(job)
	if printerName == "" {
		return e.fail(start, job, "no printer name resolved (set windows_printer_name or printer_code)", fmt.Errorf("missing printer name")), nil
	}

	if len(job.RenderedPayload) == 0 {
		return e.fail(start, job, "empty payload", fmt.Errorf("payload is empty")), nil
	}

	// Serialise send+verify per printer so the device-global page counter delta
	// is attributable to this job alone (MEDIUM-5). Cheap pre-flight checks
	// above stay outside the lock; everything that touches the spooler or the
	// counter is inside it.
	unlock := e.lockPrinter(printerName)
	defer unlock()

	// ── Pre-flight: check printer is online and not in error ─────────
	preflightStatus, preflightErr := e.checkPrinterStatus(printerName)
	if preflightErr != nil {
		// Non-fatal: log but continue (some printers don't support status query)
		preflightStatus = "unknown"
	}
	if preflightStatus == "offline" || preflightStatus == "error" || preflightStatus == "paperJam" || preflightStatus == "paperOut" {
		return &printer.PrintResult{
			Status:      printer.StatusFailed,
			Executor:    e.Name(),
			SafeMessage: fmt.Sprintf("printer %q is %s — cannot accept job", printerName, preflightStatus),
			DurationMs:  time.Since(start).Milliseconds(),
			StartedAt:   start,
			FinishedAt:  time.Now(),
			Evidence: map[string]any{
				"printer_name":     printerName,
				"preflight_status": preflightStatus,
				"preflight_error":  errString(preflightErr),
			},
			Err: fmt.Errorf("printer %s: %s", printerName, preflightStatus),
		}, nil
	}

	// ── Device pre-flight over SNMP ──────────────────────────────────
	// The baseline page count MUST be captured here, before anything is sent:
	// a baseline read after printing started under-counts and would produce a
	// false "counter did not advance". A printer that does not answer, or does
	// not expose the counter, simply leaves deviceBefore nil and the job keeps
	// today's spooler-acceptance semantics.
	target := e.resolveSNMPTarget(ctx, job, printerName)
	var deviceBefore *snmp.DeviceState
	if target != nil {
		deviceBefore = e.readDeviceState(*target)
		if deviceBefore != nil && deviceBefore.Blocked {
			return &printer.PrintResult{
				Status:      printer.StatusFailed,
				Executor:    e.Name(),
				SafeMessage: fmt.Sprintf("printer %q reports %s — not sending job", printerName, strings.Join(deviceBefore.Errors, ", ")),
				DurationMs:  time.Since(start).Milliseconds(),
				StartedAt:   start,
				FinishedAt:  time.Now(),
				Evidence: map[string]any{
					"printer_name":     printerName,
					"preflight_status": preflightStatus,
					"snmp_host":        target.Host,
					"device_errors":    deviceBefore.Errors,
					"device_confirmed": false,
				},
				Err: fmt.Errorf("printer %s device error: %s", printerName, strings.Join(deviceBefore.Errors, ", ")),
			}, nil
		}
	}

	// ── Send payload to spooler ──────────────────────────────────────
	// Snapshot the queue ids now so verifyJobAccepted can tell our job apart
	// from jobs that were already queued (MEDIUM-8): without this, a stranger's
	// job stuck Paused makes every new job look blocked.
	beforeIds := e.getQueueJobIds(printerName)

	cmdCtx, cancel := context.WithTimeout(ctx, e.CommandTimeout)
	defer cancel()

	script := buildRawPrintScript(printerName, job.RenderedPayload)
	cmd := exec.CommandContext(cmdCtx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	output, err := cmd.CombinedOutput()
	finished := time.Now()

	if err != nil {
		return &printer.PrintResult{
			Status:      printer.StatusFailed,
			Executor:    e.Name(),
			SafeMessage: fmt.Sprintf("spooler error: %v (output: %s)", err, truncate(string(output), 200)),
			DurationMs:  finished.Sub(start).Milliseconds(),
			StartedAt:   start,
			FinishedAt:  finished,
			Evidence: map[string]any{
				"printer_name":     printerName,
				"payload_size":     len(job.RenderedPayload),
				"copies":           job.Copies,
				"powershell_ok":    false,
				"preflight_status": preflightStatus,
			},
			Err: err,
		}, nil
	}

	// ── Verify job acceptance ────────────────────────────────────────
	evidence := map[string]any{
		"printer_name":     printerName,
		"payload_size":     len(job.RenderedPayload),
		"copies":           job.Copies,
		"powershell_ok":    true,
		"preflight_status": preflightStatus,
		"device_confirmed": false,
	}
	if target != nil {
		evidence["snmp_host"] = target.Host
	}
	if deviceBefore != nil {
		if deviceBefore.PageCount != nil {
			evidence["pages_before"] = *deviceBefore.PageCount
		}
		if len(deviceBefore.Errors) > 0 {
			evidence["device_errors"] = deviceBefore.Errors
		}
	}

	if e.VerifyJobAcceptance {
		accepted, queueInfo := e.verifyJobAccepted(printerName, beforeIds)
		evidence["queue_verified"] = accepted
		evidence["queue_info"] = queueInfo

		if !accepted {
			return &printer.PrintResult{
				Status:      printer.StatusFailed,
				Executor:    e.Name(),
				SafeMessage: fmt.Sprintf("job sent to spooler but not confirmed in queue (printer may have rejected or silently dropped): %s", queueInfo["note"]),
				DurationMs:  time.Since(start).Milliseconds(),
				StartedAt:   start,
				FinishedAt:  time.Now(),
				Evidence:    evidence,
				Err:         fmt.Errorf("job not confirmed in print queue"),
			}, nil
		}
	}

	// ── Device confirmation: did paper actually come out? ────────────
	// A live pre-send baseline is the only thing that can prove a page exists.
	// Without one (SNMP disabled, no host resolved, no answer, or a printer
	// that does not expose prtMarkerLifeCount) nothing here knows whether paper
	// came out, so the job is reported unverified rather than successful.
	// A device reading that already confirmed the print is never demoted.
	if target != nil && deviceBefore != nil && deviceBefore.PageCount != nil {
		copies := max(1, job.Copies)
		confirmation := e.waitForDeviceConfirmation(ctx, *target, *deviceBefore.PageCount, copies)
		evidence["pages_after"] = confirmation.PagesAfter
		evidence["device_confirmed"] = confirmation.Confirmed
		if len(confirmation.Errors) > 0 {
			evidence["device_errors"] = confirmation.Errors
		}

		switch {
		case confirmation.Confirmed:
			return &printer.PrintResult{
				Status:      printer.StatusSuccess,
				Executor:    e.Name(),
				SafeMessage: fmt.Sprintf("sent %d bytes to %s via spooler — %s", len(job.RenderedPayload), printerName, confirmation.Detail),
				DurationMs:  time.Since(start).Milliseconds(),
				StartedAt:   start,
				FinishedAt:  time.Now(),
				Evidence:    evidence,
			}, nil
		case confirmation.Inconclusive:
			// The wait ended without a device verdict. No verdict is not proof
			// of printing, and the spooler cannot stand in for the device
			// reading that is missing — report it unverified, with the detail
			// that says verification was interrupted rather than refused.
			evidence["device_verify_note"] = confirmation.Detail
			evidence["error_code"] = errCodeNotVerifiable
			return &printer.PrintResult{
				Status:      printer.StatusUnverified,
				Executor:    e.Name(),
				SafeMessage: fmt.Sprintf("sent %d bytes to %s via spooler, but the print is unverified: %s", len(job.RenderedPayload), printerName, confirmation.Detail),
				DurationMs:  time.Since(start).Milliseconds(),
				StartedAt:   start,
				FinishedAt:  time.Now(),
				Evidence:    evidence,
				Err:         fmt.Errorf("%s: %s", errCodeNotVerifiable, confirmation.Detail),
			}, nil
		case confirmation.Outcome == outcomeUnverifiable:
			// No device read succeeded during the whole verify window: the
			// device went quiet after the baseline. Nothing here disproves the
			// print either, so this is "we don't know" — UNVERIFIED, never
			// FAILED (a retry would risk a duplicate page for a print that may
			// already have happened). Mirrors the TypeScript "unverifiable"
			// outcome in waitForDeviceConfirmation.
			evidence["device_verify_note"] = confirmation.Detail
			evidence["error_code"] = errCodeNotVerifiable
			return &printer.PrintResult{
				Status:      printer.StatusUnverified,
				Executor:    e.Name(),
				SafeMessage: fmt.Sprintf("sent %d bytes to %s via spooler, but the print is unverified: %s", len(job.RenderedPayload), printerName, confirmation.Detail),
				DurationMs:  time.Since(start).Milliseconds(),
				StartedAt:   start,
				FinishedAt:  time.Now(),
				Evidence:    evidence,
				Err:         fmt.Errorf("%s: %s", errCodeNotVerifiable, confirmation.Detail),
			}, nil
		default:
			// not-confirmed: the counter WAS read and did not advance — a real
			// negative, so a retry is safe. FAILED (not UNVERIFIED) is correct.
			evidence["error_code"] = "PRINT_NOT_CONFIRMED_BY_DEVICE"
			return &printer.PrintResult{
				Status:      printer.StatusFailed,
				Executor:    e.Name(),
				SafeMessage: fmt.Sprintf("spooler accepted the job but the device did not confirm printing on %s: %s", printerName, confirmation.Detail),
				DurationMs:  time.Since(start).Milliseconds(),
				StartedAt:   start,
				FinishedAt:  time.Now(),
				Evidence:    evidence,
				Err:         fmt.Errorf("print not confirmed by device: %s", confirmation.Detail),
			}, nil
		}
	}

	// No device channel answered, so nothing here knows whether a page exists.
	// Reporting success on the spooler's word is exactly how a job was marked
	// SUCCESS while the printer sat in Error and no paper came out.
	gap := describeVerificationGap(printerName, target, deviceBefore)
	evidence["error_code"] = errCodeNotVerifiable
	return &printer.PrintResult{
		Status:      printer.StatusUnverified,
		Executor:    e.Name(),
		SafeMessage: fmt.Sprintf("sent %d bytes to %s via spooler, but the printer could not confirm it. %s", len(job.RenderedPayload), printerName, gap),
		DurationMs:  time.Since(start).Milliseconds(),
		StartedAt:   start,
		FinishedAt:  time.Now(),
		Evidence:    evidence,
		Err:         fmt.Errorf("%s: %s", errCodeNotVerifiable, gap),
	}, nil
}

// describeVerificationGap explains why the device could not be asked, and what
// would make it answerable. Without this the operator sees "not confirmed" and
// has no way to tell a broken printer from a printer we simply cannot reach.
//
// Mirrors describeVerificationGap in
// packages/adapters/src/windows/windows-spooler.adapter.ts.
func describeVerificationGap(printerName string, target *snmpTarget, deviceBefore *snmp.DeviceState) string {
	if target == nil {
		return fmt.Sprintf("No SNMP address could be derived for %q — its Windows port exposes none. "+
			"Install the vendor driver on a Standard TCP/IP port, or set the job's snmp_host option.", printerName)
	}
	if deviceBefore == nil {
		return fmt.Sprintf("The device at %s did not answer SNMP on port 161. "+
			"Check that the printer is powered on and on this network, and that SNMP is enabled on it.", target.Host)
	}
	return fmt.Sprintf("The device at %s answered SNMP but exposes no page counter (prtMarkerLifeCount). "+
		"Install the vendor driver for this model, or point snmp_host at an interface that reports it.", target.Host)
}

// checkPrinterStatus queries the Windows printer status via Get-Printer.
// Returns one of: "idle", "printing", "offline", "error", "paperJam",
// "paperOut", "unknown".
func (e *Executor) checkPrinterStatus(printerName string) (string, error) {
	script := fmt.Sprintf(`$ErrorActionPreference='SilentlyContinue'
$p = Get-Printer -Name '%s' | Select-Object -First 1
if ($null -eq $p) { '{"status":"unknown","note":"printer not found"}' ; exit }
$state = $p.PrinterStatus
$jobs = @(Get-PrintJob -PrinterName '%s').Count
[ordered]@{ "status"=$state; "jobCount"=$jobs } | ConvertTo-Json -Compress`,
		escapeForPS(printerName), escapeForPS(printerName))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return "unknown", err
	}

	var info struct {
		Status   string `json:"status"`
		JobCount int    `json:"jobCount"`
	}
	if jErr := json.Unmarshal(out, &info); jErr != nil {
		return "unknown", jErr
	}

	// Normalize Windows printer status strings.
	s := strings.ToLower(strings.TrimSpace(info.Status))
	switch {
	case strings.Contains(s, "idle"):
		return "idle", nil
	case strings.Contains(s, "printing"):
		return "printing", nil
	case strings.Contains(s, "offline"):
		return "offline", nil
	case strings.Contains(s, "error"):
		return "error", nil
	case strings.Contains(s, "paper") && strings.Contains(s, "jam"):
		return "paperJam", nil
	case strings.Contains(s, "paper") && (strings.Contains(s, "out") || strings.Contains(s, "empty")):
		return "paperOut", nil
	case strings.Contains(s, "normal"), s == "":
		return "idle", nil
	default:
		return s, nil
	}
}

// getQueueJobIds returns the set of spooler job ids currently queued for the
// printer. Used to snapshot the queue before sending so verifyJobAccepted can
// tell our job apart from jobs that were already there (MEDIUM-8): a stranger's
// job stuck Paused since last week must not make every new job fail.
func (e *Executor) getQueueJobIds(printerName string) map[string]struct{} {
	ids := make(map[string]struct{})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	script := fmt.Sprintf(`$ErrorActionPreference='SilentlyContinue'
$jobs = @(Get-PrintJob -PrinterName '%s')
$jobs | Select-Object -ExpandProperty Id -ErrorAction SilentlyContinue | ConvertTo-Json -Compress`, escapeForPS(printerName))
	out, err := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return ids
	}
	raw := strings.TrimSpace(string(out))
	if raw == "" {
		return ids
	}
	// Id may come back as a single number or a JSON array of numbers.
	var asNum int64
	if json.Unmarshal([]byte(raw), &asNum) == nil {
		ids[strconv.FormatInt(asNum, 10)] = struct{}{}
		return ids
	}
	var asArr []int64
	if json.Unmarshal([]byte(raw), &asArr) == nil {
		for _, n := range asArr {
			ids[strconv.FormatInt(n, 10)] = struct{}{}
		}
	}
	return ids
}

// verifyJobAccepted polls the print queue to confirm the job was accepted.
// Returns (true, info) when a NEW job (one not in beforeIds) appears carrying
// no blocking flag, or when the queue has drained past beforeIds without error
// (indicating acceptance).
//
// Only jobs absent from beforeIds are considered. Counting every queue entry
// the way this used to fails whenever an unrelated job is already stuck: a
// queue that never clears reads as permanently blocked (MEDIUM-8). Mirrors the
// beforeIds set-difference the TypeScript adapter does in waitForSpooler.
//
// JobStatus is a flags enum, so classification goes through isBlockedStatus
// rather than a string compare — see jobflags.go. Acceptance is never proof of
// printing; it only means the spooler has not disproved it yet.
func (e *Executor) verifyJobAccepted(printerName string, beforeIds map[string]struct{}) (bool, map[string]any) {
	deadline := time.Now().Add(e.QueueAcceptTimeout)
	interval := e.QueuePollInterval
	if interval <= 0 {
		interval = 200 * time.Millisecond
	}

	script := fmt.Sprintf(`$ErrorActionPreference='SilentlyContinue'
$jobs = @(Get-PrintJob -PrinterName '%s')
[ordered]@{
  "jobs"=$jobs | Select-Object Id,@{Name='JobStatus';Expression={[string]$_.JobStatus}} | ConvertTo-Json -Compress
} | ConvertTo-Json -Compress`, escapeForPS(printerName))

	attempts := 0
	lastInfo := map[string]any{}
	for time.Now().Before(deadline) {
		attempts++
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
		out, err := cmd.Output()
		cancel()
		if err != nil {
			lastInfo = map[string]any{"note": "query failed", "error": err.Error(), "attempts": attempts}
			time.Sleep(interval)
			continue
		}

		var info struct {
			Jobs json.RawMessage `json:"jobs"`
		}
		if jErr := json.Unmarshal(out, &info); jErr != nil {
			lastInfo = map[string]any{"note": "parse failed", "attempts": attempts}
			time.Sleep(interval)
			continue
		}

		queueJobs := parseQueueJobs(info.Jobs)
		// Only jobs we did NOT see before sending are ours to judge.
		ours := make([]queueJob, 0, len(queueJobs))
		for _, qj := range queueJobs {
			if _, was := beforeIds[qj.ID]; !was {
				ours = append(ours, qj)
			}
		}
		statuses := uniqueStatuses(ours)

		lastInfo = map[string]any{
			"queue_total": len(queueJobs),
			"queue_ours":  len(ours),
			"statuses":    strings.Join(statuses, ","),
			"attempts":    attempts,
		}

		// Our job appeared. Being visible is only acceptance while the spooler
		// raises no fault on OUR jobs — a stranger's stuck job no longer counts.
		if len(ours) > 0 {
			if isBlockedStatus(strings.Join(statuses, ",")) {
				lastInfo["note"] = fmt.Sprintf("our job blocked in print queue (status: %s)", strings.Join(statuses, ","))
				return false, lastInfo
			}
			lastInfo["note"] = "our job visible in print queue"
			return true, lastInfo
		}

		// Our job is not in the queue. If it was before but drained without a
		// blocking status, it was accepted (and likely printed instantly for a
		// fast laser printer). Two+ attempts guards against a query that raced
		// the spooler registering the job.
		if len(ours) == 0 && attempts >= 2 && !hasBlockingInQueue(queueJobs) {
			lastInfo["note"] = "our job left the queue — likely printed immediately"
			return true, lastInfo
		}

		time.Sleep(interval)
	}

	lastInfo["note"] = fmt.Sprintf("no confirmation after %d attempts (%.1fs)", attempts, e.QueueAcceptTimeout.Seconds())
	return false, lastInfo
}

// queueJob is a single spooler entry for the filtered-queue check.
type queueJob struct {
	ID     string
	Status string
}

func parseQueueJobs(raw json.RawMessage) []queueJob {
	if len(raw) == 0 {
		return nil
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil
	}
	// Single object vs array: normalize to array.
	one := struct {
		ID        json.Number `json:"Id"`
		JobStatus string      `json:"JobStatus"`
	}{}
	if json.Unmarshal(raw, &one) == nil && one.ID != "" {
		return []queueJob{{ID: string(one.ID), Status: one.JobStatus}}
	}
	var arr []struct {
		ID        json.Number `json:"Id"`
		JobStatus string      `json:"JobStatus"`
	}
	if json.Unmarshal(raw, &arr) != nil {
		return nil
	}
	out := make([]queueJob, 0, len(arr))
	for _, j := range arr {
		out = append(out, queueJob{ID: string(j.ID), Status: j.JobStatus})
	}
	return out
}

func uniqueStatuses(jobs []queueJob) []string {
	seen := make(map[string]struct{})
	var out []string
	for _, j := range jobs {
		s := strings.TrimSpace(j.Status)
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func hasBlockingInQueue(jobs []queueJob) bool {
	statuses := uniqueStatuses(jobs)
	return isBlockedStatus(strings.Join(statuses, ","))
}

// resolvePrinterName picks the Windows printer name from executor config,
// then job options, then falls back to the printer code.
func (e *Executor) resolvePrinterName(job printer.PrintJob) string {
	if e.PrinterName != "" {
		return e.PrinterName
	}
	if v := job.Options["windows_printer_name"]; v != "" {
		return v
	}
	if job.PrinterCode != "" {
		return job.PrinterCode
	}
	return ""
}

// lockPrinter returns an unlock function for the per-printer mutex, lazily
// creating it on first use. Holding a dedicated mutex per printer means a job
// on printer B never waits on a job on printer A. See the MEDIUM-5 note on
// printerLocks for why this serialisation exists.
func (e *Executor) lockPrinter(printerName string) func() {
	e.printerLockMu.Lock()
	mu, ok := e.printerLocks[printerName]
	if !ok {
		mu = &sync.Mutex{}
		if e.printerLocks == nil {
			e.printerLocks = make(map[string]*sync.Mutex)
		}
		e.printerLocks[printerName] = mu
	}
	e.printerLockMu.Unlock()
	mu.Lock()
	return mu.Unlock
}

func (e *Executor) fail(start time.Time, job printer.PrintJob, msg string, err error) *printer.PrintResult {
	finished := time.Now()
	return &printer.PrintResult{
		Status:      printer.StatusFailed,
		Executor:    e.Name(),
		SafeMessage: msg,
		DurationMs:  finished.Sub(start).Milliseconds(),
		StartedAt:   start,
		FinishedAt:  finished,
		Evidence: map[string]any{
			"payload_size": len(job.RenderedPayload),
		},
		Err: err,
	}
}

// buildRawPrintScript generates a PowerShell script that sends raw bytes to a
// Windows printer using the RawPrinterHelper class (P/Invoke winspool.drv).
func buildRawPrintScript(printerName string, payload []byte) string {
	b64 := base64Encode(payload)
	return fmt.Sprintf(`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static bool SendBytesToPrinter(string szPrinterName, IntPtr pBytes, Int32 dwCount) {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "PrintOps Runner Job";
    di.pDataType = "RAW";
    bool bSuccess = false;
    if (OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero)) {
      if (StartDocPrinter(hPrinter, 1, di)) {
        if (StartPagePrinter(hPrinter)) {
          Int32 dwWritten;
          bSuccess = WritePrinter(hPrinter, pBytes, dwCount, out dwWritten);
          EndPagePrinter(hPrinter);
        }
        EndDocPrinter(hPrinter);
      }
      ClosePrinter(hPrinter);
    }
    return bSuccess;
  }
  public static bool SendStringToPrinter(string szPrinterName, string s) {
    IntPtr pBytes = Marshal.StringToCoTaskMemAnsi(s);
    Int32 dwCount = s.Length;
    bool ok = SendBytesToPrinter(szPrinterName, pBytes, dwCount);
    Marshal.FreeCoTaskMem(pBytes);
    return ok;
  }
}
'@
$bytes = [System.Convert]::FromBase64String('%s')
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
  $ok = [RawPrinterHelper]::SendBytesToPrinter('%s', $ptr, $bytes.Length)
  if (-not $ok) { throw "WritePrinter returned false" }
} finally {
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
}
`, b64, escapePrinterName(printerName))
}

func escapeForPS(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func base64Encode(data []byte) string {
	const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	var sb strings.Builder
	sb.Grow(((len(data) + 2) / 3) * 4)
	for i := 0; i < len(data); i += 3 {
		var n uint32
		var count int
		for j := 0; j < 3 && i+j < len(data); j++ {
			n |= uint32(data[i+j]) << (16 - uint(j*8))
			count++
		}
		sb.WriteByte(table[(n>>18)&0x3F])
		sb.WriteByte(table[(n>>12)&0x3F])
		if count > 1 {
			sb.WriteByte(table[(n>>6)&0x3F])
		} else {
			sb.WriteByte('=')
		}
		if count > 2 {
			sb.WriteByte(table[n&0x3F])
		} else {
			sb.WriteByte('=')
		}
	}
	return sb.String()
}

func escapePrinterName(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
