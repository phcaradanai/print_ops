package winpool

import "strings"

// Windows renders JobStatus as a *flags* enum: a comma-separated list such as
// "Printing, Retained" or "Error, Printing". Substring matching over the whole
// string gets this wrong in both directions — "Printing, Retained" contains
// "retained" but the job is still going, and "Error, Retained" contains
// "retained" but nothing was printed. Every flag has to be looked at separately.
//
// The lists below mirror BLOCKING_JOB_FLAGS / ACTIVE_JOB_FLAGS / DONE_JOB_FLAGS
// in packages/adapters/src/windows/windows-spooler.adapter.ts so the Go runner
// and the TypeScript adapter classify the same queue entry identically.

// blockingJobFlags mean the job will not print without someone intervening.
var blockingJobFlags = []string{
	"error",
	"offline",
	"paperout",
	"blocked",
	"blockeddevq",
	"deleted",
	"deleting",
	"paused",
	"userintervention",
}

// activeJobFlags mean the spooler has not finished with the job yet.
var activeJobFlags = []string{"printing", "spooling", "restarting"}

// doneJobFlags mean the spooler considers the document delivered.
var doneJobFlags = []string{"printed", "complete", "completed", "retained"}

// parseJobFlags splits a Windows JobStatus into its individual flag names,
// lower-cased and stripped of everything that is not a letter.
//
// A numeric or otherwise unparseable value yields no recognisable flag, which
// leaves the job neither blocked nor finished — unknown is not a verdict.
func parseJobFlags(status string) map[string]bool {
	flags := make(map[string]bool)
	for _, part := range strings.Split(status, ",") {
		var name strings.Builder
		for _, r := range strings.ToLower(part) {
			if r >= 'a' && r <= 'z' {
				name.WriteRune(r)
			}
		}
		if name.Len() > 0 {
			flags[name.String()] = true
		}
	}
	return flags
}

// isBlockedStatus reports whether the job cannot proceed — an explicit device
// or spooler fault. A blocking flag beats a done flag, so "Error, Retained" is
// blocked rather than finished.
func isBlockedStatus(status string) bool {
	return hasAnyFlag(parseJobFlags(status), blockingJobFlags)
}

// isFinishedStatus reports whether the spooler is done with the job and raised
// no fault.
//
// This is NOT proof that paper came out — only that Windows handed the document
// off without complaint. Confirming the physical page is the device tier's job.
func isFinishedStatus(status string) bool {
	flags := parseJobFlags(status)
	if hasAnyFlag(flags, blockingJobFlags) {
		return false
	}
	if hasAnyFlag(flags, activeJobFlags) {
		return false
	}
	return hasAnyFlag(flags, doneJobFlags)
}

func hasAnyFlag(flags map[string]bool, names []string) bool {
	for _, name := range names {
		if flags[name] {
			return true
		}
	}
	return false
}
