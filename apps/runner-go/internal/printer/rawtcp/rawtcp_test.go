package rawtcp

import (
	"context"
	"sync"
	"testing"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
)

type recordingDialer struct {
	mu    sync.Mutex
	dials int
	conns []*recordingConn
}

func (d *recordingDialer) DialContext(_ context.Context, _, _ string) (Conn, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.dials++
	conn := &recordingConn{}
	d.conns = append(d.conns, conn)
	return conn, nil
}

type recordingConn struct {
	mu     sync.Mutex
	writes int
	closed int
}

func (c *recordingConn) Write(payload []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writes++
	return len(payload), nil
}

func (c *recordingConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed++
	return nil
}

func rawJob(id, address string) printer.PrintJob {
	return printer.PrintJob{
		JobID:           id,
		RenderedPayload: []byte("^XA^XZ"),
		Options: map[string]string{
			"rawtcp_address": address,
			"rawtcp_port":    "9100",
		},
	}
}

func TestExecute_ReusesConnectionForSequentialJobsOnSamePrinter(t *testing.T) {
	dialer := &recordingDialer{}
	exec := New()
	exec.Dialer = dialer
	t.Cleanup(func() { _ = exec.Close() })

	first, err := exec.Execute(context.Background(), rawJob("a", "192.0.2.10"))
	if err != nil || first.Status != printer.StatusSuccess {
		t.Fatalf("first execute = %#v, %v", first, err)
	}
	second, err := exec.Execute(context.Background(), rawJob("b", "192.0.2.10"))
	if err != nil || second.Status != printer.StatusSuccess {
		t.Fatalf("second execute = %#v, %v", second, err)
	}

	if dialer.dials != 1 {
		t.Fatalf("dial count = %d, want 1", dialer.dials)
	}
	if second.Evidence["connection_reused"] != true {
		t.Fatalf("second connection_reused = %#v, want true", second.Evidence["connection_reused"])
	}
	if dialer.conns[0].writes != 2 {
		t.Fatalf("writes = %d, want 2", dialer.conns[0].writes)
	}
}

func TestExecute_UsesIndependentSessionsForDifferentPrinters(t *testing.T) {
	dialer := &recordingDialer{}
	exec := New()
	exec.Dialer = dialer
	t.Cleanup(func() { _ = exec.Close() })

	_, _ = exec.Execute(context.Background(), rawJob("a", "192.0.2.10"))
	_, _ = exec.Execute(context.Background(), rawJob("b", "192.0.2.11"))
	_, _ = exec.Execute(context.Background(), rawJob("c", "192.0.2.10"))

	if dialer.dials != 2 {
		t.Fatalf("dial count = %d, want 2 (one per printer)", dialer.dials)
	}
}

func TestExecute_CanDisableConnectionReuseForUnsupportedPrinters(t *testing.T) {
	dialer := &recordingDialer{}
	exec := New()
	exec.Dialer = dialer
	exec.EnableConnectionReuse = false

	_, _ = exec.Execute(context.Background(), rawJob("a", "192.0.2.10"))
	_, _ = exec.Execute(context.Background(), rawJob("b", "192.0.2.10"))

	if dialer.dials != 2 {
		t.Fatalf("dial count = %d, want 2", dialer.dials)
	}
	if dialer.conns[0].closed != 1 || dialer.conns[1].closed != 1 {
		t.Fatalf("connections were not closed: %#v", dialer.conns)
	}
}
