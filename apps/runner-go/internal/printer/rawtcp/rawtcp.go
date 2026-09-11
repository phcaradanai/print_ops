// Package rawtcp provides a skeleton RawTcpExecutor that sends bytes to a
// network printer over a raw TCP socket (port 9100 by default).
//
// STATUS: skeleton / not the default executor. It is intentionally conservative:
//   - explicit connect and write timeouts (no infinite hangs)
//   - NO automatic retry (a retry policy must be added before production use)
//   - never logs payload bytes (only sizes and addresses)
//
// This skeleton exists so the interface and trace points are in place for future
// production label printing. The fake executor remains the default.
package rawtcp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/printer"
)

// Defaults. Conservative on purpose.
const (
	defaultPort           = 9100
	defaultConnectTimeout = 5 * time.Second
	defaultWriteTimeout   = 10 * time.Second
)

// Executor sends a rendered payload to a printer over a raw TCP connection.
type Executor struct {
	// Address overrides the printer address resolved from job.Options/printer.
	Address string
	// Port overrides the default 9100.
	Port int
	// ConnectTimeout bounds the TCP dial. Defaults to 5s.
	ConnectTimeout time.Duration
	// WriteTimeout bounds the write. Defaults to 10s.
	WriteTimeout time.Duration
	// Dialer is injectable for testing.
	Dialer Dialer
	// EnableConnectionReuse keeps a successful printer session open for the
	// next sequential job to the same target. New() enables it; zero-value or
	// explicitly constructed executors remain conservative.
	EnableConnectionReuse bool
	// IdleTimeout closes a pooled session before reuse after this duration.
	IdleTimeout time.Duration

	sessionsMu sync.Mutex
	sessions   map[string]*session
}

type session struct {
	mu       sync.Mutex
	conn     Conn
	lastUsed time.Time
}

// Dialer abstracts net.Dial so the executor can be tested without a server.
type Dialer interface {
	DialContext(ctx context.Context, network, address string) (Conn, error)
}

// Conn is the minimal connection surface the executor needs.
type Conn interface {
	Write([]byte) (int, error)
	Close() error
}

// New returns a raw TCP executor with conservative defaults.
func New() *Executor {
	return &Executor{
		Port:                  defaultPort,
		ConnectTimeout:        defaultConnectTimeout,
		WriteTimeout:          defaultWriteTimeout,
		Dialer:                netDialer{},
		EnableConnectionReuse: true,
		IdleTimeout:           30 * time.Second,
	}
}

// Name implements PrintExecutor.
func (e *Executor) Name() string { return "rawtcp" }

