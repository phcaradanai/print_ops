package winpool

import "testing"

// TestJobFlagClassification pins the flags-enum semantics shared with the
// TypeScript adapter. "Error, Printing" is the state a real EPSON was observed
// in while the job was still being reported as accepted.
func TestJobFlagClassification(t *testing.T) {
	cases := []struct {
		name         string
		status       string
		wantBlocked  bool
		wantFinished bool
	}{
		{name: "printing and retained is still going", status: "Printing, Retained"},
		{name: "error and retained is blocked", status: "Error, Retained", wantBlocked: true},
		{name: "error and printing is blocked", status: "Error, Printing", wantBlocked: true},
		{name: "printed and retained is finished", status: "Printed, Retained", wantFinished: true},
		{name: "retained alone is finished", status: "Retained", wantFinished: true},
		{name: "paused is blocked", status: "Paused", wantBlocked: true},
		{name: "numeric status is neither", status: "144"},
		{name: "empty status is neither", status: ""},
		{name: "unknown text is neither", status: "unknown"},
		{name: "spooling is not finished", status: "Spooling"},
		{name: "no separating space", status: "Error,Printing", wantBlocked: true},
		{name: "lowercase input", status: "printed", wantFinished: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isBlockedStatus(tc.status); got != tc.wantBlocked {
				t.Errorf("isBlockedStatus(%q) = %v, want %v", tc.status, got, tc.wantBlocked)
			}
			if got := isFinishedStatus(tc.status); got != tc.wantFinished {
				t.Errorf("isFinishedStatus(%q) = %v, want %v", tc.status, got, tc.wantFinished)
			}
		})
	}
}

func TestParseJobFlags(t *testing.T) {
	cases := []struct {
		name   string
		status string
		want   []string
	}{
		{name: "single flag", status: "Printing", want: []string{"printing"}},
		{name: "two flags", status: "Error, Printing", want: []string{"error", "printing"}},
		{name: "punctuation stripped", status: "Blocked_DevQ", want: []string{"blockeddevq"}},
		{name: "empty segments dropped", status: "Printing, , Retained", want: []string{"printing", "retained"}},
		{name: "numeric yields nothing", status: "144"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseJobFlags(tc.status)
			if len(got) != len(tc.want) {
				t.Fatalf("parseJobFlags(%q) = %v, want %v", tc.status, got, tc.want)
			}
			for _, want := range tc.want {
				if !got[want] {
					t.Errorf("parseJobFlags(%q) is missing %q", tc.status, want)
				}
			}
		})
	}
}
