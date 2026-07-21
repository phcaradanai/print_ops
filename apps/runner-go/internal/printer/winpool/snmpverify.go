package winpool

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/snmp"
)

// Defaults for device-level confirmation. The page counter on a real EPSON
// moves roughly 15 seconds after the spooler already reports the job done, so
// the verify window is deliberately generous.
const (
	defaultSNMPCommunity       = snmp.DefaultCommunity
	defaultDeviceVerifyTimeout = 90 * time.Second
	defaultDevicePollInterval  = time.Second
)

// snmpTarget is a resolved SNMP endpoint for a printer.
type snmpTarget struct {
	Host      string
	Community string
}

// deviceConfirmation is the outcome of waiting for the device page counter.
type deviceConfirmation struct {
	// Outcome is the kind of verdict the wait reached. "confirmed" = the
	// counter advanced; "not-confirmed" = the counter was read but stayed put
	// (a real negative, retry is safe); "unverifiable" = no read ever succeeded
	// so nothing here knows whether a page came out (retry risks a duplicate).
	// Keeping the two non-confirmed outcomes apart is what stops a network blip
	// mid-verify from filing a printed page as retryable-FAILED.
	Outcome outcome
	// Confirmed is true when the counter advanced by the expected page count.
	Confirmed bool
	// Unverifiable is true when no device read succeeded during the wait.
	Unverifiable bool
	// PagesAfter is the last counter value read.
	PagesAfter int64
	// Errors holds the device error names raised while waiting.
	Errors []string
	// Detail is a short, non-sensitive explanation for SafeMessage.
	Detail string
	// Inconclusive is true when the wait ended without a device verdict
	// (the caller's context was cancelled). No verdict is not proof of
	// printing, so the job is reported unverified — but Detail says the
	// verification was interrupted rather than that the device refused.
	// The never-demote rule applies only to a print a device reading already
	// CONFIRMED; a wait that never reached the counter confirmed nothing.
	Inconclusive bool
}

type outcome int

const (
	outcomeNotConfirmed outcome = iota
	outcomeConfirmed
	outcomeUnverifiable
)

// resolveSNMPTarget works out where to reach the printer over SNMP: the job's
// explicit snmp_host option first, then auto-resolution from the Windows port.
//
// A nil result means device verification is skipped. That is not a failure: it
// is the documented fall-back to plain spooler-acceptance semantics.
func (e *Executor) resolveSNMPTarget(ctx context.Context, job printer.PrintJob, printerName string) *snmpTarget {
	if !e.SNMPEnabled {
		return nil
	}
	if strings.EqualFold(strings.TrimSpace(job.Options["snmp_enabled"]), "false") {
		return nil
	}

	community := e.SNMPCommunity
	if v := strings.TrimSpace(job.Options["snmp_community"]); v != "" {
		community = v
	}
	if community == "" {
		community = defaultSNMPCommunity
	}

	if host := strings.TrimSpace(job.Options["snmp_host"]); host != "" {
		return &snmpTarget{Host: host, Community: community}
	}

	if e.snmpHosts == nil {
		return nil
	}
	host := e.snmpHosts.Resolve(ctx, printerName)
	if host == "" {
		return nil
	}
	return &snmpTarget{Host: host, Community: community}
}

// readDeviceStateFn is the signature of the device-state reader, extracted so
// tests can drive waitForDeviceConfirmation through a scripted reader without
// a live SNMP stack. Production leaves it nil and falls back to snmp.ReadDeviceState.
type readDeviceStateFn func(host string, opts snmp.Options) (*snmp.DeviceState, error)

// readDeviceState reads the device state for a target, returning nil when the
// printer does not answer usefully.
func (e *Executor) readDeviceState(target snmpTarget) *snmp.DeviceState {
	reader := e.readDeviceStateFn
	if reader == nil {
		reader = snmp.ReadDeviceState
	}
	state, err := reader(target.Host, snmp.Options{Community: target.Community})
	if err != nil {
		return nil
	}
	return state
}

