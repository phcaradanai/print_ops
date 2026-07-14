# PrintOps Go Runner (Canonical Production Runner)

The official production runner for PrintOps, written in Go. Replaces the legacy TypeScript runner as the default runner for all workflows. Handles printer discovery, job polling, execution, heartbeat, and trace reporting as a single statically compiled binary.

## Status

- **API/Web/Desktop**: TypeScript (unchanged)
- **Go Runner** (`apps/runner-go`): **Canonical production runner** — started by default via `npm run dev`, launched by the desktop app
- **TypeScript runner** (`apps/runner`): Legacy reference only — preserved for historical tests and dev comparison; not started or built by default

## Why Go for the Runner?

Go is well-suited for local-service workloads:
- Single static binary, trivial to deploy to client machines
- Low memory footprint and fast startup
- First-class Windows Service support via `golang.org/x/sys/windows/svc`
- Excellent concurrency primitives for poll/heartbeat/discovery loops
- Cross-compilation for Windows/macOS/Linux from any OS

## Quick Start (Dev Mode)

### Prerequisites

- Go 1.21+
- PrintOps API running (`apps/api`) on `http://localhost:3001`

### Run in Fake Mode

```bash
cd apps/runner-go
go run ./cmd/printops-runner
```

This uses sensible dev defaults:
- API: `http://localhost:3001`
- Discovery: `auto` → `fake` on non-Windows/macOS
- Executor: `fake` (no real printing)
- Poll interval: 750ms

### Run with Explicit Config

```bash
export PRINTOPS_API_BASE_URL=http://localhost:3001
export PRINTOPS_RUNNER_ID=go-runner-01
export PRINTOPS_RUNNER_NAME="Lab Go Runner"
export PRINTOPS_RUNNER_TOKEN=<your-jwt>        # optional; dev-login fallback if unset
export PRINTOPS_DISCOVERY_MODE=fake            # auto|windows|macos|fake
export PRINTOPS_EXECUTOR_MODE=fake             # fake|windows-spooler|cups|rawtcp
export PRINTOPS_POLL_INTERVAL_MS=500
export PRINTOPS_LOG_LEVEL=debug

go run ./cmd/printops-runner
```

### Config File (Optional)

```bash
# runner.env
PRINTOPS_API_BASE_URL=http://localhost:3001
PRINTOPS_RUNNER_NAME=Lab Go Runner
PRINTOPS_DISCOVERY_MODE=fake
PRINTOPS_EXECUTOR_MODE=fake
```

```bash
PRINTOPS_CONFIG_FILE=./runner.env go run ./cmd/printops-runner
```

Environment variables always override file values.

## Configuration Reference

| Env Var | Default | Description |
|---|---|---|
| `PRINTOPS_API_BASE_URL` | `http://localhost:3001` | API base URL |
| `PRINTOPS_RUNNER_ID` | (auto from register) | Runner ID; set to re-register with same ID |
| `PRINTOPS_RUNNER_NAME` | `printops-go-runner` | Display name |
| `PRINTOPS_RUNNER_TOKEN` | (dev-login) | Bearer JWT; falls back to dev login if unset |
| `PRINTOPS_POLL_INTERVAL_MS` | `750` | Job poll interval |
| `PRINTOPS_HEARTBEAT_INTERVAL_MS` | `15000` | Heartbeat interval |
| `PRINTOPS_DISCOVERY_INTERVAL_MS` | `60000` | Printer discovery + sync interval |
| `PRINTOPS_DISCOVERY_MODE` | `auto` | `auto\|windows\|macos\|fake` |
| `PRINTOPS_EXECUTOR_MODE` | `fake` | `fake\|windows-spooler\|cups\|rawtcp` |
| `PRINTOPS_LOG_LEVEL` | `info` | `debug\|info\|warn\|error` |
| `PRINTOPS_CONFIG_FILE` | (none) | Path to KEY=VALUE config file |

## Discovery Modes

### Fake

Returns sample printers (`LAB_LABEL_01`, `ZEBRA_ZD230_FAKE`, `POSTEK_G2000_FAKE`). No system calls.

### Windows

Uses PowerShell `Get-Printer` + `Get-PrinterPort` (read-only, JSON output). Never restarts the spooler or changes printer config.

