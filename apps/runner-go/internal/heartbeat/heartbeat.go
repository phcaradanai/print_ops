// Package heartbeat implements the runner heartbeat loop.
//
// The loop runs on its own ticker and is safe to run concurrently with the
// job poll loop. It records roundtrip latency via the telemetry package and
// surfaces transient failures to the caller-provided logger without stopping
// the loop.
package heartbeat

import (
	"context"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/api"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/telemetry"
)

// Looper drives the periodic heartbeat.
type Looper struct {
	Client   *api.Client
	Metrics  *telemetry.Metrics
	Log      *logging.Logger
	RunnerID string
	Interval time.Duration
	// State provides dynamic fields for the heartbeat (uptime, last job, ...).
	State StateProvider
}

// StateProvider exposes dynamic runner state consumed by the heartbeat. The
// jobs package implements this to share live counters.
type StateProvider interface {
	Uptime() time.Duration
	LastJobAt() time.Time
	LastError() string
}

// Run blocks until ctx is cancelled, sending heartbeats on each tick.
func (l *Looper) Run(ctx context.Context) {
	ticker := time.NewTicker(l.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			l.Log.Info("heartbeat loop stopped")
			return
		case <-ticker.C:
			l.tick(ctx)
		}
	}
}

func (l *Looper) tick(ctx context.Context) {
	// Bound each heartbeat call so a stuck API cannot block the ticker.
	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	t := telemetry.StartTimer()
	err := l.Client.Heartbeat(callCtx, l.RunnerID)
	latencyMs := t.ElapsedMs()
	l.Metrics.Observe(telemetry.MetricHeartbeatMs, latencyMs)

	if err != nil {
		l.Log.Warn("heartbeat failed", "error", err.Error(), "latency_ms", latencyMs)
		return
	}
	l.Log.Debug("heartbeat ok", "latency_ms", latencyMs)
}
