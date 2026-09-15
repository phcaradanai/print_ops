package snmp

import (
	"strings"
	"testing"
)

func TestDecodeErrorState(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
		want []string
	}{
		{"nil", nil, nil},
		{"empty", []byte{}, nil},
		{"all clear", []byte{0x00, 0x00}, nil},
		{"lowPaper", []byte{0x80}, []string{"lowPaper"}},
		{"noPaper", []byte{0x40}, []string{"noPaper"}},
		{"lowToner", []byte{0x20}, []string{"lowToner"}},
		{"noToner", []byte{0x10}, []string{"noToner"}},
		{"doorOpen", []byte{0x08}, []string{"doorOpen"}},
		{"jammed", []byte{0x04}, []string{"jammed"}},
		{"offline", []byte{0x02}, []string{"offline"}},
		{"serviceRequested", []byte{0x01}, []string{"serviceRequested"}},
		{"inputTrayMissing", []byte{0x00, 0x80}, []string{"inputTrayMissing"}},
		{"outputTrayMissing", []byte{0x00, 0x40}, []string{"outputTrayMissing"}},
		{"markerSupplyMissing", []byte{0x00, 0x20}, []string{"markerSupplyMissing"}},
		{"outputNearFull", []byte{0x00, 0x10}, []string{"outputNearFull"}},
		{"outputFull", []byte{0x00, 0x08}, []string{"outputFull"}},
		{"inputTrayEmpty", []byte{0x00, 0x04}, []string{"inputTrayEmpty"}},
		{"overduePreventMaint", []byte{0x00, 0x02}, []string{"overduePreventMaint"}},
		{"paper out and door open", []byte{0x48}, []string{"noPaper", "doorOpen"}},
		{"jam plus tray empty", []byte{0x04, 0x04}, []string{"jammed", "inputTrayEmpty"}},
		// Bit 15 of the second octet is beyond the named set and is ignored
		// rather than reported as an unknown error.
		{"undefined trailing bit", []byte{0x00, 0x01}, nil},
		{"trailing octets ignored", []byte{0x40, 0x00, 0xff}, []string{"noPaper"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DecodeErrorState(tc.raw)
			if len(got) != len(tc.want) {
				t.Fatalf("DecodeErrorState(% x) = %v, want %v", tc.raw, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("DecodeErrorState(% x) = %v, want %v", tc.raw, got, tc.want)
				}
			}
		})
	}
}

func TestIsBlockingError(t *testing.T) {
	cases := map[string]bool{
		"noPaper":             true,
		"noToner":             true,
		"doorOpen":            true,
		"jammed":              true,
		"offline":             true,
		"serviceRequested":    true,
		"inputTrayMissing":    true,
		"markerSupplyMissing": true,
		"outputFull":          true,
		"inputTrayEmpty":      true,
		"lowPaper":            false,
		"lowToner":            false,
		"outputTrayMissing":   false,
		"outputNearFull":      false,
		"overduePreventMaint": false,
		"notAnError":          false,
	}
	for name, want := range cases {
		if got := IsBlockingError(name); got != want {
			t.Errorf("IsBlockingError(%q) = %v, want %v", name, got, want)
		}
	}
}

// TestDeviceStateFromCapturedResponse exercises the same decode path
// ReadDeviceState uses, without needing a printer on the network.
func TestDeviceStateFromCapturedResponse(t *testing.T) {
	vbs, err := ParseResponse(capturedResponse)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}

	pages := numberAt(vbs, OIDMarkerLifeCount)
	if pages == nil || *pages != 100000 {
		t.Fatalf("page count = %v, want 100000", pages)
	}
	if status := numberAt(vbs, OIDDeviceStatus); status == nil || *status != 2 {
		t.Errorf("device status = %v, want 2", status)
	}
	if missing := numberAt(vbs, OIDMarkerSuppliesLevel); missing != nil {
		t.Errorf("absent oid should decode to nil, got %v", missing)
	}

	errState, _ := Lookup(vbs, OIDPrinterDetectedErrorState)
	names := DecodeErrorState(errState.Bytes)
	blocked := false
	for _, name := range names {
		if IsBlockingError(name) {
			blocked = true
		}
	}
	if !blocked {
		t.Errorf("noPaper should block, decoded %v", names)
	}
}

func TestDeviceStateDescribe(t *testing.T) {
	pages := int64(100000)
	printerStatus := int64(3)
	state := &DeviceState{
		Host:          "192.168.1.50",
		PageCount:     &pages,
		PrinterStatus: &printerStatus,
		Errors:        []string{"noPaper", "doorOpen"},
		Blocked:       true,
	}
	got := state.Describe()
	for _, want := range []string{"pages=100000", "printerStatus=3", "errors=noPaper,doorOpen"} {
		if !strings.Contains(got, want) {
			t.Errorf("Describe() = %q, want it to contain %q", got, want)
		}
	}

	var nilState *DeviceState
	if nilState.Describe() != "" {
		t.Error("Describe() on a nil state should be empty")
	}
	if empty := (&DeviceState{}).Describe(); empty != "" {
		t.Errorf("Describe() on an empty state = %q, want empty", empty)
	}
}

// TestSupplyLevelIsSigned pins the deliberate divergence from the TypeScript
// client: prtMarkerSuppliesLevel is an INTEGER and its sentinel values (-2
// unknown, -3 some remaining) are sign-extended rather than read as 254/253.
func TestSupplyLevelIsSigned(t *testing.T) {
	body := []byte{
		0x30, 0x13,
		0x30, 0x11,
		0x06, 0x0c, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x2b, 0x0b, 0x01, 0x01, 0x09, 0x01, 0x01,
		0x02, 0x01, 0xfe,
	}
	vbs, err := ParseResponse(body)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}
	level := numberAt(vbs, OIDMarkerSuppliesLevel)
	if level == nil || *level != -2 {
		t.Fatalf("supply level = %v, want -2", level)
	}
}
