//go:build windows

package updater

import (
	"reflect"
	"testing"
)

func TestProcessTreeFromRecordsExcludesOnlyUpdaterDescendants(t *testing.T) {
	records := []processRecord{
		{pid: 100, parent: 1},   // old Desktop
		{pid: 200, parent: 100}, // updater launched by old Desktop
		{pid: 201, parent: 200}, // updater child
		{pid: 300, parent: 200}, // candidate Desktop launched by updater
		{pid: 301, parent: 300}, // candidate sidecar
	}

	oldDesktopTargets := processTreeFromRecords(100, 200, records)
	if want := []int{100}; !reflect.DeepEqual(oldDesktopTargets, want) {
		t.Fatalf("old Desktop targets = %v, want %v", oldDesktopTargets, want)
	}

	candidateTargets := processTreeFromRecords(300, 200, records)
	if want := []int{301, 300}; !reflect.DeepEqual(candidateTargets, want) {
		t.Fatalf("candidate Desktop targets = %v, want %v", candidateTargets, want)
	}
}
