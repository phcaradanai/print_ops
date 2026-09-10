//go:build !windows

package updater

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

func (defaultRuntime) ProcessPath(pid int) (string, error) {
	return os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "exe"))
}

func (defaultRuntime) StopProcessTree(pid int, timeout time.Duration) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := process.Signal(syscall.SIGTERM); err != nil {
		return err
	}
	return waitForProcessExit(pid, timeout)
}

func (defaultRuntime) KillProcessTree(pid int, timeout time.Duration) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := process.Kill(); err != nil {
		return err
	}
	return waitForProcessExit(pid, timeout)
}

func waitForProcessExit(pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filepath.Join("/proc", strconv.Itoa(pid))); os.IsNotExist(err) {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("process %d did not exit within %s", pid, timeout)
}
