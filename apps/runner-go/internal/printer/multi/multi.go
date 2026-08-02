// Package multi provides a PrintExecutor that dispatches to the correct
// concrete executor based on the printer protocol reported by the API.
//
// This solves the root cause of the "fake executor always used" bug: instead of
// selecting a single executor at startup, the runner registers ALL executors
// and the multi-dispatcher picks the right one per-job.
package multi

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
)

// Dispatcher maps printer protocols to concrete executors.
//
// All exported fields (Default, Executors) are visible for API compatibility
// but direct concurrent mutation of them is unsupported. Use Register or
// construct the Dispatcher before any concurrent method calls.
type Dispatcher struct {
	mu sync.RWMutex

	// Default is used when no protocol is specified or no executor matches.
	Default printer.PrintExecutor
	// Executors maps protocol name → executor (e.g. "raw-tcp-9100" → rawtcp).
	Executors map[string]printer.PrintExecutor
}

// New returns an empty Dispatcher with the given default.
func New(def printer.PrintExecutor) *Dispatcher {
	return &Dispatcher{
		Default:   def,
		Executors: map[string]printer.PrintExecutor{},
	}
}

// Register associates a protocol with an executor. Multiple protocol aliases
// can point to the same executor. Safe on zero-value Dispatchers.
func (d *Dispatcher) Register(protocol string, exec printer.PrintExecutor) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.Executors == nil {
		d.Executors = map[string]printer.PrintExecutor{}
	}
	d.Executors[strings.ToLower(strings.TrimSpace(protocol))] = exec
}

// Name implements PrintExecutor.
func (d *Dispatcher) Name() string { return "multi" }

// Execute selects the executor based on job.Options["printer_protocol"] and
// delegates. If no protocol is set or no match is found, uses the Default.
func (d *Dispatcher) Execute(ctx context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	exec := d.selectExecutor(job)
	result, err := exec.Execute(ctx, job)
	if result != nil {
		// Preserve the concrete executor name in evidence for traceability.
		if result.Evidence == nil {
			result.Evidence = map[string]any{}
		}
		result.Evidence["dispatched_executor"] = exec.Name()
	}
	return result, err
}

// selectExecutor resolves the executor for this job.
// The read lock is released before returning — callers must not rely on
// the executor staying registered for the duration of the Execute call.
func (d *Dispatcher) selectExecutor(job printer.PrintJob) printer.PrintExecutor {
	d.mu.RLock()
	defer d.mu.RUnlock()

	protocol := strings.ToLower(strings.TrimSpace(job.Options["printer_protocol"]))
	if protocol == "" {
		if d.Default != nil {
			return d.Default
		}
		return noopExecutor{}
	}

	// Direct match.
	if exec, ok := d.Executors[protocol]; ok {
		return exec
	}

	// Common protocol aliases.
	switch {
	case strings.Contains(protocol, "raw") || strings.Contains(protocol, "tcp") || strings.Contains(protocol, "9100"):
		if exec, ok := d.Executors["raw-tcp-9100"]; ok {
			return exec
		}
	case strings.Contains(protocol, "zpl"):
		if exec, ok := d.Executors["zpl"]; ok {
			return exec
		}
	case strings.Contains(protocol, "tspl"):
		if exec, ok := d.Executors["tspl"]; ok {
			return exec
		}
	case strings.Contains(protocol, "windows") || strings.Contains(protocol, "spooler") || strings.Contains(protocol, "winspool"):
		if exec, ok := d.Executors["windows-spooler"]; ok {
			return exec
		}
	case strings.Contains(protocol, "cups"):
		if exec, ok := d.Executors["cups"]; ok {
			return exec
		}
	}

	if d.Default != nil {
		return d.Default
	}
	return noopExecutor{}
}

// noopExecutor is the ultimate fallback when nothing matches.
type noopExecutor struct{}

func (noopExecutor) Name() string { return "noop" }
func (noopExecutor) Execute(ctx context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	return &printer.PrintResult{
		Status:      printer.StatusFailed,
		Executor:    "noop",
		SafeMessage: fmt.Sprintf("no executor registered for protocol %q", job.Options["printer_protocol"]),
	}, fmt.Errorf("no executor for protocol %q", job.Options["printer_protocol"])
}
