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
		"Paused":     "offline",
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
