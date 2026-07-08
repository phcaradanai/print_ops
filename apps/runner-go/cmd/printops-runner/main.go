// Command printops-runner is the PrintOps Go Runner, a production candidate
// for local printer gateway duties (discovery, job polling, execution, trace
// reporting). It runs in foreground "dev mode" and is intentionally compatible
// with the existing TypeScript runner and Fastify API.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/api"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/config"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
	fakediscovery "github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery/fake"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery/macos"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery/windows"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/heartbeat"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/jobs"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer/fake"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/service"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/telemetry"
)

func main() {
	cmd := service.Parse(os.Args[1:])
	err := service.Dispatch(cmd, runRunner)
	if err != nil {
		fmt.Fprintf(os.Stderr, "printops-runner: %v\n", err)
		os.Exit(1)
	}
}

// runRunner loads config, wires dependencies, and runs the loops until SIGINT.
func runRunner(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	log := logging.New(cfg.LogLevel)
	log.Info("printops-go-runner starting", "config", cfg.Redacted())

	metrics := telemetry.NewMetrics()
	client := api.NewClient(cfg.APIBaseURL)

	// Auth: prefer explicit token; otherwise dev login.
	if cfg.Token != "" {
		client.Token = cfg.Token
		log.Info("auth: using provided runner token (redacted)")
	} else {
		log.Info("auth: no token set; performing dev login", "email", cfg.DevEmail)
		loginCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if err := client.Login(loginCtx, cfg.DevEmail, cfg.DevPassword); err != nil {
			cancel()
			return fmt.Errorf("dev login: %w", err)
		}
		cancel()
		log.Info("auth: dev login succeeded")
	}

	// Register (or re-register) the runner with the API.
	regCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	reg, err := client.Register(regCtx, api.RegisterRequest{
		Name:               cfg.RunnerName,
		Hostname:           cfg.Hostname,
		SupportedProtocols: []string{"fake", "rawtcp", "zpl", "tspl"},
		Metadata: map[string]any{
			"os":             cfg.OS,
			"arch":           cfg.Arch,
			"version":        cfg.Version,
			"executor_mode":  string(cfg.ExecutorMode),
			"discovery_mode": string(cfg.ResolveDiscoveryMode()),
		},
		Os:       cfg.OS,
		Arch:     cfg.Arch,
		Version:  cfg.Version,
		RunnerID: cfg.RunnerID,
	})
	cancel()
	if err != nil {
		return fmt.Errorf("register: %w", err)
	}
	runnerID := reg.ID
	if runnerID == "" {
		return errors.New("register: API returned empty runner id")
	}
	log = log.With("runner_id", runnerID)
	log.Info("registered with API", "name", reg.Name, "status", reg.Status)

	// Select discovery backend.
	discoveryMode := cfg.ResolveDiscoveryMode()
	discoverer, err := buildDiscovery(discoveryMode, log)
	if err != nil {
		return err
	}

	// Select executor. MVP defaults to fake; rawtcp is non-default.
	executor, err := buildExecutor(cfg, log)
	if err != nil {
		return err
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Initial immediate discovery, then periodic loop.
	syncDiscoveryOnce(ctx, client, discoverer, runnerID, cfg.Hostname, cfg.OS, metrics, log)
	go runDiscoveryLoop(ctx, client, discoverer, runnerID, cfg.Hostname, cfg.OS, cfg.DiscoveryInterval, metrics, log)

	// Jobs loop runs in the foreground; heartbeat runs in a goroutine.
	jobLooper := jobs.New(client, executor, metrics, log, runnerID, string(discoveryMode), string(cfg.ExecutorMode), jobs.DefaultConfig(cfg.PollInterval))

	hb := &heartbeat.Looper{
		Client:   client,
		Metrics:  metrics,
		Log:      log,
		RunnerID: runnerID,
		Interval: cfg.HeartbeatInterval,
		State:    jobLooper,
	}
	go hb.Run(ctx)

	log.Info("runner ready", "poll_interval_ms", cfg.PollInterval.Milliseconds(), "executor", executor.Name())
	jobLooper.Run(ctx)

	log.Info("runner stopped",
		"completed", jobLooper.Completed(), "failed", jobLooper.Failed(),
		"metrics", metrics.Snapshot())
	return nil
}

// buildDiscovery constructs the discovery backend for the given mode.
func buildDiscovery(mode config.DiscoveryMode, log *logging.Logger) (discovery.PrinterDiscovery, error) {
	switch mode {
	case config.DiscoveryFake:
		return fakediscovery.New(), nil
	case config.DiscoveryWindows:
		if runtime.GOOS != "windows" {
			log.Warn("windows discovery requested on non-windows OS; falling back to fake", "os", runtime.GOOS)
			return fakediscovery.New(), nil
		}
		return windows.New(log), nil
	case config.DiscoveryMacOS:
		if runtime.GOOS != "darwin" {
			log.Warn("macos discovery requested on non-darwin OS; falling back to fake", "os", runtime.GOOS)
			return fakediscovery.New(), nil
		}
		return macos.New(log), nil
	default:
		return fakediscovery.New(), nil
	}
}

// buildExecutor constructs the print executor. For the MVP, fake is the only
// fully supported executor; rawtcp/windows-spooler/cups are gated behind flags
// and documented as future work.
func buildExecutor(cfg *config.Config, log *logging.Logger) (printer.PrintExecutor, error) {
	switch cfg.ExecutorMode {
	case config.ExecutorFake:
		return fake.New(), nil
	case config.ExecutorRawTCP:
		log.Warn("rawtcp executor requested but not yet enabled for MVP; using fake", "requested", cfg.ExecutorMode)
		return fake.New(), nil
	case config.ExecutorWindowsSpooler:
		log.Warn("windows-spooler executor not yet enabled for MVP; using fake", "requested", cfg.ExecutorMode)
		return fake.New(), nil
	case config.ExecutorCUPS:
		log.Warn("cups executor not yet enabled for MVP; using fake", "requested", cfg.ExecutorMode)
		return fake.New(), nil
	default:
		return fake.New(), nil
	}
}

// runDiscoveryLoop periodically discovers and syncs printers until ctx cancels.
func runDiscoveryLoop(
	ctx context.Context,
	client *api.Client,
	d discovery.PrinterDiscovery,
	runnerID, hostname, osName string,
	interval time.Duration,
	metrics *telemetry.Metrics,
	log *logging.Logger,
) {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			syncDiscoveryOnce(ctx, client, d, runnerID, hostname, osName, metrics, log)
		}
	}
}

// syncDiscoveryOnce runs one discovery+sync cycle.
func syncDiscoveryOnce(
	ctx context.Context,
	client *api.Client,
	d discovery.PrinterDiscovery,
	runnerID, hostname, osName string,
	metrics *telemetry.Metrics,
	log *logging.Logger,
) {
	dctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	t := telemetry.StartTimer()
	printers, err := d.Discover(dctx)
	durMs := t.ElapsedMs()
	metrics.Observe(telemetry.MetricDiscoveryMs, durMs)

	if err != nil {
		log.Warn("discovery failed", "error", err.Error(), "duration_ms", durMs)
		return
	}
	log.Info("discovery completed", "count", len(printers), "duration_ms", durMs)

	syncCtx, syncCancel := context.WithTimeout(ctx, 10*time.Second)
	defer syncCancel()
	if err := client.SyncDiscovery(syncCtx, runnerID, printers); err != nil {
		log.Warn("discovery sync failed", "error", err.Error())
		return
	}
	log.Info("discovery synced", "count", len(printers))
}
