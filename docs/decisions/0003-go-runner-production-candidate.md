# ADR-0003: Go Runner as Production Candidate

- **Status**: Accepted
- **Date**: 2025-07-08
- **Decision Maker**: Principal Engineer + Team

## Context

PrintOps needs a runner that runs on client machines (Windows primarily, macOS for dev) to:
- Discover local printers
- Poll for print jobs from the API
- Execute print jobs (raw TCP, Windows spooler, CUPS)
- Report trace/timing/audit events back

The existing TypeScript runner (`apps/runner`) works for dev/reference/mock but has drawbacks for client deployment:
- Requires Node.js runtime on each client machine
- Higher memory footprint (~50-100MB)
- Slower startup (~1-2s)
- Windows Service integration requires third-party tools (node-windows, pm2, qckwinsvc)
- No cross-compilation — deployer must install dependencies on each platform

## Decision

Add a **Go Runner** (`apps/runner-go`) as a **production candidate**, running in parallel with the TypeScript runner.

### What Stays TypeScript
- `apps/api` — REST API (no rewrite)
- `apps/web` — Admin UI
- `apps/desktop` — Electron app
- `apps/runner` — Dev/reference runner (kept, not deleted)

### What Moves to Go
- Production runner (`apps/runner-go`) — client-side only

## Rationale

| Factor | TypeScript Runner | Go Runner |
|---|---|---|
| Binary distribution | Needs Node.js | Single static binary |
| Memory | ~50-100MB | ~10-20MB |
| Startup | ~1-2s | <100ms |
| Windows Service | Needs wrapper (node-windows) | Native (`x/sys/windows/svc`) |
| Cross-compile | Not straightforward | `GOOS=windows GOARCH=amd64 go build` |
| Printer I/O | Async callbacks, streams | Goroutines, raw TCP, syscall |
| Concurrency | Event loop (single thread) | True parallelism |
| Deploy to client | Install Node + npm install | Copy one .exe |

Go is specifically well-suited for **long-running local services** that do I/O (HTTP polling, TCP 9100, command execution for discovery).

## Consequences

### Positive
- Production runner can be a single `.exe` on Windows — no Node.js required
- Native Windows Service support without wrappers
- Lower resource usage on client machines
- Faster startup and response times
- Easier to cross-compile for Windows/macOS/Linux

### Negative
- Two runner codebases to maintain (TypeScript reference + Go production)
- Team needs Go knowledge (mitigated by small, well-structured codebase)
- Shared types between TS and Go must be manually synced (mitigated by [runner-contract.md](../architecture/runner-contract.md))

### Neutral
- API/Web/Desktop remain TypeScript — no rewrite pressure
- TypeScript runner continues to serve as the reference implementation and contract validation

## Alternatives Considered

1. **Rewrite runner in Go and delete TypeScript runner** — Rejected. TS runner is useful for dev/reference and deleting it reduces flexibility.
2. **Improve TypeScript runner for production** — Rejected. Node.js deployment on client machines is heavier and Windows Service integration is fragile.
3. **Rust runner** — Considered. Excellent performance, but slower team adoption and longer compile times vs Go. Go is "good enough" and faster to ship.
4. **C# / .NET runner** — Considered. Excellent Windows integration, but heavier runtime on macOS/Linux and less cross-platform simplicity than Go.

## Implementation Plan

This ADR is implemented in the `mvp_nippon` branch with:
- `apps/runner-go` scaffolding (config, api, discovery, jobs, printer, telemetry, service)
- Fake discovery + fake executor for MVP
- Windows/macOS discovery implementations
- Raw TCP / ZPL / TSPL skeletons for future label printing
- Backward-compatible API endpoints
- Full documentation set
- Tests and build verification

## References

- [Go Runner Architecture](../architecture/go-runner.md)
- [Runner Contract](../architecture/runner-contract.md)
- [Performance Strategy](../architecture/performance-runner-strategy.md)
- [Current Status](../status/current-status.md)
- [Next Steps](../status/next-steps.md)