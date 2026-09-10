//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"syscall"
	"time"
	"unsafe"
)

const (
	processQueryLimitedInformation = 0x1000
	th32csSnapProcess              = 0x00000002
	invalidHandleValue             = ^uintptr(0)
)

type processEntry32 struct {
	Size            uint32
	Usage           uint32
	ProcessID       uint32
	DefaultHeapID   uintptr
	ModuleID        uint32
	Threads         uint32
	ParentProcessID uint32
	PriorityBase    int32
	Flags           uint32
	ExeFile         [260]uint16
}

var (
	kernel32                   = syscall.NewLazyDLL("kernel32.dll")
	openProcess                = kernel32.NewProc("OpenProcess")
	queryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	closeHandle                = kernel32.NewProc("CloseHandle")
	createToolhelp32Snapshot   = kernel32.NewProc("CreateToolhelp32Snapshot")
	process32FirstW            = kernel32.NewProc("Process32FirstW")
	process32NextW             = kernel32.NewProc("Process32NextW")
)

func (defaultRuntime) ProcessPath(pid int) (string, error) {
	handle, _, err := openProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if handle == 0 {
		return "", fmt.Errorf("OpenProcess(%d): %w", pid, err)
	}
	defer closeHandle.Call(handle)
	buffer := make([]uint16, 32768)
	size := uint32(len(buffer))
	result, _, err := queryFullProcessImageNameW.Call(handle, 0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)))
	if result == 0 {
		return "", fmt.Errorf("QueryFullProcessImageName(%d): %w", pid, err)
	}
	return syscall.UTF16ToString(buffer[:size]), nil
}

func (defaultRuntime) StopProcessTree(pid int, timeout time.Duration) error {
	return terminateProcessTree(pid, timeout)
}

func (defaultRuntime) KillProcessTree(pid int, timeout time.Duration) error {
	return terminateProcessTree(pid, timeout)
}

func terminateProcessTree(pid int, timeout time.Duration) error {
	targets, err := processTreeExcluding(pid, os.Getpid())
	if err != nil {
		return fmt.Errorf("enumerate process tree %d: %w", pid, err)
	}
	for _, target := range targets {
		cmd := exec.Command("taskkill", "/PID", strconv.Itoa(target), "/F")
		if output, killErr := cmd.CombinedOutput(); killErr != nil {
			if _, pathErr := (defaultRuntime{}).ProcessPath(target); pathErr == nil {
				return fmt.Errorf("taskkill %d: %w (%s)", target, killErr, trimOutput(output))
			}
		}
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		allStopped := true
		for _, target := range targets {
			if _, err := (defaultRuntime{}).ProcessPath(target); err == nil {
				allStopped = false
				break
			}
		}
		if allStopped {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("process tree %d did not exit within %s", pid, timeout)
}

type processRecord struct {
	pid    int
	parent int
}

func processTreeExcluding(root, excludedRoot int) ([]int, error) {
	records, err := processRecords()
	if err != nil {
		return nil, err
	}
	children := make(map[int][]int, len(records))
	for _, record := range records {
		children[record.parent] = append(children[record.parent], record.pid)
	}
	for parent := range children {
		sort.Ints(children[parent])
	}
	excluded := collectProcessIDs(excludedRoot, children)
	visited := make(map[int]bool)
	ordered := make([]int, 0, len(records))
	var visit func(int)
	visit = func(current int) {
		if visited[current] || excluded[current] {
			return
		}
		visited[current] = true
		for _, child := range children[current] {
			visit(child)
		}
		ordered = append(ordered, current)
	}
	visit(root)
	return ordered, nil
}

func collectProcessIDs(root int, children map[int][]int) map[int]bool {
	collected := make(map[int]bool)
	var visit func(int)
	visit = func(current int) {
		if collected[current] {
			return
		}
		collected[current] = true
		for _, child := range children[current] {
			visit(child)
		}
	}
	visit(root)
	return collected
}

func processRecords() ([]processRecord, error) {
	snapshot, _, err := createToolhelp32Snapshot.Call(th32csSnapProcess, 0)
	if snapshot == 0 || snapshot == invalidHandleValue {
		return nil, fmt.Errorf("CreateToolhelp32Snapshot: %w", err)
	}
	defer closeHandle.Call(snapshot)

	entry := processEntry32{Size: uint32(unsafe.Sizeof(processEntry32{}))}
	first, _, firstErr := process32FirstW.Call(snapshot, uintptr(unsafe.Pointer(&entry)))
	if first == 0 {
		return nil, fmt.Errorf("Process32FirstW: %w", firstErr)
	}
	records := make([]processRecord, 0, 128)
	for {
		records = append(records, processRecord{
			pid:    int(entry.ProcessID),
			parent: int(entry.ParentProcessID),
		})
		next, _, nextErr := process32NextW.Call(snapshot, uintptr(unsafe.Pointer(&entry)))
		if next == 0 {
			if nextErr != syscall.ERROR_NO_MORE_FILES {
				return nil, fmt.Errorf("Process32NextW: %w", nextErr)
			}
			break
		}
	}
	return records, nil
}
