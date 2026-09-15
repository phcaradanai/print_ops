// Package fake provides a deterministic printer discovery backend for
// development, testing and demos. It never touches the OS and returns a fixed
// set of representative label/thermal printers.
package fake

import (
	"context"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
)

// Discovery is the fake PrinterDiscovery implementation.
type Discovery struct{}

// New returns a fake discovery backend.
func New() *Discovery { return &Discovery{} }

// Discover returns a fixed set of sample printers. It respects context
// cancellation but performs no I/O.
func (d *Discovery) Discover(ctx context.Context) ([]discovery.DiscoveredPrinter, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return []discovery.DiscoveredPrinter{
		{
			LocalPrinterID: "LAB_LABEL_01",
			Name:           "LAB_LABEL_01",
			DisplayName:    "Lab Label Printer (Fake)",
			DriverName:     "Generic / Text Only",
			PortName:       "FAKE001",
			URI:            "fake://lab-label-01",
			Status:         "idle",
			IsDefault:      true,
			IsShared:       false,
			Location:       "Lab Room A",
			Comment:        "Fake discovery sample",
			ConnectionType: discovery.ConnUSB,
			Raw:            map[string]any{"source": "fake", "dpi": 203},
		},
		{
			LocalPrinterID: "ZEBRA_ZD230_FAKE",
			Name:           "ZEBRA_ZD230_FAKE",
			DisplayName:    "Zebra ZD230 (Fake)",
			DriverName:     "ZDesigner ZD230-203dpi ZPL",
			PortName:       "USB002",
			URI:            "fake://zebra-zd230",
			Status:         "idle",
			IsDefault:      false,
			IsShared:       false,
			Location:       "Lab Room B",
			Comment:        "Fake ZPL label printer",
			ConnectionType: discovery.ConnUSB,
			Raw:            map[string]any{"source": "fake", "language": "ZPL", "dpi": 203},
		},
		{
			LocalPrinterID: "POSTEK_G2000_FAKE",
			Name:           "POSTEK_G2000_FAKE",
			DisplayName:    "Postek G2000 (Fake)",
			DriverName:     "Postek G-2000 TSPL",
			PortName:       "192.168.1.50:9100",
			URI:            "fake://postek-g2000",
			Status:         "idle",
			IsDefault:      false,
			IsShared:       false,
			Location:       "Pharmacy",
			Comment:        "Fake TSPL label printer",
			ConnectionType: discovery.ConnTCPIP,
			Raw:            map[string]any{"source": "fake", "language": "TSPL", "dpi": 203},
		},
	}, nil
}