// waitForDeviceConfirmation polls the device until the page counter has
// advanced by copies pages.
//
// Page-count semantics (MEDIUM-6): the check is delta >= copies, which assumes
// one physical page per copy. That holds for the label printers PrintOps
// targets (ZPL/TSPL — one label = one page), where copies is the number of
// labels and the counter delta is exactly that. It does NOT hold for a
// multi-page document printed with copies=1: a 10-page report that jams after
// page 1 shows delta +1 and would be reported SUCCESS with 9 pages missing.
// PrintOps is a label gateway today; if document printing is added, this must
// require pagesPerDocument * copies (derive pagesPerDocument from the spooler's
// TotalPages job attribute) rather than copies alone.
//
// A raised blocking error (out of paper, jam, cover open) ends the wait
// immediately with the device's own reason — that is the whole point of reading
// SNMP rather than trusting the spooler.
func (e *Executor) waitForDeviceConfirmation(ctx context.Context, target snmpTarget, pagesBefore int64, copies int) deviceConfirmation {
	timeout := e.DeviceVerifyTimeout
	if timeout <= 0 {
		timeout = defaultDeviceVerifyTimeout
	}
	interval := e.DevicePollInterval
	if interval <= 0 {
		interval = defaultDevicePollInterval
	}

	deadline := time.Now().Add(timeout)
	lastCount := pagesBefore
	// anyReadSucceeded separates the two timeouts that look identical without
	// it: counter read + stayed put (real negative, retry safe) vs. no read at
	// all (unknown, retry risks a duplicate). A device that drops off the
	// network mid-verify falls in the second bucket and must NOT be filed as a
	// plain not-confirmed, or a printed page becomes retryable-FAILED.
	anyReadSucceeded := false

	for {
		if state := e.readDeviceState(target); state != nil {
			if state.PageCount != nil {
				anyReadSucceeded = true
				lastCount = *state.PageCount
				if lastCount-pagesBefore >= int64(copies) {
					return deviceConfirmation{
						Outcome:    outcomeConfirmed,
						Confirmed:  true,
						PagesAfter: lastCount,
						Errors:     state.Errors,
						Detail: fmt.Sprintf("device confirmed %d page(s) printed (counter %d -> %d)",
							lastCount-pagesBefore, pagesBefore, lastCount),
					}
				}
			}
			if state.Blocked {
				return deviceConfirmation{
					Outcome:    outcomeNotConfirmed,
					Confirmed:  false,
					PagesAfter: lastCount,
					Errors:     state.Errors,
					Detail: fmt.Sprintf("printer reports %s - %s",
						strings.Join(state.Errors, ", "), state.Describe()),
				}
			}
		}

		if !time.Now().Before(deadline) {
			break
		}

		select {
		case <-ctx.Done():
			// Runner shutdown or an outer deadline, not a device verdict.
			return deviceConfirmation{
				Inconclusive: true,
				PagesAfter:   lastCount,
				Detail:       "device verification interrupted before the counter could be read",
			}
		case <-time.After(interval):
		}
	}

	if !anyReadSucceeded {
		// No read succeeded during the whole window: the device went quiet
		// after the baseline. Nothing here disproves the print either, so the
		// honest verdict is "we don't know" — map to UNVERIFIABLE (→ UNVERIFIED),
		// not a plain not-confirmed (→ FAILED → re-executable).
		return deviceConfirmation{
			Outcome:     outcomeUnverifiable,
			Unverifiable: true,
			PagesAfter:   lastCount,
			Detail: fmt.Sprintf("device stopped answering SNMP during verification (no counter read in %s). "+
				"Paper may have come out - do not auto-retry.", timeout),
		}
	}
	return deviceConfirmation{
		Outcome:    outcomeNotConfirmed,
		Confirmed:  false,
		PagesAfter: lastCount,
		Detail: fmt.Sprintf("page counter did not advance within %s (counter %d -> %d, expected +%d)",
			timeout, pagesBefore, lastCount, copies),
	}
}
