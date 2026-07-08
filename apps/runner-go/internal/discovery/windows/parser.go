// Package windows implements read-only printer discovery on Windows using
// PowerShell (Get-Printer / Get-PrinterPort) with ConvertTo-Json output.
//
// The JSON parsing logic in this file is pure and OS-independent so it can be
// unit-tested on any platform with mock PowerShell JSON.
//
// This package is strictly READ-ONLY: it never restarts the spooler and never
// changes printer configuration.
package windows

import (
	"encoding/json"
	"strings"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
)

// psPrinter mirrors the fields we request from Get-Printer via ConvertTo-Json.
type psPrinter struct {
	Name         string `json:"Name"`
	DriverName   string `json:"DriverName"`
	PortName     string `json:"PortName"`
	Shared       bool   `json:"Shared"`
	ShareName    string `json:"ShareName"`
	Location     string `json:"Location"`
	Comment      string `json:"Comment"`
	PrinterState string `json:"PrinterStatus"`
	Type         string `json:"Type"`
}

// psPort mirrors the fields we request from Get-PrinterPort via ConvertTo-Json.
type psPort struct {
	Name            string `json:"Name"`
	Description     string `json:"Description"`
	PrinterHostAddr string `json:"PrinterHostAddress"`
	PortNumber      int    `json:"PortNumber"`
}

// unmarshalMaybeArray decodes JSON that may be a single object OR an array of
// objects. ConvertTo-Json emits a bare object when there is exactly one item.
func unmarshalMaybeArray[T any](raw string) ([]T, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var arr []T
	if err := json.Unmarshal([]byte(raw), &arr); err == nil {
		return arr, nil
	}
	var single T
	if err := json.Unmarshal([]byte(raw), &single); err != nil {
		return nil, err
	}
	return []T{single}, nil
}

// ParsePrinters parses Get-Printer JSON and Get-PrinterPort JSON into the shared
// DiscoveredPrinter model. defaultName marks the default printer (may be empty).
func ParsePrinters(printersJSON, portsJSON, defaultName string) ([]discovery.DiscoveredPrinter, error) {
	printers, err := unmarshalMaybeArray[psPrinter](printersJSON)
	if err != nil {
		return nil, err
	}
	ports, _ := unmarshalMaybeArray[psPort](portsJSON)

	portByName := make(map[string]psPort, len(ports))
	for _, p := range ports {
		portByName[p.Name] = p
	}

	out := make([]discovery.DiscoveredPrinter, 0, len(printers))
	for _, p := range printers {
		dp := discovery.DiscoveredPrinter{
			LocalPrinterID: p.Name,
			Name:           p.Name,
			DisplayName:    p.Name,
			DriverName:     p.DriverName,
			PortName:       p.PortName,
			Status:         normalizeStatus(p.PrinterState),
			IsShared:       p.Shared,
			ShareName:      p.ShareName,
			Location:       p.Location,
			Comment:        p.Comment,
			IsDefault:      defaultName != "" && strings.EqualFold(p.Name, defaultName),
			ConnectionType: discovery.ConnUnknown,
			Raw:            map[string]any{"source": "windows-powershell"},
		}

		if port, ok := portByName[p.PortName]; ok {
			dp.ConnectionType = classifyPort(port)
			if port.PrinterHostAddr != "" {
				dp.URI = buildURI(port)
				dp.Raw["host_address"] = port.PrinterHostAddr
			}
		} else {
			dp.ConnectionType = classifyPortName(p.PortName)
		}

		out = append(out, dp)
	}
	return out, nil
}

// normalizeStatus maps a Windows printer status token to our vocabulary.
func normalizeStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "normal", "idle", "0", "3":
		return "idle"
	case "printing", "processing":
		return "busy"
	case "offline", "error", "paused":
		return "offline"
	case "":
		return "unknown"
	default:
		return strings.ToLower(s)
	}
}

// classifyPort derives a connection type from a port descriptor.
func classifyPort(p psPort) discovery.ConnectionType {
	if p.PrinterHostAddr != "" || p.PortNumber == 9100 {
		return discovery.ConnTCPIP
	}
	return classifyPortName(p.Name)
}

// classifyPortName heuristically classifies a raw port name.
func classifyPortName(name string) discovery.ConnectionType {
	lower := strings.ToLower(name)
	switch {
	case strings.HasPrefix(lower, "usb"):
		return discovery.ConnUSB
	case strings.HasPrefix(lower, "wsd"):
		return discovery.ConnWSD
	case strings.HasPrefix(lower, "lpt"), strings.HasPrefix(lower, "com"):
		return discovery.ConnLPTCOM
	case strings.HasPrefix(lower, "\\\\"):
		return discovery.ConnNetworkShare
	case strings.Contains(lower, "ip_"), strings.Contains(lower, "tcp"):
		return discovery.ConnTCPIP
	default:
		return discovery.ConnUnknown
	}
}

// buildURI constructs a socket URI from a TCP/IP port descriptor.
func buildURI(p psPort) string {
	port := p.PortNumber
	if port == 0 {
		port = 9100
	}
	return "socket://" + p.PrinterHostAddr + ":" + itoa(port)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
