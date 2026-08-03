package telemetry

import (
	"testing"
	"time"
)

func TestTimer_ElapsedNonNegative(t *testing.T) {
	tr := StartTimer()
	time.Sleep(2 * time.Millisecond)
	if tr.ElapsedMs() < 0 {
		t.Error("ElapsedMs should be non-negative")
	}
}

func TestMetrics_ObserveLatestAvg(t *testing.T) {
	m := NewMetrics()
	m.Observe(MetricRunnerExecMs, 10)
	m.Observe(MetricRunnerExecMs, 30)

	if got := m.Latest(MetricRunnerExecMs); got != 30 {
		t.Errorf("Latest = %d, want 30", got)
	}
	if got := m.AvgMs(MetricRunnerExecMs); got != 20 {
		t.Errorf("AvgMs = %d, want 20", got)
	}
}

func TestMetrics_AvgUnobservedIsZero(t *testing.T) {
	m := NewMetrics()
	if got := m.AvgMs("never_observed"); got != 0 {
		t.Errorf("AvgMs for unobserved = %d, want 0", got)
	}
}

func TestMetrics_SnapshotIsCopy(t *testing.T) {
	m := NewMetrics()
	m.Observe("x", 1)
	snap := m.Snapshot()
	snap["x"] = 999
	if got := m.Latest("x"); got != 1 {
		t.Errorf("mutating snapshot changed source; Latest = %d, want 1", got)
	}
}

func TestMetrics_ConcurrentSafe(t *testing.T) {
	m := NewMetrics()
	done := make(chan struct{})
	go func() {
		for i := 0; i < 100; i++ {
			m.Observe(MetricAPIRoundtripMs, int64(i))
		}
		close(done)
	}()
	for i := 0; i < 100; i++ {
		_ = m.Latest(MetricAPIRoundtripMs)
	}
	<-done
}
