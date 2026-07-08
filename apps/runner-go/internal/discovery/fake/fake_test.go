package fake

import (
	"context"
	"testing"
)

func TestFakeDiscover_ReturnsPrinters(t *testing.T) {
	d := New()
	printers, err := d.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover failed: %v", err)
	}
	if len(printers) < 3 {
		t.Fatalf("expected at least 3 sample printers, got %d", len(printers))
	}
	wantIDs := map[string]bool{"LAB_LABEL_01": false, "ZEBRA_ZD230_FAKE": false, "POSTEK_G2000_FAKE": false}
	for _, p := range printers {
		if _, ok := wantIDs[p.LocalPrinterID]; ok {
			wantIDs[p.LocalPrinterID] = true
		}
		if p.Name == "" {
			t.Error("printer Name must not be empty")
		}
		if p.URI == "" {
			t.Error("printer URI must not be empty")
		}
	}
	for id, found := range wantIDs {
		if !found {
			t.Errorf("expected sample printer %s not found", id)
		}
	}
}

func TestFakeDiscover_RespectsCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := New().Discover(ctx)
	if err == nil {
		t.Error("expected error on cancelled context")
	}
}
