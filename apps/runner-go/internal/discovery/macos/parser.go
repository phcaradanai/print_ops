// Package macos implements printer discovery on macOS using CUPS command-line
// tools (lpstat / lpoptions). The parsing logic in this file is pure and
// OS-independent so it can be unit-tested on any platform with mock output.
package macos

import (
	"strings"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
)

// parseResult is the intermediate parse output combined into DiscoveredPrinters.
type parseResult struct {
	printers map[string]*discovery.DiscoveredPrinter
	order    []string
}

func newParseResult() *parseResult {
	return &parseResult{printers: map[string]*discovery.DiscoveredPrinter{}}
}

func (r *parseResult) ensure(name string) *discovery.DiscoveredPrinter {
	if p, ok := r.printers[name]; ok {
		return p
	}
	p := &discovery.DiscoveredPrinter{
		LocalPrinterID: name,
		Name:           name,
		DisplayName:    name,
		Status:         "unknown",
		ConnectionType: discovery.ConnUnknown,
		Raw:            map[string]any{"source": "macos-cups"},
	}
	r.printers[name] = p
	r.order = append(r.order, name)
	return p
}

// ParseLpstatP parses the output of `lpstat -p`, e.g.:
//
//	printer LAB_LABEL_01 is idle.  enabled since ...
//	printer Zebra_ZD230 disabled since ...
func ParseLpstatP(out string, r *parseResult) {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "printer ") {
			continue
		}
		rest := strings.TrimPrefix(line, "printer ")
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		name := fields[0]
		p := r.ensure(name)
		switch {
		case strings.Contains(line, " is idle"):
			p.Status = "idle"
		case strings.Contains(line, "printing"):
			p.Status = "busy"
		case strings.Contains(line, "disabled"):
			p.Status = "offline"
		default:
			p.Status = "unknown"
		}
	}
}

// ParseLpstatV parses the output of `lpstat -v`, e.g.:
//
//	device for LAB_LABEL_01: usb://Zebra/ZD230
//	device for Office: socket://192.168.1.50:9100
func ParseLpstatV(out string, r *parseResult) {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		const prefix = "device for "
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		body := strings.TrimPrefix(line, prefix)
		name, uri, found := strings.Cut(body, ":")
		if !found {
			continue
		}
		name = strings.TrimSpace(name)
		uri = strings.TrimSpace(uri)
		p := r.ensure(name)
		p.URI = uri
		p.PortName = uri
		p.ConnectionType = classifyURI(uri)
	}
}

// ParseLpoptionsDefault parses the output of `lpoptions -d` to find the default
// printer. Example: "LAB_LABEL_01 copies=1 ...". The first token is the name.
func ParseLpoptionsDefault(out string, r *parseResult) {
	line := strings.TrimSpace(out)
	if line == "" {
		return
	}
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return
	}
	name := fields[0]
	if name == "" {
		return
	}
	p := r.ensure(name)
	p.IsDefault = true
}

// classifyURI maps a CUPS device URI scheme to a ConnectionType.
func classifyURI(uri string) discovery.ConnectionType {
	lower := strings.ToLower(uri)
	switch {
	case strings.HasPrefix(lower, "usb:"):
		return discovery.ConnUSB
	case strings.HasPrefix(lower, "socket:"), strings.HasPrefix(lower, "lpd:"),
		strings.HasPrefix(lower, "ipp:"), strings.HasPrefix(lower, "ipps:"),
		strings.HasPrefix(lower, "http:"), strings.HasPrefix(lower, "https:"):
		return discovery.ConnTCPIP
	case strings.HasPrefix(lower, "dnssd:"):
		return discovery.ConnWSD
	case strings.HasPrefix(lower, "smb:"):
		return discovery.ConnNetworkShare
	default:
		return discovery.ConnUnknown
	}
}

// Combine merges parsed lpstat/lpoptions outputs into a stable, ordered slice.
func Combine(lpstatP, lpstatV, lpoptionsD string) []discovery.DiscoveredPrinter {
	r := newParseResult()
	ParseLpstatP(lpstatP, r)
	ParseLpstatV(lpstatV, r)
	ParseLpoptionsDefault(lpoptionsD, r)

	out := make([]discovery.DiscoveredPrinter, 0, len(r.order))
	for _, name := range r.order {
		out = append(out, *r.printers[name])
	}
	return out
}
