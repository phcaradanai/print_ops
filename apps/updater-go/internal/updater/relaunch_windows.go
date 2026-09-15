//go:build windows

package updater

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	createBreakawayFromJob = 0x01000000
	detachedProcess        = 0x00000008
	createNoWindow         = 0x08000000
)

func EnsureBreakawayWorker() (bool, error) {
	if os.Getenv("PRINTOPS_UPDATER_WORKER") == "1" {
		return false, nil
	}
	os.Setenv("PRINTOPS_UPDATER_WORKER", "1")
	executable, err := os.Executable()
	if err != nil {
		return false, err
	}
	workerPath, err := copyWorkerOutsideInstall(executable)
	if err != nil {
		return false, err
	}
	os.Setenv("PRINTOPS_UPDATER_WORKER_PATH", workerPath)
	commandLine := quoteWindowsArg(workerPath)
	for _, arg := range os.Args[1:] {
		commandLine += " " + quoteWindowsArg(arg)
	}
	command, err := syscall.UTF16FromString(commandLine)
	if err != nil {
		return false, err
	}
	application, err := syscall.UTF16PtrFromString(workerPath)
	if err != nil {
		return false, err
	}
	var startup syscall.StartupInfo
	startup.Cb = uint32(unsafe.Sizeof(startup))
	var process syscall.ProcessInformation
	if err := syscall.CreateProcess(
		application,
		&command[0],
		nil,
		nil,
		false,
		createBreakawayFromJob|detachedProcess|createNoWindow,
		nil,
		nil,
		&startup,
		&process,
	); err != nil {
		return false, fmt.Errorf("CreateProcess breakaway worker: %w", err)
	}
	_ = syscall.CloseHandle(process.Process)
	_ = syscall.CloseHandle(process.Thread)
	return true, nil
}

func copyWorkerOutsideInstall(executable string) (string, error) {
	directory := filepath.Join(os.TempDir(), "PrintOps", "ota-workers")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("create updater worker directory: %w", err)
	}
	workerPath := filepath.Join(directory, fmt.Sprintf("printops-updater-%d-%d.exe", os.Getpid(), time.Now().UnixNano()))
	input, err := os.Open(executable)
	if err != nil {
		return "", fmt.Errorf("open updater executable for worker copy: %w", err)
	}
	defer input.Close()
	output, err := os.OpenFile(workerPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o700)
	if err != nil {
		return "", fmt.Errorf("create updater worker copy: %w", err)
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		_ = os.Remove(workerPath)
		return "", fmt.Errorf("copy updater executable: %w", err)
	}
	if err := output.Close(); err != nil {
		_ = os.Remove(workerPath)
		return "", fmt.Errorf("close updater worker copy: %w", err)
	}
	return workerPath, nil
}

func quoteWindowsArg(value string) string {
	if value != "" && !strings.ContainsAny(value, " \t\"") {
		return value
	}
	var builder strings.Builder
	builder.WriteByte('"')
	backslashes := 0
	for _, char := range value {
		switch char {
		case '\\':
			backslashes++
		case '"':
			builder.WriteString(strings.Repeat("\\", backslashes*2+1))
			builder.WriteRune(char)
			backslashes = 0
		default:
			builder.WriteString(strings.Repeat("\\", backslashes))
			builder.WriteRune(char)
			backslashes = 0
		}
	}
	builder.WriteString(strings.Repeat("\\", backslashes*2))
	builder.WriteByte('"')
	return builder.String()
}
