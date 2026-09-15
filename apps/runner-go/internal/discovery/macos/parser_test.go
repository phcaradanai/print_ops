package macos

import (
	"testing"

	"github.com/phcaradanai/print_ops/apps/runner-go/internal/discovery"
)

func TestCombine_LpstatAndDevice(t *testing.T) {
	lpstatP := `printer LAB_LABEL_01 is idle.  enabled since Mon Jan 1 00:00:00 2024
printer Zebra_ZD230 disabled since Mon Jan 1 00:00:00 2024
printer OfficeLaser is printing.`
	lpstatV := `device for LAB_LABEL_01: usb://Zebra/ZD230?serial=123
device for Zebra_ZD230: socket://192.168.1.50:9100
device for OfficeLaser: lpd://10.0.0.5/lp`
	lpoptionsD := "LAB_LABEL_01 copies=1 media=..."

	out := Combine(lpstatP, lpstatV, lpoptionsD)
	if len(out) != 3 {
		t.Fatalf("expected 3 printers, got %d", len(out))
	}

	byName := map[string]discovery.DiscoveredPrinter{}
	for _, p := range out {
		byName[p.Name] = p
	}

	lab := byName["LAB_LABEL_01"]
	if !lab.IsDefault {
		t.Error("LAB_LABEL_01 should be default")
	}
	if lab.Status != "idle" {
		t.Errorf("LAB_LABEL_01 status = %q, want idle", lab.Status)
	}
	if lab.ConnectionType != discovery.ConnUSB {
		t.Errorf("LAB_LABEL_01 connection = %q, want usb", lab.ConnectionType)
	}
	if lab.URI == "" {
		t.Error("LAB_LABEL_01 URI should be set")
	}

	zebra := byName["Zebra_ZD230"]
	if zebra.Status != "offline" {
		t.Errorf("Zebra_ZD230 status = %q, want offline", zebra.Status)
	}
	if zebra.ConnectionType != discovery.ConnTCPIP {
		t.Errorf("Zebra_ZD230 connection = %q, want tcp_ip", zebra.ConnectionType)
	}

	office := byName["OfficeLaser"]
	if office.Status != "busy" {
		t.Errorf("OfficeLaser status = %q, want busy", office.Status)
	}
	if office.ConnectionType != discovery.ConnTCPIP {
		t.Errorf("OfficeLaser connection = %q, want tcp_ip", office.ConnectionType)
	}
}

func TestCombine_EmptyOutput(t *testing.T) {
	out := Combine("", "", "")
	if len(out) != 0 {
		t.Errorf("empty input should yield 0 printers, got %d", len(out))
	}
}

func TestParseLpstatV_ClassifiesURI(t *testing.T) {
	r := newParseResult()
	ParseLpstatV("device for Net: smb://server/printer", r)
	p := r.printers["Net"]
	if p == nil {
		t.Fatal("expected printer Net")
	}
	if p.ConnectionType != discovery.ConnNetworkShare {
		t.Errorf("smb URI -> %q, want network_share", p.ConnectionType)
	}
}

func TestParseLpoptionsDefault_EmptyIsNoop(t *testing.T) {
	r := newParseResult()
	ParseLpoptionsDefault("", r)
	ParseLpoptionsDefault("   ", r)
	if len(r.printers) != 0 {
		t.Errorf("empty lpoptions should not create printers, got %d", len(r.printers))
	}
}
