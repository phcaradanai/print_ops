package network

import (
	"context"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/api"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
)

type SearchClient interface {
	ClaimNetworkPrinterSearch(context.Context, string) (*api.NetworkPrinterSearch, error)
	ReportNetworkPrinterSearch(context.Context, string, *api.NetworkPrinterSearch, []string, bool) error
}

type Looper struct {
	Client   SearchClient
	RunnerID string
	Scanner  Scanner
	Log      *logging.Logger
}

func (l *Looper) Run(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		if err := l.Once(ctx); err != nil && ctx.Err() == nil && l.Log != nil {
			l.Log.Warn("network printer search failed", "error", err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (l *Looper) Once(ctx context.Context) error {
	claimCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	search, err := l.Client.ClaimNetworkPrinterSearch(claimCtx, l.RunnerID)
	cancel()
	if err != nil || search == nil {
		return err
	}
	// Reserve time for reporting within the server-issued lease.
	deadline := time.Now().Add(60 * time.Second)
	if !search.ExpiresAt.IsZero() && search.ExpiresAt.Add(-5*time.Second).Before(deadline) {
		deadline = search.ExpiresAt.Add(-5 * time.Second)
	}
	scanCtx, stop := context.WithDeadline(ctx, deadline)
	addresses, incomplete, scanErr := l.Scanner.Scan(scanCtx, search.Targets)
	stop()
	if scanErr != nil {
		incomplete = true
	}
	// Result reporting is idempotent. Retry only the report, never a print or scan.
	var reportErr error
	for attempt := 0; attempt < 3; attempt++ {
		reportCtx, done := context.WithTimeout(ctx, 4*time.Second)
		reportErr = l.Client.ReportNetworkPrinterSearch(reportCtx, l.RunnerID, search, addresses, incomplete)
		done()
		if reportErr == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return reportErr
}
