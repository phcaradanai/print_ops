// Package telemetry provides lightweight timing and metric primitives for the
// PrintOps Go runner. It is intentionally dependency-free and safe for
// concurrent use.
//
// The runner records a small set of well-known latency metrics (in
// milliseconds) that mirror the TypeScript runner's JobLatency shape so the two
// runners can be compared apples-to-apples.
package telemetry

import (
	"sync"
	"time"
)

// Metric names measured by the runner. Kept as constants to avoid typos and to
// keep the README/documentation in sync with the code.
const (
	MetricJobPickupLatencyMs = "job_pickup_latency_ms"
	MetricRunnerExecMs       = "runner_exec_ms"
	MetricResultReportMs     = "result_report_ms"
	MetricDiscoveryMs        = "discovery_duration_ms"
	MetricAPIRoundtripMs     = "api_roundtrip_ms"
	MetricHeartbeatMs        = "heartbeat_roundtrip_ms"
)

// Timer measures elapsed wall-clock time from its creation.
type Timer struct {
	start time.Time
}

// StartTimer returns a Timer started at the current time.
func StartTimer() *Timer {
	return &Timer{start: time.Now()}
}

// ElapsedMs returns the elapsed time in milliseconds since the timer started.
func (t *Timer) ElapsedMs() int64 {
	return time.Since(t.start).Milliseconds()
}

// Metrics is a concurrency-safe aggregator of the latest observed values and a
// running count/sum for each metric so callers can compute simple averages.
type Metrics struct {
	mu     sync.RWMutex
	latest map[string]int64
	count  map[string]int64
	sum    map[string]int64
}

// NewMetrics returns an initialised Metrics aggregator.
func NewMetrics() *Metrics {
	return &Metrics{
		latest: make(map[string]int64),
		count:  make(map[string]int64),
		sum:    make(map[string]int64),
	}
}

// Observe records a single value for the named metric.
func (m *Metrics) Observe(name string, valueMs int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.latest[name] = valueMs
	m.count[name]++
	m.sum[name] += valueMs
}

// Latest returns the most recently observed value for a metric.
func (m *Metrics) Latest(name string) int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.latest[name]
}

// AvgMs returns the running average for a metric, or 0 if never observed.
func (m *Metrics) AvgMs(name string) int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.count[name] == 0 {
		return 0
	}
	return m.sum[name] / m.count[name]
}

// Snapshot returns a copy of the latest observed values for all metrics.
func (m *Metrics) Snapshot() map[string]int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string]int64, len(m.latest))
	for k, v := range m.latest {
		out[k] = v
	}
	return out
}
