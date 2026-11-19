package main

import (
	"context"
	"strings"
	"testing"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/config"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
)

// A runner that executes jobs with PRINTOPS_EXECUTOR_MODE=cups must refuse to
// start: there is no CUPS executor, and a fallback executor used to report
// SUCCESS without printing anything.
func TestValidateExecutorSupportRefusesCUPSJobExecution(t *testing.T) {
	if err := validateExecutorSupport(&config.Config{ExecutorMode: config.ExecutorCUPS, JobsEnabled: true}); err == nil {
		t.Fatal("expected cups + jobs enabled to be rejected")
	}
	if err := validateExecutorSupport(&config.Config{ExecutorMode: config.ExecutorCUPS, JobsEnabled: false}); err != nil {
		t.Fatalf("discovery-only cups runner must stay allowed, got %v", err)
	}
	for _, mode := range []config.ExecutorMode{config.ExecutorFake, config.ExecutorWindowsSpooler, config.ExecutorRawTCP} {
		if err := validateExecutorSupport(&config.Config{ExecutorMode: mode, JobsEnabled: true}); err != nil {
			t.Fatalf("mode %s must be allowed, got %v", mode, err)
		}
	}
}

// Unknown protocols must fail loudly instead of being handed to the fake
// executor, which simulates a successful print.
func TestDispatcherRefusesUnsupportedProtocols(t *testing.T) {
	log := logging.New("error")
	dispatcher := buildDispatcher(&config.Config{ExecutorMode: config.ExecutorFake, JobsEnabled: true}, log)

	for _, protocol := range []string{"cups", "ipp", "unknown-transport"} {
		job := printer.PrintJob{
			JobID:   "job-1",
			Options: map[string]string{"printer_protocol": protocol},
		}
		result, err := dispatcher.Execute(context.Background(), job)
		if err == nil {
			t.Fatalf("protocol %q must not execute successfully", protocol)
		}
		if result == nil {
			t.Fatalf("protocol %q must return a result", protocol)
		}
		if result.Status == printer.StatusSuccess {
			t.Fatalf("protocol %q reported SUCCESS without a printing executor", protocol)
		}
		if !strings.Contains(result.SafeMessage, "no executor") {
			t.Fatalf("protocol %q message should name the missing executor, got %q", protocol, result.SafeMessage)
		}
	}
}

// The fake executor stays reachable, but only for printers that are explicitly
// declared as fake.
func TestDispatcherKeepsFakeProtocolExplicit(t *testing.T) {
	log := logging.New("error")
	dispatcher := buildDispatcher(&config.Config{ExecutorMode: config.ExecutorFake, JobsEnabled: true}, log)

	result, err := dispatcher.Execute(context.Background(), printer.PrintJob{
		JobID:   "job-2",
		Options: map[string]string{"printer_protocol": "fake"},
	})
	if err != nil {
		t.Fatalf("fake protocol should still run in a dev runner: %v", err)
	}
	if result == nil || result.Status != printer.StatusSuccess {
		t.Fatalf("expected fake success, got %#v", result)
	}
	if result.Executor != "fake" {
		t.Fatalf("expected the fake executor to be reported, got %q", result.Executor)
	}
}

// A discovery-only runner is the station's normal configuration for CUPS: the
// executor mode may say cups, but no job may be claimed.
func TestDiscoveryOnlyRunnerHasNoProtocols(t *testing.T) {
	cfg := &config.Config{ExecutorMode: config.ExecutorCUPS, JobsEnabled: false}
	if got := supportedProtocols(cfg); len(got) != 0 {
		t.Fatalf("a discovery-only runner must advertise no protocols, got %v", got)
	}
	if got := effectiveExecutorMode(cfg); got != "disabled-discovery-only" {
		t.Fatalf("unexpected effective mode %q", got)
	}
}
