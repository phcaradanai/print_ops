package network

import (
	"context"
	"errors"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

func TestScanOnlyConnectsAndClosesWithoutPrinting(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	received := make(chan int, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			received <- -1
			return
		}
		defer conn.Close()
		conn.SetReadDeadline(time.Now().Add(time.Second))
		data := make([]byte, 8)
		n, _ := conn.Read(data)
		received <- n
	}()
	s := Scanner{Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "10.0.0.8:9100" {
			t.Errorf("wrong destination: %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, listener.Addr().String())
	}}
	addresses, incomplete, err := s.Scan(context.Background(), []string{"10.0.0.8"})
	if err != nil || incomplete || len(addresses) != 1 || addresses[0] != "10.0.0.8" {
		t.Fatalf("scan: %v %v %v", addresses, incomplete, err)
	}
	if n := <-received; n != 0 {
		t.Fatalf("discovery wrote %d bytes", n)
	}
}

func TestScanBoundsConcurrencyAndReturnsPartialOnCancellation(t *testing.T) {
	var active, peak, calls atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := Scanner{Dial: func(ctx context.Context, _, address string) (net.Conn, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		calls.Add(1)
		if address == "10.0.0.1:9100" {
			a, b := net.Pipe()
			b.Close()
			return a, nil
		}
		if calls.Load() >= 16 {
			cancel()
		}
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	targets := make([]string, 256)
	for i := range targets {
		targets[i] = net.IPv4(10, 0, 0, byte(i)).String()
	}
	addresses, incomplete, err := s.Scan(ctx, targets)
	if err != nil || !incomplete {
		t.Fatalf("expected partial result: %v %v", incomplete, err)
	}
	if peak.Load() > 16 || active.Load() != 0 {
		t.Fatalf("workers leaked or exceeded bound: %d %d", peak.Load(), active.Load())
	}
	for _, a := range addresses {
		if a != "10.0.0.1" {
			t.Fatalf("unexpected result %s", a)
		}
	}
}

func TestClosedPortsAreCompletedEmptySearch(t *testing.T) {
	s := Scanner{Dial: func(context.Context, string, string) (net.Conn, error) { return nil, errors.New("connection refused") }}
	addresses, incomplete, err := s.Scan(context.Background(), []string{"10.0.0.1"})
	if err != nil || incomplete || len(addresses) != 0 {
		t.Fatalf("%v %v %v", addresses, incomplete, err)
	}
}

func TestScannerRejectsUnboundedOrInvalidTargetsBeforeDial(t *testing.T) {
	s := Scanner{Dial: func(context.Context, string, string) (net.Conn, error) {
		t.Error("invalid targets must never dial")
		return nil, errors.New("unexpected dial")
	}}
	for _, targets := range [][]string{nil, {"printer.local"}, {"::1"}, {"10.0.0.1/24"}, make([]string, 257)} {
		if _, _, err := s.Scan(context.Background(), targets); err == nil {
			t.Fatalf("accepted invalid targets: %v", targets)
		}
	}
}

func TestScannerGivesEveryConnectionADeadline(t *testing.T) {
	s := Scanner{Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 1500*time.Millisecond {
			t.Error("missing bounded dial deadline")
		}
		return nil, errors.New("unreachable")
	}}
	_, _, err := s.Scan(context.Background(), []string{"10.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
}
