package winpool

import (
	"context"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// snmpHostResolver finds the network address to talk SNMP to for a printer
// installed on this Windows host.
//
// Two kinds of ports matter in practice:
//   - Standard TCP/IP ports expose PrinterHostAddress directly.
//   - WSD ports (what Windows creates for auto-discovered EPSONs) expose no
//     IPv4 address at all. The device address lives in the PnP registry entry
//     as an IPv6 link-local URL, e.g.
//     http://[fe80::5257:9cff:fe4f:6a3c%6]:80/WSD/DEVICE
//     That address is directly usable for SNMP.
//
// Resolution shells out to PowerShell and the answer does not change while the
// process lives, so it is cached per printer name. Failure is never fatal: an
// unresolvable printer simply means device verification is skipped.
type snmpHostResolver struct {
	mu    sync.Mutex
	cache map[string]string
}

// resolveScriptTemplate is the PowerShell used to locate the address. The
// printer name is substituted for the placeholder rather than formatted in, so
// the regex literals (which contain '%') survive untouched.
const resolveScriptTemplate = `
$PrinterName = '__PRINTER_NAME__'
$ErrorActionPreference = 'SilentlyContinue'

# 1. Standard TCP/IP port - the host address is on the port itself.
$printer = Get-Printer -Name $PrinterName
if ($printer) {
  $port = Get-PrinterPort -Name $printer.PortName
  if ($port -and $port.PrinterHostAddress) {
    Write-Output $port.PrinterHostAddress
    exit 0
  }
}

# 2. WSD port - dig the device URL out of the PnP registry entry.
$base = 'HKLM:\SYSTEM\CurrentControlSet\Enum\SWD\DAFWSDProvider'
foreach ($key in Get-ChildItem $base) {
  $props = Get-ItemProperty $key.PSPath
  if ($props.FriendlyName -ne $PrinterName) { continue }
  if ($props.LocationInformation -match '\[([0-9a-fA-F:%]+)\]') {
    Write-Output $Matches[1]
    exit 0
  }
  if ($props.LocationInformation -match 'https?://([0-9.]+)') {
    Write-Output $Matches[1]
    exit 0
  }
}
`

// snmpHostResolveTimeout bounds the PowerShell call.
const snmpHostResolveTimeout = 10 * time.Second

// newSNMPHostResolver returns an empty, ready-to-use resolver.
func newSNMPHostResolver() *snmpHostResolver {
	return &snmpHostResolver{cache: map[string]string{}}
}

// Resolve returns an SNMP-reachable address for printerName, or "" when none
// can be determined. It never returns an error and never panics; a negative
// result is cached so a printer without an address is probed only once.
func (r *snmpHostResolver) Resolve(ctx context.Context, printerName string) string {
	if runtime.GOOS != "windows" || strings.TrimSpace(printerName) == "" {
		return ""
	}

	r.mu.Lock()
	if host, ok := r.cache[printerName]; ok {
		r.mu.Unlock()
		return host
	}
	r.mu.Unlock()

	host := runSNMPHostScript(ctx, printerName)

	r.mu.Lock()
	r.cache[printerName] = host
	r.mu.Unlock()
	return host
}

// Forget drops a cached resolution, e.g. after a printer is re-added on a new
// port. An empty name clears the whole cache.
func (r *snmpHostResolver) Forget(printerName string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if printerName == "" {
		r.cache = map[string]string{}
		return
	}
	delete(r.cache, printerName)
}

// runSNMPHostScript executes the resolver script and returns its first
// non-empty output line.
func runSNMPHostScript(ctx context.Context, printerName string) string {
	script := buildSNMPHostScript(printerName)

	runCtx, cancel := context.WithTimeout(ctx, snmpHostResolveTimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return firstNonEmptyLine(string(out))
}

// buildSNMPHostScript substitutes the printer name into the resolver script.
func buildSNMPHostScript(printerName string) string {
	return strings.Replace(resolveScriptTemplate, "__PRINTER_NAME__", escapeForPS(printerName), 1)
}

// firstNonEmptyLine returns the first trimmed, non-empty line of s.
func firstNonEmptyLine(s string) string {
	for line := range strings.SplitSeq(s, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
