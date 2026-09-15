package jobs

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/api"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/telemetry"
)

type noOpClient struct{}

func (noOpClient) NextJob(context.Context, string, int) (*api.Job, *api.PrinterInfo, error) {
	return nil, nil, nil
}
func (noOpClient) ReportEvent(context.Context, string, api.JobEventRequest) error   { return nil }
func (noOpClient) ReportResult(context.Context, string, api.JobResultRequest) error { return nil }
func (noOpClient) ReportExecution(context.Context, string, string) error            { return nil }

type schedulingExecutor struct {
	mu              sync.Mutex
	activeByPrinter map[string]int
	maxTotal        int
	activeTotal     int
	order           []string
	gate            <-chan struct{}
	bothStarted     chan<- struct{}
	signalled       bool
}

func (e *schedulingExecutor) Name() string { return "scheduling-test" }

func (e *schedulingExecutor) Execute(_ context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	start := time.Now()
	e.mu.Lock()
	e.activeByPrinter[job.PrinterID]++
	e.activeTotal++
	if e.activeTotal > e.maxTotal {
		e.maxTotal = e.activeTotal
	}
	e.order = append(e.order, "start:"+job.JobID)
	if e.activeTotal == 2 && e.bothStarted != nil && !e.signalled {
		close(e.bothStarted)
		e.signalled = true
	}
	e.mu.Unlock()

	if e.gate != nil {
		<-e.gate
	} else {
		time.Sleep(5 * time.Millisecond)
	}

	finish := time.Now()
	e.mu.Lock()
	e.order = append(e.order, "end:"+job.JobID)
	e.activeByPrinter[job.PrinterID]--
	e.activeTotal--
	e.mu.Unlock()
	return &printer.PrintResult{
		Status: printer.StatusSuccess, Executor: e.Name(),
		StartedAt: start, FinishedAt: finish, DurationMs: finish.Sub(start).Milliseconds(),
		Evidence: map[string]any{},
	}, nil
}

func newTestLooper(exec printer.PrintExecutor, capacity int) *Looper {
	l := New(noOpClient{}, exec, telemetry.NewMetrics(), logging.New("error"), "runner-test", "fake", "fake", DefaultConfig(time.Millisecond))
	l.slots = make(chan struct{}, capacity)
	return l
}

func claimed(id, printerID string) *claimedJob {
	return &claimedJob{
		job:           &api.Job{ID: id, PrinterID: printerID, PrinterCode: printerID, TraceID: "trace-" + id, MimeType: "text/plain", Copies: 1},
		printer:       &api.PrinterInfo{ID: printerID, Code: printerID, Protocol: "fake", ConnectionURI: "fake://" + printerID},
		pollStartedAt: time.Now(),
	}
}

func scheduleWithSlot(l *Looper, work *claimedJob) {
	l.slots <- struct{}{}
	l.schedule(context.Background(), work)
}

func TestSchedule_SamePrinterIsSequentialAndOrdered(t *testing.T) {
	exec := &schedulingExecutor{activeByPrinter: map[string]int{}}
	l := newTestLooper(exec, 3)
	scheduleWithSlot(l, claimed("a", "printer-1"))
	scheduleWithSlot(l, claimed("b", "printer-1"))
	scheduleWithSlot(l, claimed("c", "printer-1"))
	l.inFlight.Wait()

	want := []string{"start:a", "end:a", "start:b", "end:b", "start:c", "end:c"}
	if len(exec.order) != len(want) {
		t.Fatalf("order = %v, want %v", exec.order, want)
	}
	for i := range want {
		if exec.order[i] != want[i] {
			t.Fatalf("order = %v, want %v", exec.order, want)
		}
	}
	if gap := l.Metrics.Latest(telemetry.MetricIdleGapBetweenJobsMs); gap >= 50 {
		t.Fatalf("idle gap = %dms, want < 50ms", gap)
	}
}

func TestSchedule_DifferentPrintersRunConcurrently(t *testing.T) {
	gate := make(chan struct{})
	bothStarted := make(chan struct{})
	exec := &schedulingExecutor{
		activeByPrinter: map[string]int{},
		gate:            gate,
		bothStarted:     bothStarted,
	}
	l := newTestLooper(exec, 2)
	scheduleWithSlot(l, claimed("a", "printer-1"))
	scheduleWithSlot(l, claimed("b", "printer-2"))

	select {
	case <-bothStarted:
	case <-time.After(time.Second):
		t.Fatal("different-printer jobs did not start concurrently")
	}
	close(gate)
	l.inFlight.Wait()
	if exec.maxTotal != 2 {
		t.Fatalf("max concurrent = %d, want 2", exec.maxTotal)
	}
}