// Execute writes the payload through a per-printer session. It performs exactly
// ONE attempt (no retry). The address/port are resolved from the
// executor config first, then job.Options["rawtcp_address"] / ["rawtcp_port"].
func (e *Executor) Execute(ctx context.Context, job printer.PrintJob) (*printer.PrintResult, error) {
	start := time.Now()

	addr, port, err := e.resolveAddress(job)
	if err != nil {
		return e.fail(start, job, "address resolution failed: "+err.Error(), err)
	}

	connectTimeout := e.ConnectTimeout
	if connectTimeout <= 0 {
		connectTimeout = defaultConnectTimeout
	}
	writeTimeout := e.WriteTimeout
	if writeTimeout <= 0 {
		writeTimeout = defaultWriteTimeout
	}

	target := net.JoinHostPort(addr, strconv.Itoa(port))
	pooled := e.sessionFor(target)
	pooled.mu.Lock()
	defer pooled.mu.Unlock()

	idleMs := int64(0)
	if !pooled.lastUsed.IsZero() {
		idleMs = time.Since(pooled.lastUsed).Milliseconds()
	}
	idleTimeout := e.IdleTimeout
	if idleTimeout <= 0 {
		idleTimeout = 30 * time.Second
	}
	if pooled.conn != nil && (!e.EnableConnectionReuse || time.Since(pooled.lastUsed) > idleTimeout) {
		_ = pooled.conn.Close()
		pooled.conn = nil
	}

	connectionReused := pooled.conn != nil
	initializeStartedAt := time.Now()
	if pooled.conn == nil {
		dctx, cancel := context.WithTimeout(ctx, connectTimeout)
		conn, dialErr := e.Dialer.DialContext(dctx, "tcp", target)
		cancel()
		if dialErr != nil {
			return e.fail(start, job, fmt.Sprintf("connect failed to %s: %v", target, dialErr), dialErr)
		}
		pooled.conn = conn
	}
	initializeMs := time.Since(initializeStartedAt).Milliseconds()
	conn := pooled.conn

	wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
	defer wcancel()

	done := make(chan int, 1)
	errCh := make(chan error, 1)
	writeStartedAt := time.Now()
	go func() {
		n, werr := conn.Write(job.RenderedPayload)
		done <- n
		errCh <- werr
	}()

	select {
	case <-wctx.Done():
		_ = conn.Close()
		pooled.conn = nil
		return e.fail(start, job, fmt.Sprintf("write timeout to %s", target), wctx.Err())
	case n := <-done:
		werr := <-errCh
		finished := time.Now()
		if werr != nil {
			_ = conn.Close()
			pooled.conn = nil
			return &printer.PrintResult{
				Status:      printer.StatusFailed,
				Executor:    e.Name(),
				SafeMessage: fmt.Sprintf("write error to %s: %v", target, werr),
				DurationMs:  finished.Sub(start).Milliseconds(),
				StartedAt:   start,
				FinishedAt:  finished,
				Evidence: map[string]any{
					"target":                target,
					"bytes_written":         n,
					"payload_size":          len(job.RenderedPayload),
					"connect_timeout":       connectTimeout.Milliseconds(),
					"write_timeout":         writeTimeout.Milliseconds(),
					"retried":               false,
					"connection_reused":     connectionReused,
					"printer_initialize_ms": initializeMs,
					"print_submit_ms":       finished.Sub(writeStartedAt).Milliseconds(),
				},
				Err: werr,
			}, nil
		}
		pooled.lastUsed = finished
		if !e.EnableConnectionReuse {
			_ = conn.Close()
			pooled.conn = nil
		}
		return &printer.PrintResult{
			Status:      printer.StatusSuccess,
			Executor:    e.Name(),
			SafeMessage: fmt.Sprintf("sent %d bytes to %s", n, target),
			DurationMs:  finished.Sub(start).Milliseconds(),
			StartedAt:   start,
			FinishedAt:  finished,
			Evidence: map[string]any{
				"target":                target,
				"bytes_written":         n,
				"payload_size":          len(job.RenderedPayload),
				"connect_timeout":       connectTimeout.Milliseconds(),
				"write_timeout":         writeTimeout.Milliseconds(),
				"retried":               false,
				"connection_reused":     connectionReused,
				"connection_idle_ms":    idleMs,
				"printer_initialize_ms": initializeMs,
				"print_submit_ms":       finished.Sub(writeStartedAt).Milliseconds(),
			},
		}, nil
	}
}

func (e *Executor) sessionFor(target string) *session {
	e.sessionsMu.Lock()
	defer e.sessionsMu.Unlock()
	if e.sessions == nil {
		e.sessions = map[string]*session{}
	}
	if existing := e.sessions[target]; existing != nil {
		return existing
	}
	created := &session{}
	e.sessions[target] = created
	return created
}

// Close releases every pooled printer connection. Safe to call repeatedly.
func (e *Executor) Close() error {
	e.sessionsMu.Lock()
	defer e.sessionsMu.Unlock()
	var firstErr error
	for _, pooled := range e.sessions {
		pooled.mu.Lock()
		if pooled.conn != nil {
			if err := pooled.conn.Close(); err != nil && firstErr == nil {
				firstErr = err
			}
			pooled.conn = nil
		}
		pooled.mu.Unlock()
	}
	e.sessions = nil
	return firstErr
}

// resolveAddress picks address/port from executor config, then job options.
func (e *Executor) resolveAddress(job printer.PrintJob) (string, int, error) {
	addr := e.Address
	if v := job.Options["rawtcp_address"]; v != "" {
		addr = v
	}
	if addr == "" {
		return "", 0, errors.New("no printer address (set executor Address or job option rawtcp_address)")
	}
	port := e.Port
	if port <= 0 {
		port = defaultPort
	}
	if v := job.Options["rawtcp_port"]; v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			port = p
		}
	}
	return addr, port, nil
}

func (e *Executor) fail(start time.Time, job printer.PrintJob, msg string, err error) (*printer.PrintResult, error) {
	finished := time.Now()
	return &printer.PrintResult{
		Status:      printer.StatusFailed,
		Executor:    e.Name(),
		SafeMessage: msg,
		DurationMs:  finished.Sub(start).Milliseconds(),
		StartedAt:   start,
		FinishedAt:  finished,
		Evidence: map[string]any{
			"payload_size": len(job.RenderedPayload),
			"retried":      false,
		},
		Err: err,
	}, nil
}

// netDialer adapts net.Dialer to the Dialer interface.
type netDialer struct{}

func (netDialer) DialContext(ctx context.Context, network, address string) (Conn, error) {
	d := net.Dialer{}
	return d.DialContext(ctx, network, address)
}
