# Go Runner Architecture

## Overview

The Go Runner is a standalone binary that runs on client machines (Windows/macOS/Linux) and communicates with the PrintOps API (TypeScript). It is a **production candidate** running in parallel with the existing TypeScript runner.

## High-Level Flow

```
┌──────────────────────────────────────────────────────────┐
│ PrintOps API (TypeScript)                                │
│   - Job Queue (DB)                                       │
│   - Runner Management                                    │
│   - Audit / Trace / History                              │
└─────────────────▲──────────────────────────────────────┘
                  │ HTTP (REST)
                  │ register / heartbeat / discovery
                  │ jobs/next / events / result
┌─────────────────┴──────────────────────────────────────┐
│ Go Runner (apps/runner-go)                              │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │Heartbeat │ │Discovery │ │  Jobs    │ │ Telemetry │  │
│  │  Loop    │ │  Loop    │ │  Loop    │ │  Metrics  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬─────┘  │
│       │            │            │              │        │
│  ┌────▼────────────▼────────────▼──────────────▼─────┐ │
│  │              API Client (HTTP)                     │ │
│  └───────────────────────────────────────────────────┘ │
│       │                                                 │
│  ┌────▼─────┐                                    │
│  │ Executor │ → Fake / RawTCP / WindowsSpooler / CUPS  │
│  └──────────┘                                          │
└─────────────────────────────────────────────────────────┘
                  │
                  ▼
            🖨️ Local Printers
```

## Package Layout

```
internal/
  config/       - Env + file config, validation, redaction
  logging/      - Structured JSON logger (slog-based)
  telemetry/    - Timer + Metrics (latency tracking)
  api/          - HTTP client: register, heartbeat, jobs, events, result
  heartbeat/    - Periodic heartbeat loop
  discovery/    - PrinterDiscovery interface
    fake/       - Sample printers (no system calls)
    macos/      - lpstat parser
    windows/    - Get-Printer JSON parser
  jobs/         - Job poll loop with backoff
  printer/      - PrintExecutor interface
    fake/       - Simulated print with configurable latency
    rawtcp/     - Raw TCP 9100 skeleton (connect/write timeouts)
    zpl/        - ZPL payload builder
    tspl/       - TSPL payload builder
  runner/       - Orchestrates all loops, lifecycle, graceful shutdown
  service/      - CLI command dispatch for service install/uninstall
    windows/    - Windows Service placeholder
    macos/      - macOS launchd placeholder
```

## Concurrency Model

The runner runs three concurrent loops managed by the `runner.Runner` orchestrator:

1. **Heartbeat Loop** — sends heartbeat every N ms (default 15s)
2. **Discovery Loop** — discovers + syncs printers every N ms (default 60s)
3. **Job Poll Loop** — polls for jobs every N ms (default 750ms) with exponential backoff on API errors

All loops:
- Respect `context.Context` for graceful shutdown on SIGINT/SIGTERM
- Are independent — one loop failing does not stop the others
- Report metrics to the shared `telemetry.Metrics` instance

## Lifecycle

```
main() → config.Load() → runner.New() → runner.Start(ctx)

runner.Start(ctx):
  1. API login (if no token) / validate token
  2. Register runner → store runner_id
  3. Initial discovery + sync
  4. Start heartbeat loop (goroutine)
  5. Start discovery loop (goroutine)
  6. Start job poll loop (goroutine)
  7. Wait for ctx cancellation (SIGINT/SIGTERM)
  8. Graceful shutdown (finish current job, stop loops)

On exit: final heartbeat with status=OFFLINE (best effort)
```

## Job Execution Flow

```
1. Poll POST /jobs/next → receive job or nil
2. If job:
   a. Emit RUNNER_JOB_RECEIVED event
   b. Emit RUNNER_EXECUTION_STARTED event
   c. Executor.Execute(job) → result
      - Fake: sleep + return success/fail
      - RawTCP: connect → write → close (skeleton)
   d. Emit FAKE_SPOOLER_SENT / RUNNER_SPOOLER_SENT
   e. Emit FAKE_PRINTER_ACK / RUNNER_PRINTER_ACK
   f. Emit RUNNER_EXECUTION_SUCCEEDED or FAILED
   g. POST /jobs/:id/result with trace + evidence
3. If no job: sleep poll_interval, repeat
```

## Error Handling

- API errors → exponential backoff (max 30s)
- Discovery errors → log warning, continue with empty results
- Executor errors → report FAILED result, continue polling
- No `panic` in any runtime path
- All goroutines have `recover()` in the runner orchestrator

## Security

- Token from env (`PRINTOPS_RUNNER_TOKEN`) or dev-login fallback
- Token never logged (redacted)
- No raw payload data in trace events or logs
- HTTP client timeout: 30s default
- Command execution timeout: 5s (discovery)
- Read-only discovery (no system config changes)

## Build Constraints

Platform-specific code uses build tags:
- `discovery/windows` → `//go:build windows`
- `discovery/macos` → `//go:build darwin`
- `service/windows` → `//go:build windows`

On non-matching platforms, stub implementations compile and return "not supported" errors.

## Configuration Hierarchy

1. Environment variables (highest priority)
2. Config file (`PRINTOPS_CONFIG_FILE`, KEY=VALUE format)
3. Built-in defaults (lowest priority)

## Relationship to TypeScript Runner

| Aspect | TypeScript Runner | Go Runner |
|---|---|---|
| Language | Node.js/TypeScript | Go |
| Status | Dev/Reference | Production Candidate |
| Discovery | Mock | Fake + Real (Windows/macOS) |
| Executor | Mock | Fake + Skeleton (RawTCP) |
| Service | PM2/npm scripts | Windows Service (stub) |
| Memory | ~50-100MB | ~10-20MB |
| Startup | ~1-2s | <100ms |
| Binary | Requires Node.js | Single static binary |

Both runners use the same API endpoints and are interchangeable from the API's perspective.