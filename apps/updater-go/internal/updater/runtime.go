package updater

import (
	"fmt"
	"os/exec"
)

type defaultRuntime struct{}

func NewDefaultRuntime() Runtime { return defaultRuntime{} }

func (defaultRuntime) StartDesktop(path, workingDirectory string) (int, error) {
	cmd := exec.Command(path)
	cmd.Dir = workingDirectory
	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("start desktop: %w", err)
	}
	pid := cmd.Process.Pid
	if err := cmd.Process.Release(); err != nil {
		return pid, fmt.Errorf("release desktop process: %w", err)
	}
	return pid, nil
}

func (defaultRuntime) RunInstaller(path, installRoot string) error {
	// The handoff's validated artifact format, not the cache filename suffix,
	// identifies this as an NSIS executable. The API intentionally stores staged
	// files with a neutral `.artifact` suffix. NSIS requires /D to be the final
	// argument; exec.Command keeps the path and arguments separated, so an
	// install path containing spaces is safe.
	cmd := exec.Command(path, "/S", "/D="+installRoot)
	cmd.Dir = installRoot
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("installer failed: %w (%s)", err, trimOutput(output))
	}
	return nil
}

func trimOutput(output []byte) string {
	const limit = 500
	if len(output) <= limit {
		return string(output)
	}
	return string(output[:limit])
}
