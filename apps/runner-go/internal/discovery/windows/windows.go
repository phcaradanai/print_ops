package windows

import (
	"bytes"
	"context"
	"os/exec"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
)

const commandTimeout = 5 * time.Second

// PowerShell scripts. All are READ-ONLY. They select an explicit field set and
// emit JSON so the parser can be deterministic.
const (
	scriptGetPrinter = `Get-Printer | Select-Object Name,DriverName,PortName,Shared,ShareName,Location,Comment,PrinterStatus,Type | ConvertTo-Json -Depth 3 -Compress`
	scriptGetPort    = `Get-PrinterPort | Select-Object Name,Description,PrinterHostAddress,PortNumber | ConvertTo-Json -Depth 3 -Compress`
	scriptDefault    = `(Get-CimInstance -Class Win32_Printer -Filter "Default=True" | Select-Object -First 1 -ExpandProperty Name)`
)

// Discovery discovers printers on Windows via PowerShell (read-only).
type Discovery struct {
	log *logging.Logger
	run func(ctx context.Context, script string) (string, error)
}

// New returns a Windows discovery backend.
func New(log *logging.Logger) *Discovery {
	return &Discovery{log: log, run: runPowerShell}
}

// Discover runs Get-Printer/Get-PrinterPort and parses the JSON. Failures
// degrade gracefully with a warning and an empty result.
func (d *Discovery) Discover(ctx context.Context) ([]discovery.DiscoveredPrinter, error) {
	printersJSON := d.safeRun(ctx, "Get-Printer", scriptGetPrinter)
	portsJSON := d.safeRun(ctx, "Get-PrinterPort", scriptGetPort)
	defaultName := d.safeRun(ctx, "DefaultPrinter", scriptDefault)

	printers, err := ParsePrinters(printersJSON, portsJSON, defaultName)
	if err != nil {
		if d.log != nil {
			d.log.Warn("windows discovery parse failed", "error", err.Error())
		}
		return nil, nil
	}
	if len(printers) == 0 && d.log != nil {
		d.log.Warn("windows discovery found no printers", "hint", "is the Print Spooler running?")
	}
	return printers, nil
}

func (d *Discovery) safeRun(ctx context.Context, label, script string) string {
	out, err := d.run(ctx, script)
	if err != nil {
		if d.log != nil {
			d.log.Warn("windows discovery command failed", "command", label, "error", err.Error())
		}
		return ""
	}
	return out
}

// runPowerShell executes a read-only PowerShell script with a bounded timeout.
func runPowerShell(ctx context.Context, script string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return stdout.String(), nil
}
