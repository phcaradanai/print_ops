package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/phcaradanai/print_ops/apps/updater-go/internal/updater"
)

func main() {
	workerProcess := os.Getenv("PRINTOPS_UPDATER_WORKER") == "1"
	defer func() {
		if workerProcess {
			if workerPath := os.Getenv("PRINTOPS_UPDATER_WORKER_PATH"); workerPath != "" {
				_ = os.Remove(workerPath)
			}
		}
	}()
	if len(os.Args) < 2 {
		usage()
	}
	if relaunched, err := updater.EnsureBreakawayWorker(); err != nil {
		fatal(err)
	} else if relaunched {
		return
	}

	worker := updater.Updater{}
	switch os.Args[1] {
	case "apply":
		flags := flag.NewFlagSet("apply", flag.ExitOnError)
		requestPath := flags.String("request", "", "path to the API updater handoff JSON")
		_ = flags.Parse(os.Args[2:])
		if *requestPath == "" {
			fatal(errors.New("--request is required"))
		}
		var request updater.Request
		if err := readJSONFile(*requestPath, &request); err != nil {
			fatal(err)
		}
		err := worker.Apply(context.Background(), request)
		// The persisted updater state and embedded request are authoritative for
		// recovery; the handoff file is only needed until Apply has started.
		_ = os.Remove(*requestPath)
		if err != nil {
			fatal(err)
		}
	case "recover":
		statePath, pid := parseStateArgs(os.Args[2:])
		if err := worker.Recover(context.Background(), statePath, pid); err != nil {
			fatal(err)
		}
	case "rollback":
		statePath, pid := parseStateArgs(os.Args[2:])
		if err := worker.Rollback(context.Background(), statePath, pid); err != nil {
			fatal(err)
		}
	default:
		usage()
	}
}

func readJSONFile(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}

func parseStateArgs(args []string) (string, int) {
	flags := flag.NewFlagSet("state", flag.ExitOnError)
	statePath := flags.String("state", "", "path to persisted updater state")
	pid := flags.Int("desktop-pid", 0, "current Desktop process id during recovery")
	_ = flags.Parse(args)
	if *statePath == "" {
		fatal(errors.New("--state is required"))
	}
	return *statePath, *pid
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: printops-updater apply --request <path> | recover --state <path> [--desktop-pid <pid>] | rollback --state <path>")
	os.Exit(2)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
