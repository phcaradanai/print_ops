// Package windowsstatus contains the Windows printer status normalization and
// readiness rules shared by discovery and the Windows spooler executor.
package windowsstatus

import "strings"

// Observation is the small set of Windows signals used for readiness. The
// raw values are kept because a derived status such as "error" can otherwise
// hide that Windows only reported a non-blocking value such as PaperOut.
type Observation struct {
	Detected    bool
	Status      string
	State       string
	WorkOffline *bool
}

// Readiness is the result of the shared pre-flight policy.
type Readiness struct {
	Ready     bool
	BlockedBy string
	Warning   string
}

// NormalizeStatus maps common Windows status names into the runner's stable
// vocabulary while preserving unknown values for diagnostics.
func NormalizeStatus(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	switch s {
	case "", "unknown", "none":
		return "unknown"
	case "0", "3", "normal", "idle", "ready", "online":
		return "idle"
	case "printing", "processing", "busy":
		return "busy"
	case "offline":
		return "offline"
	case "error":
		return "error"
	case "paused":
		return "paused"
	default:
		return s
	}
}

func tokens(value string) []string {
	parts := strings.FieldsFunc(strings.ToLower(strings.TrimSpace(value)), func(r rune) bool {
		return r == ',' || r == '|'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func explicitBlockedState(status, state string) string {
	for _, value := range []string{status, state} {
		for _, token := range tokens(value) {
			switch token {
			case "offline":
				return "offline"
			case "error":
				return "error"
			case "paused":
				return "paused"
			}
		}
	}
	return ""
}

// Evaluate applies the printer readiness policy:
//   - explicit Offline, Error, Paused, or WorkOffline=true blocks;
//   - detected Unknown is allowed with a warning;
//   - all other non-blocking states remain usable.
//
// Device-side and spooler verification still run after this gate. This policy
// only decides whether a detected printer may be attempted; it never turns a
// submitted job into a successful physical-print result.
func Evaluate(observation Observation) Readiness {
	if !observation.Detected {
		return Readiness{BlockedBy: "not-detected"}
	}
	if observation.WorkOffline != nil && *observation.WorkOffline {
		return Readiness{BlockedBy: "offline"}
	}
	if blocked := explicitBlockedState(observation.Status, observation.State); blocked != "" {
		return Readiness{BlockedBy: blocked}
	}
	if NormalizeStatus(observation.Status) == "unknown" {
		return Readiness{
			Ready:   true,
			Warning: "Windows reported UNKNOWN; no explicit offline, error, or paused state was reported",
		}
	}
	return Readiness{Ready: true}
}
