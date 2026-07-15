// Package service provides CLI command handling for the runner, including
// Windows Service and macOS launchd skeleton/stub commands.
package service

import (
	"context"
	"errors"
	"fmt"
	"os"
)

var ErrNotImplemented = errors.New("service management is not yet implemented; see docs/operations for manual setup")

type Command string

const (
	CmdRun              Command = "run"
	CmdInstallService   Command = "install-service"
	CmdUninstallService Command = "uninstall-service"
	CmdHelp             Command = "help"
)

func Parse(args []string) Command {
	if len(args) == 0 {
		return CmdHelp
	}
	switch Command(args[0]) {
	case CmdRun, CmdInstallService, CmdUninstallService:
		return Command(args[0])
	default:
		return CmdHelp
	}
}

type RunFunc func(ctx context.Context) error

func Dispatch(cmd Command, run RunFunc) error {
	switch cmd {
	case CmdRun:
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		return run(ctx)
	case CmdInstallService:
		fmt.Fprintln(os.Stderr, "install-service: not yet implemented.")
		printServiceHelp()
		return ErrNotImplemented
	case CmdUninstallService:
		fmt.Fprintln(os.Stderr, "uninstall-service: not yet implemented.")
		printServiceHelp()
		return ErrNotImplemented
	default:
		printHelp()
		return nil
	}
}

func printHelp() {
	fmt.Println("printops-runner - PrintOps Go Runner (production candidate)")
	fmt.Println("")
	fmt.Println("Usage:")
	fmt.Println("  printops-runner run                 Run the runner in foreground (dev mode)")
	fmt.Println("  printops-runner install-service     (stub) Install as a Windows Service / macOS launchd agent")
	fmt.Println("  printops-runner uninstall-service   (stub) Uninstall the service")
	fmt.Println("  printops-runner help                Show this help")
	fmt.Println("")
	fmt.Println("Configuration is via environment variables (see README) and optional config file.")
}

func printServiceHelp() {
	fmt.Fprintln(os.Stderr, "Windows Service direction:")
	fmt.Fprintln(os.Stderr, "  - Future: use golang.org/x/sys/windows/svc to host the runner as a Windows Service.")
	fmt.Fprintln(os.Stderr, "  - For now, run via Task Scheduler or NSSM as a wrapper, or run in foreground dev mode.")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "macOS direction:")
	fmt.Fprintln(os.Stderr, "  - Future: install a LaunchAgent plist at ~/Library/LaunchAgents/com.printops.runner.plist.")
	fmt.Fprintln(os.Stderr, "  - For now, run via launchd manually or run in foreground dev mode.")
}