### macOS

Uses `lpstat -p`, `lpstat -v`, `lpoptions -d`. 5-second timeout. Falls back to empty results with a warning if CUPS is unavailable.

## Executor Modes

### Fake (Default)

Simulates print latency. Configurable success/fail. Generates evidence without touching real printers.

### Raw TCP 9100 (Skeleton)

Connects to a printer's raw TCP port (default 9100), writes payload bytes. Connect/write timeouts, no retry by default. Not enabled in MVP — for future label printer (ZPL/TSPL) support.

### Windows Spooler / CUPS (Future)

Placeholders for real OS-level spooler execution.

## API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/auth/login` | POST | Dev-login fallback (when no token) |
| `/api/v1/runners/register` | POST | Register runner |
| `/api/v1/runners/:runnerId/heartbeat` | POST | Heartbeat |
| `/api/v1/runners/:runnerId/printers/discovery` | POST | Sync discovered printers |
| `/api/v1/runners/:runnerId/jobs/next` | POST | Claim next job (long-poll capable) |
| `/api/v1/runners/:runnerId/jobs/:jobId/events` | POST | Report trace events |
| `/api/v1/runners/:runnerId/jobs/:jobId/result` | POST | Report final result |
| `/api/v1/jobs/:jobId/execute` | POST | Legacy execution report |

## Trace Events

The Go runner reports these events for every job:

| Event | When |
|---|---|
| `RUNNER_JOB_RECEIVED` | Job claimed from poll |
| `RUNNER_EXECUTION_STARTED` | Before executor runs |
| `FAKE_SPOOLER_SENT` / `RUNNER_SPOOLER_SENT` | Payload sent to printer |
| `FAKE_PRINTER_ACK` / `RUNNER_PRINTER_ACK` | Printer acknowledged |
| `RUNNER_EXECUTION_SUCCEEDED` | Job completed successfully |
| `RUNNER_EXECUTION_FAILED` | Job failed |

Each event includes: `trace_id`, `job_id`, `runner_id`, `timestamp`, `duration_ms`, `status`, `safe_message`, `evidence`.

## Performance Metrics

The runner logs these metrics:

| Metric | Description |
|---|---|
| `job_pickup_latency_ms` | Time from poll start to job received |
| `runner_exec_ms` | Executor execution time |
| `result_report_ms` | Time to report result to API |
| `discovery_duration_ms` | Discovery cycle duration |
| `api_roundtrip_ms` | API call roundtrip |
| `heartbeat_roundtrip_ms` | Heartbeat roundtrip |

## CLI Commands

```bash
printops-runner run                # Run in foreground (default)
printops-runner install-service    # Install as Windows Service (stub)
printops-runner uninstall-service  # Uninstall Windows Service (stub)
printops-runner --help             # Show help
```

> **Note**: `install-service` / `uninstall-service` are CLI stubs with documentation. Full Windows Service integration is a future step.

## Project Structure

```
apps/runner-go/
  cmd/printops-runner/main.go    # Entry point, CLI dispatch
  internal/
    config/                      # Config from env + file
    api/                         # HTTP client (register, heartbeat, jobs, events)
    runner/                      # Orchestrates loops
    heartbeat/                   # Heartbeat loop
    discovery/                   # Discovery interface + platform impls
      fake/                      # Fake discovery
      macos/                     # lpstat parser
      windows/                   # Get-Printer JSON parser
    jobs/                        # Job poll + execute loop
    printer/                     # Executor interface + impls
      fake/                      # Fake executor
      rawtcp/                    # Raw TCP 9100 skeleton
      zpl/                       # ZPL payload builder
      tspl/                      # TSPL payload builder
    telemetry/                   # Metrics + timing
    logging/                     # Structured logger
    service/                     # Service CLI stubs
      windows/                   # Windows service placeholder
      macos/                     # macOS launchd placeholder
```

## Testing

```bash
cd apps/runner-go
go test ./...
```

## Building

```bash
cd apps/runner-go
go build -o printops-runner ./cmd/printops-runner
```

## Security

- Tokens are never logged (redacted as `set(redacted)`)
- No sensitive payload data in logs or trace events
- All HTTP clients have timeouts
- All command executions have timeouts
- Read-only printer discovery (no config changes)