package macos

import (
	"bytes"
	"context"
	"os/exec"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
)

// commandTimeout bounds each CUPS command invocation.
const commandTimeout = 5 * time.Second

// Discovery discovers printers on macOS via CUPS command-line tools.
type Discovery struct {
	log *logging.Logger
	// run is injectable for testing; defaults to runCommand.
	run func(ctx context.Context, name string, args ...string) (string, error)
}

// New returns a macOS discovery backend.
func New(log *logging.Logger) *Discovery {
	return &Discovery{log: log, run: runCommand}
}

// Discover runs lpstat/lpoptions and parses the combined output. Missing tools
// or command failures degrade gracefully to whatever partial data is available
// with a warning, never an error that would stop the runner.
func (d *Discovery) Discover(ctx context.Context) ([]discovery.DiscoveredPrinter, error) {
	lpstatP := d.safeRun(ctx, "lpstat -p", "lpstat", "-p")
	lpstatV := d.safeRun(ctx, "lpstat -v", "lpstat", "-v")
	lpoptionsD := d.safeRun(ctx, "lpoptions -d", "lpoptions", "-d")

	printers := Combine(lpstatP, lpstatV, lpoptionsD)
	if len(printers) == 0 && d.log != nil {
		d.log.Warn("macos discovery found no printers", "hint", "is CUPS/lpstat available?")
	}
	return printers, nil
}

// safeRun executes a command and returns its stdout, logging a warning on error
// and returning an empty string so parsing can continue.
func (d *Discovery) safeRun(ctx context.Context, label, name string, args ...string) string {
	out, err := d.run(ctx, name, args...)
	if err != nil {
		if d.log != nil {
			d.log.Warn("macos discovery command failed", "command", label, "error", err.Error())
		}
		return ""
	}
	return out
}

// runCommand runs a command with a bounded timeout and returns stdout.
func runCommand(ctx context.Context, name string, args ...string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, name, args...)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return stdout.String(), nil
}
