package windows

import (
	"testing"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
)

const mockPrintersJSON = `[
  {
    "Name": "LAB_LABEL_01",
    "DriverName": "Generic / Text Only",
    "PortName": "USB001",
    "Shared": false,
    "ShareName": "",
    "Location": "Lab Room A",
    "Comment": "Label printer",
    "PrinterStatus": "Normal",
    "Type": "Local"
  },
  {
    "Name": "POSTEK_G2000",
    "DriverName": "Postek G-2000 TSPL",
    "PortName": "IP_192.168.1.50",
    "Shared": true,
    "ShareName": "POSTEK",
    "Location": "Pharmacy",
    "Comment": "",
    "PrinterStatus": "Offline",
    "Type": "Local"
  }
]`

const mockPortsJSON = `[
  {
    "Name": "USB001",
    "Description": "Virtual printer port for USB",
    "PrinterHostAddress": "",
    "PortNumber": 0
  },
  {
    "Name": "IP_192.168.1.50",
    "Description": "Standard TCP/IP Port",
    "PrinterHostAddress": "192.168.1.50",
    "PortNumber": 9100
  }
]`

func TestParsePrinters_Array(t *testing.T) {
	out, err := ParsePrinters(mockPrintersJSON, mockPortsJSON, "LAB_LABEL_01")
	if err != nil {
		t.Fatalf("ParsePrinters failed: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("expected 2 printers, got %d", len(out))
	}

	lab := out[0]
	if lab.Name != "LAB_LABEL_01" {
		t.Errorf("first printer name = %q, want LAB_LABEL_01", lab.Name)
	}
	if !lab.IsDefault {
		t.Error("LAB_LABEL_01 should be default")
	}
	if lab.ConnectionType != discovery.ConnUSB {
		t.Errorf("LAB_LABEL_01 connection = %q, want usb", lab.ConnectionType)
	}
	if lab.Status != "idle" {
		t.Errorf("LAB_LABEL_01 status = %q, want idle", lab.Status)
	}

	postek := out[1]
	if !postek.IsShared {
		t.Error("POSTEK_G2000 should be shared")
	}
	if postek.ConnectionType != discovery.ConnTCPIP {
		t.Errorf("POSTEK_G2000 connection = %q, want tcp_ip", postek.ConnectionType)
	}
	if postek.URI == "" {
		t.Error("POSTEK_G2000 URI should be set from TCP port")
	}
	if postek.Status != "offline" {
		t.Errorf("POSTEK_G2000 status = %q, want offline", postek.Status)
	}
}

func TestParsePrinters_SingleObject(t *testing.T) {
	single := `{"Name": "OnlyOne", "DriverName": "D", "PortName": "USB009", "PrinterStatus": "Normal"}`
	out, err := ParsePrinters(single, "", "")
	if err != nil {
		t.Fatalf("ParsePrinters single-object failed: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 printer, got %d", len(out))
	}
	if out[0].Name != "OnlyOne" {
		t.Errorf("name = %q, want OnlyOne", out[0].Name)
	}
}

func TestParsePrinters_USBUnknownWorkOfflineFalseIsReady(t *testing.T) {
	const usbUnknownJSON = `[
  {
    "Name": "POSTEK_USB",
    "DriverName": "POSTEK G-2000",
    "PortName": "USB001",
    "Shared": false,
    "PrinterStatus": "Unknown",
    "PrinterState": "Unknown",
    "WorkOffline": false,
    "Type": "Local"
  }
]`

	out, err := ParsePrinters(usbUnknownJSON, "", "")
	if err != nil {
		t.Fatalf("ParsePrinters USB Unknown failed: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 printer, got %d", len(out))
	}
	printer := out[0]
	if printer.ConnectionType != discovery.ConnUSB {
		t.Fatalf("connection = %q, want usb", printer.ConnectionType)
	}
	if printer.Status != "unknown" {
		t.Fatalf("status = %q, want unknown", printer.Status)
	}
	if ready, ok := printer.Raw["readiness_ready"].(bool); !ok || !ready {
		t.Fatalf("readiness_ready = %v, want true", printer.Raw["readiness_ready"])
	}
	if workOffline, ok := printer.Raw["work_offline"].(bool); !ok || workOffline {
		t.Fatalf("work_offline = %v, want false", printer.Raw["work_offline"])
	}
	if warning, ok := printer.Raw["readiness_warning"].(string); !ok || warning == "" {
		t.Fatalf("readiness_warning = %v, want a warning", printer.Raw["readiness_warning"])
	}
}

func TestParsePrinters_EmptyInput(t *testing.T) {
	out, err := ParsePrinters("", "", "")
	if err != nil {
		t.Fatalf("empty input should not error: %v", err)
	}
	if len(out) != 0 {
		t.Errorf("expected 0 printers, got %d", len(out))
	}
}

func TestParsePrinters_InvalidJSON(t *testing.T) {
	_, err := ParsePrinters("{not valid json", "", "")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestNormalizeStatus(t *testing.T) {
	cases := map[string]string{
		"Normal":     "idle",
		"3":          "idle",
		"Printing":   "busy",
		"Offline":    "offline",
		"":           "unknown",
		"Paused":     "paused",
		"WeirdState": "weirdstate",
	}
	for in, want := range cases {
		if got := normalizeStatus(in); got != want {
			t.Errorf("normalizeStatus(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestClassifyPortName(t *testing.T) {
	cases := map[string]discovery.ConnectionType{
		"USB001":          discovery.ConnUSB,
		"WSD-abc":         discovery.ConnWSD,
		"LPT1":            discovery.ConnLPTCOM,
		"COM2":            discovery.ConnLPTCOM,
		"\\\\server\\prn": discovery.ConnNetworkShare,
		"IP_10.0.0.5":     discovery.ConnTCPIP,
		"nonsense":        discovery.ConnUnknown,
	}
	for in, want := range cases {
		if got := classifyPortName(in); got != want {
			t.Errorf("classifyPortName(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestParsePrinters_NumericType exercises PowerShell 5.1 output where
// PrinterType is serialized as an integer enum (e.g. 0=Local) instead of a
// string. Without the printerType custom unmarshaler this would cause
// ParsePrinters to fail and unnecessarily fall back to Tier 2 (CIM).
func TestParsePrinters_NumericType(t *testing.T) {
	const numericTypeJSON = `[
  {
    "Name": "PS51_Printer",
    "DriverName": "PS Driver",
    "PortName": "USB001",
    "Shared": false,
    "ShareName": "",
    "Location": "",
    "Comment": "",
    "PrinterStatus": "Normal",
    "Type": 0
  }
]`
	out, err := ParsePrinters(numericTypeJSON, "", "")
	if err != nil {
		t.Fatalf("ParsePrinters with numeric Type failed: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 printer, got %d", len(out))
	}
	if out[0].Name != "PS51_Printer" {
		t.Errorf("name = %q, want PS51_Printer", out[0].Name)
	}
	// Printer type should be surfaced in Raw.
	pt, ok := out[0].Raw["printer_type"].(string)
	if !ok || pt != "Local" {
		t.Errorf("Raw[printer_type] = %v, want 'Local'", out[0].Raw["printer_type"])
	}
}

// TestParsePrinters_NumericTypeNetwork exercises numeric Type=1 (Network).
func TestParsePrinters_NumericTypeNetwork(t *testing.T) {
	const networkTypeJSON = `[
  {
    "Name": "NET_PRINTER",
    "DriverName": "Generic",
    "PortName": "IP_10.0.0.1",
    "Shared": true,
    "ShareName": "NET_SHARE",
    "Location": "",
    "Comment": "",
    "PrinterStatus": 3,
    "Type": 1
  }
]`
	out, err := ParsePrinters(networkTypeJSON, "", "")
	if err != nil {
		t.Fatalf("ParsePrinters with numeric Type=1 failed: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 printer, got %d", len(out))
	}
	pt, ok := out[0].Raw["printer_type"].(string)
	if !ok || pt != "Network" {
		t.Errorf("Raw[printer_type] = %v, want 'Network'", out[0].Raw["printer_type"])
	}
}

// TestParsePrinters_NumericStatus exercises numeric PrinterStatus (PS 5.1).
func TestParsePrinters_NumericStatus(t *testing.T) {
	const status3JSON = `[
  {
    "Name": "STATUS3_PRINTER",
    "DriverName": "Gen",
    "PortName": "LPT1",
    "Shared": false,
    "ShareName": "",
    "Location": "",
    "Comment": "",
    "PrinterStatus": 3,
    "Type": 0
  }
]`
	out, err := ParsePrinters(status3JSON, "", "")
	if err != nil {
		t.Fatalf("ParsePrinters with numeric PrinterStatus failed: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 printer, got %d", len(out))
	}
	// PrinterStatus 3 → "busy"
	if out[0].Status != "busy" {
		t.Errorf("status = %q, want busy", out[0].Status)
	}
}
