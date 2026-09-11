package windowsstatus

import "testing"

func boolPtr(value bool) *bool { return &value }

func TestEvaluateUSBUnknownWithWorkOfflineFalseIsReady(t *testing.T) {
	result := Evaluate(Observation{
		Detected:    true,
		Status:      "Unknown",
		WorkOffline: boolPtr(false),
	})

	if !result.Ready {
		t.Fatalf("unknown USB printer should be ready when WorkOffline=false: %+v", result)
	}
	if result.Warning == "" {
		t.Fatal("unknown USB printer should retain a diagnostic warning")
	}
}

func TestEvaluateBlocksOnlyExplicitBlockedStates(t *testing.T) {
	for _, state := range []string{"Offline", "Error", "Paused"} {
		result := Evaluate(Observation{Detected: true, Status: state, WorkOffline: boolPtr(false)})
		if result.Ready || result.BlockedBy == "" {
			t.Fatalf("%s should block: %+v", state, result)
		}
	}

	for _, state := range []string{"", "Unknown", "Normal", "Printing", "PaperOut"} {
		result := Evaluate(Observation{Detected: true, Status: state, WorkOffline: boolPtr(false)})
		if !result.Ready {
			t.Fatalf("%s should not be blocked by readiness policy: %+v", state, result)
		}
	}
}

func TestEvaluateWorkOfflineTrueBlocksAsOffline(t *testing.T) {
	result := Evaluate(Observation{
		Detected:    true,
		Status:      "Unknown",
		WorkOffline: boolPtr(true),
	})
	if result.Ready || result.BlockedBy != "offline" {
		t.Fatalf("WorkOffline=true should block as offline: %+v", result)
	}
}
