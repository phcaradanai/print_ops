package windows

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/logging"
)

const commandTimeout = 5 * time.Second

// PowerShell scripts. All are READ-ONLY. They select an explicit field set and
// emit JSON so the parser can be deterministic.
//
// We use a layered approach so discovery works on every Windows edition:
//
//	Tier 1  Get-Printer (PrintManagement module – richer data)
//	Tier 2  Get-CimInstance Win32_Printer (WMI, available everywhere)
//	Tier 3  wmic (pre-WMI fallback, very wide compatibility)
//
// Tier 1 requires the PrintManagement module which ships with RSAT and is NOT
// present on Windows Home by default. Tier 2 is always available and returns
// equivalent fields.
//
// Each script returns: Name,DriverName,PortName,Shared,Default,PrinterStatus
// plus any extras Tier 1 can provide (ShareName,Location,Comment,Type).
const (
	// Tier 1: PrintManagement (richest data). May fail on Home editions.
	scriptGetPrinter = `Get-Printer | Select-Object Name,DriverName,PortName,Shared,ShareName,Location,Comment,PrinterStatus,Type | ConvertTo-Json -Depth 3 -Compress`
	scriptGetPort    = `Get-PrinterPort | Select-Object Name,Description,PrinterHostAddress,PortNumber | ConvertTo-Json -Depth 3 -Compress`

	// Tier 2: CIM/WMI (available on ALL Windows editions, no extra modules).
	// Win32_Printer returns Name,DriverName,PortName,Shared,Default,PrinterStatus,Location,Comment.
	// We wrap the Select-Object list in a try/catch so the script never halts
	// even if CIM itself is broken (extremely rare).
	scriptGetPrinterCIM = `
try {
  Get-CimInstance -Class Win32_Printer -ErrorAction Stop |
    Select-Object Name,DriverName,PortName,Shared,Default,PrinterStatus,Location,Comment |
    ConvertTo-Json -Depth 2 -Compress
} catch { '' }
`
	// Win32_TCPIPPrinterPort gives us host address and port number when
	// Get-PrinterPort is unavailable.
	scriptGetPortCIM = `
try {
  Get-CimInstance -Class Win32_TCPIPPrinterPort -ErrorAction Stop |
    Select-Object Name,Description,HostAddress,PortNumber |
    ConvertTo-Json -Depth 2 -Compress
} catch { '' }
`
	// Default printer: always use CIM (works everywhere).
	scriptDefault = `(Get-CimInstance -Class Win32_Printer -Filter "Default=True" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Name)`
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

// Discover runs printer enumeration with a tiered fallback strategy so it works
// on every Windows edition (Home through Enterprise).
//
// Tier 1: Get-Printer + Get-PrinterPort (PrintManagement module – best data).
// Tier 2: Get-CimInstance Win32_Printer + Win32_TCPIPPrinterPort (WMI – always available).
//
// Each tier degrades gracefully: if Tier 1 returns no printers we
// transparently retry with Tier 2 instead of showing an empty list.
func (d *Discovery) Discover(ctx context.Context) ([]discovery.DiscoveredPrinter, error) {
	// Default printer detection uses CIM regardless (works everywhere).
	defaultName := d.safeRun(ctx, "DefaultPrinter", scriptDefault)

	// ── Tier 1: PrintManagement module ──────────────────────────────────
	printersJSON := d.safeRun(ctx, "Get-Printer", scriptGetPrinter)
	portsJSON := d.safeRun(ctx, "Get-PrinterPort", scriptGetPort)

	printers, err := ParsePrinters(printersJSON, portsJSON, defaultName)
	if err == nil && len(printers) > 0 {
		return printers, nil
	}

	// ── Tier 2: CIM/WMI (universal fallback) ────────────────────────────
	if d.log != nil {
		d.log.Info("windows discovery: Tier 1 (Get-Printer) returned no printers, falling back to CIM/WMI",
			"tier1_printers", len(printers),
			"tier1_has_output", printersJSON != "")
	}

	cimJSON := d.safeRun(ctx, "Get-CimInstance", scriptGetPrinterCIM)
	cimPortJSON := d.safeRun(ctx, "Get-CimInstance-PrinterPort", scriptGetPortCIM)

	printers, err = ParsePrinters(cimJSON, cimPortJSON, defaultName)
	if err != nil {
		if d.log != nil {
			d.log.Warn("windows discovery (CIM) parse failed", "error", err.Error())
		}
		return nil, nil
	}

	if len(printers) == 0 {
		if d.log != nil {
			d.log.Warn("windows discovery found no printers",
				"hint", "is the Print Spooler running? Try: Get-Service Spooler")
		}
	} else if d.log != nil {
		d.log.Info("windows discovery (CIM fallback) succeeded", "count", len(printers))
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

// deriveCommandContext creates an independent context with the given timeout,
// scoped to a single command invocation.  It derives from context.Background()
// so each command gets its full timeout budget regardless of how much of the
// parent's deadline was consumed by earlier commands.
//
// Parent cancellation (context.Canceled — explicit cancel / SIGINT) is bridged
// so shutdown interrupts a hung process promptly.  Parent deadline expiry
// (context.DeadlineExceeded) is NOT bridged — the command keeps its full
// timeout and the next bounded command is never starved.
func deriveCommandContext(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	cctx, cancel := context.WithTimeout(context.Background(), timeout)

	go func() {
		select {
		case <-parent.Done():
			// Only propagate explicit cancellation (SIGINT / ctx cancel),
			// not deadline expiry — each command owns its budget.
			if context.Cause(parent) == context.Canceled {
				cancel()
			}
		case <-cctx.Done():
		}
	}()

	return cctx, cancel
}

// runPowerShell executes a read-only PowerShell script with a bounded timeout.
// It captures both stdout and stderr for diagnostics. PowerShell errors on
// stderr are surfaced in the returned error so operators can troubleshoot.
//
// Each invocation gets an independent timeout via deriveCommandContext,
// protecting against parent-deadline starvation.
func runPowerShell(ctx context.Context, script string) (string, error) {
	cctx, cancel := deriveCommandContext(ctx, commandTimeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if strings.TrimSpace(stderr.String()) != "" {
			return "", fmt.Errorf("%w (stderr: %s)", err, strings.TrimSpace(stderr.String()))
		}
		return "", err
	}
	// If stdout is empty but stderr has content, surface it.
	if strings.TrimSpace(stdout.String()) == "" && strings.TrimSpace(stderr.String()) != "" {
		return "", fmt.Errorf("powershell produced no output (stderr: %s)", strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}
