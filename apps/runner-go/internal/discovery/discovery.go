// Package discovery defines the printer discovery contract and the shared
// DiscoveredPrinter model used across platform-specific implementations
// (fake, windows, macos).
package discovery

import "context"

// ConnectionType classifies how a printer is connected. Values mirror the API's
// DiscoveredConnectionType so the sync payload maps cleanly.
type ConnectionType string

const (
	ConnUSB          ConnectionType = "usb"
	ConnTCPIP        ConnectionType = "tcp_ip"
	ConnWSD          ConnectionType = "wsd"
	ConnLPTCOM       ConnectionType = "lpt_com"
	ConnNetworkShare ConnectionType = "network_share"
	ConnUnknown      ConnectionType = "unknown"
)

// DiscoveredPrinter is a normalized printer as seen by the local OS. Fields
// beyond the minimal API contract are carried in Raw and surfaced via the
// discovery sync attributes map.
type DiscoveredPrinter struct {
	LocalPrinterID string         `json:"local_printer_id"`
	Name           string         `json:"name"`
	DisplayName    string         `json:"display_name"`
	DriverName     string         `json:"driver_name"`
	PortName       string         `json:"port_name"`
	URI            string         `json:"uri"`
	Status         string         `json:"status"`
	IsDefault      bool           `json:"is_default"`
	IsShared       bool           `json:"is_shared"`
	ShareName      string         `json:"share_name"`
	Location       string         `json:"location"`
	Comment        string         `json:"comment"`
	ConnectionType ConnectionType `json:"connection_type"`
	Raw            map[string]any `json:"raw,omitempty"`
}

// PrinterDiscovery is implemented by each platform backend.
type PrinterDiscovery interface {
	// Discover returns the printers currently visible to the local OS. It must
	// respect the provided context deadline/cancellation and must never panic;
	// on partial failure it should return whatever it can plus an error, or an
	// empty slice with a nil error when the platform simply has no printers.
	Discover(ctx context.Context) ([]DiscoveredPrinter, error)
}
