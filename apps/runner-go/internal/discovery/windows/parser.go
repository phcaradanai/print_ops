package windows

import (
	"encoding/json"
	"strings"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
	"github.com/phcaradanai/print_ops/apps/runner-go/internal/windowsstatus"
)

// printerStatus handles both string and integer PrinterStatus from PowerShell.
// PowerShell 5.1 ConvertTo-Json serializes enums as integers;
// PowerShell 7+ uses the enum name string.
type printerStatus struct {
	Raw string
}

func (p *printerStatus) UnmarshalJSON(b []byte) error {
	// Try string value first (PowerShell 7+)
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		p.Raw = s
		return nil
	}
	// Try integer value (PowerShell 5.1)
	var n int
	if err := json.Unmarshal(b, &n); err == nil {
		p.Raw = intToStatus(n)
		return nil
	}
	p.Raw = ""
	return nil
}

// intToStatus maps Win32_Printer.Status enum values to human-readable strings.
func intToStatus(n int) string {
	switch n {
	case 1:
		return "idle"
	case 2, 3:
		return "busy"
	case 4, 5:
		return "offline"
	case 6:
		return "busy"
	case 7:
		return "offline"
	default:
		return "unknown"
	}
}

// printerType handles both string and integer PrinterType from PowerShell.
// PowerShell 5.1 ConvertTo-Json serializes enums as integers;
// PowerShell 7+ uses the enum name string.
type printerType struct {
	Raw string
}

func (p *printerType) UnmarshalJSON(b []byte) error {
	// Try string value first (PowerShell 7+)
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		p.Raw = s
		return nil
	}
	// Try integer value (PowerShell 5.1)
	var n int
	if err := json.Unmarshal(b, &n); err == nil {
		p.Raw = intToPrinterType(n)
		return nil
	}
	p.Raw = ""
	return nil
}

// intToPrinterType maps Win32_Printer PrinterType enum values to human-readable strings.
func intToPrinterType(n int) string {
	switch n {
	case 0:
		return "Local"
	case 1:
		return "Network"
	case 2:
		return "Cluster" // Windows cluster printer
	default:
		return "Unknown"
	}
}

// psPrinter mirrors the fields we request from Get-Printer via ConvertTo-Json.
type psPrinter struct {
	Name        string        `json:"Name"`
	DriverName  string        `json:"DriverName"`
	PortName    string        `json:"PortName"`
	Shared      bool          `json:"Shared"`
	ShareName   string        `json:"ShareName"`
	Location    string        `json:"Location"`
	Comment     string        `json:"Comment"`
	Status      printerStatus `json:"PrinterStatus"`
	State       printerStatus `json:"PrinterState"`
	WorkOffline *bool         `json:"WorkOffline"`
	Type        printerType   `json:"Type"`
}

// psPort mirrors the fields we request from Get-PrinterPort or
// Get-CimInstance Win32_TCPIPPrinterPort (CIM fallback).
//
// Field mapping:
//
//	Get-PrinterPort          Win32_TCPIPPrinterPort (CIM)
//	─────────────────────    ───────────────────────────
//	PrinterHostAddress       HostAddress
//	PortNumber               PortNumber
//
// We decode both names via json tags and unify into PrinterHostAddr / PortNumber
// after unmarshalling so ParsePrinters works with either source.
type psPort struct {
	Name            string `json:"Name"`
	Description     string `json:"Description"`
	PrinterHostAddr string `json:"PrinterHostAddress"`
	HostAddress     string `json:"HostAddress"`
	PortNumber      int    `json:"PortNumber"`
}

// hostAddr returns the resolved host address, preferring PrinterHostAddress
// (Get-PrinterPort) and falling back to HostAddress (CIM).
func (p psPort) hostAddr() string {
	if p.PrinterHostAddr != "" {
		return p.PrinterHostAddr
	}
	return p.HostAddress
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
		rawStatus := p.Status.Raw
		if strings.TrimSpace(rawStatus) == "" {
			rawStatus = "Unknown"
		}
		dp := discovery.DiscoveredPrinter{
			LocalPrinterID: p.Name,
			Name:           p.Name,
			DisplayName:    p.Name,
			DriverName:     p.DriverName,
			PortName:       p.PortName,
			Status:         normalizeStatus(rawStatus),
			IsShared:       p.Shared,
			ShareName:      p.ShareName,
			Location:       p.Location,
			Comment:        p.Comment,
			IsDefault:      defaultName != "" && strings.EqualFold(p.Name, defaultName),
			ConnectionType: discovery.ConnUnknown,
			Raw:            map[string]any{"source": "windows-powershell"},
		}
		dp.Raw["detected"] = true
		if p.WorkOffline != nil {
			dp.Raw["work_offline"] = *p.WorkOffline
		}
		if p.State.Raw != "" {
			dp.Raw["printer_state"] = p.State.Raw
		}
		readiness := windowsstatus.Evaluate(windowsstatus.Observation{
			Detected:    true,
			Status:      rawStatus,
			State:       p.State.Raw,
			WorkOffline: p.WorkOffline,
		})
		dp.Raw["readiness_ready"] = readiness.Ready
		if readiness.BlockedBy != "" {
			dp.Raw["readiness_blocked_by"] = readiness.BlockedBy
		}
		if readiness.Warning != "" {
			dp.Raw["readiness_warning"] = readiness.Warning
		}

		// Surface printer type when available (useful for diagnostics).
		if p.Type.Raw != "" {
			dp.Raw["printer_type"] = p.Type.Raw
		}

		if port, ok := portByName[p.PortName]; ok {
			dp.ConnectionType = classifyPort(port)
			if port.hostAddr() != "" {
				dp.URI = buildURI(port)
				dp.Raw["host_address"] = port.hostAddr()
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
	return windowsstatus.NormalizeStatus(s)
}

// classifyPort derives a connection type from a port descriptor.
func classifyPort(p psPort) discovery.ConnectionType {
	if p.hostAddr() != "" || p.PortNumber == 9100 {
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
	return "socket://" + p.hostAddr() + ":" + itoa(port)
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
