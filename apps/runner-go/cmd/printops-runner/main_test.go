package main

import (
	"reflect"
	"testing"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/config"
)

func TestDiscoveryOnlyRunnerDoesNotAdvertiseExecution(t *testing.T) {
	cfg := &config.Config{
		JobsEnabled:  false,
		ExecutorMode: config.ExecutorWindowsSpooler,
	}

	if got := effectiveExecutorMode(cfg); got != "disabled-discovery-only" {
		t.Fatalf("effective executor = %q, want disabled-discovery-only", got)
	}
	if got := supportedProtocols(cfg); len(got) != 0 {
		t.Fatalf("discovery-only runner advertised executable protocols: %v", got)
	}
}

func TestHeadlessRunnerAdvertisesConfiguredExecution(t *testing.T) {
	cfg := &config.Config{
		JobsEnabled:  true,
		ExecutorMode: config.ExecutorWindowsSpooler,
	}

	if got := effectiveExecutorMode(cfg); got != "windows-spooler" {
		t.Fatalf("effective executor = %q, want windows-spooler", got)
	}
	want := []string{"fake", "raw-tcp-9100", "windows-spooler", "zpl", "tspl"}
	if got := supportedProtocols(cfg); !reflect.DeepEqual(got, want) {
		t.Fatalf("supported protocols = %v, want %v", got, want)
	}
}
