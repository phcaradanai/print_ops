//go:build windows

package updater

import (
	"fmt"
	"os"
	"reflect"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func TestDesktopShutdownEventObservesWindowsSignal(t *testing.T) {
	name := fmt.Sprintf(`Local\PrintOpsUpdaterTest-%d-%d`, os.Getpid(), time.Now().UnixNano())
	wideName, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		t.Fatal(err)
	}
	createEvent := kernel32.NewProc("CreateEventW")
	handle, _, createErr := createEvent.Call(0, 1, 0, uintptr(unsafe.Pointer(wideName)))
	if handle == 0 {
		t.Fatalf("CreateEventW: %v", createErr)
	}
	defer closeHandle.Call(handle)

	event, err := openDesktopShutdownEvent(name)
	if err != nil {
		t.Fatal(err)
	}
	defer event.Close()
	if event.IsSignaled() {
		t.Fatal("new shutdown event is unexpectedly signaled")
	}
	setEvent := kernel32.NewProc("SetEvent")
	if result, _, setErr := setEvent.Call(handle); result == 0 {
		t.Fatalf("SetEvent: %v", setErr)
	}
	if !event.IsSignaled() {
		t.Fatal("updater did not observe the Desktop shutdown signal")
	}
}

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
