# Current Status

## Architecture

| Component | Language | Status | Role |
|---|---|---|---|
| `apps/api` | TypeScript | **Production** | REST API, job queue, runner management, audit |
| `apps/web` | TypeScript (React) | **Production** | Admin UI |
| `apps/desktop` | TypeScript (Electron) | **Existing** | Desktop app |
| `apps/runner` | TypeScript | **Dev/Reference** | Mock/reference runner |
| `apps/runner-go` | Go | **Production Candidate** | Parallel production runner |

## Key Decision (2025-07)

Added **Go Runner** (`apps/runner-go`) as a production candidate alongside the TypeScript runner. The API/Web/Desktop stack remains TypeScript. See [ADR-0003](../decisions/0003-go-runner-production-candidate.md).

## Go Runner Capabilities (MVP)

- ✅ Register with API
- ✅ Heartbeat loop (configurable interval)
- ✅ Printer discovery (fake / macOS / Windows)
- ✅ Discovery sync to API
- ✅ Job polling with backoff
- ✅ Fake print execution
- ✅ Trace/event reporting (6 event types)
- ✅ Result reporting
- ✅ Performance metrics (6 metrics)
- ✅ CLI stubs for Windows Service
- ✅ Raw TCP 9100 / ZPL / TSPL skeletons
- ✅ Tests passing (`go test ./...`)
- ✅ Build passing (`go build ./cmd/printops-runner`)

## What Has NOT Changed

- TypeScript API — no breaking changes, only backward-compatible additions
- TypeScript runner — fully functional, untouched
- Web/Desktop — untouched
- Database schema — no migrations required for Go runner MVP

## API Endpoints Added (Backward Compatible)

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/runners/:runnerId/jobs/next` | POST | Claim next available job |
| `/api/v1/runners/:runnerId/jobs/:jobId/events` | POST | Report trace events |
| `/api/v1/runners/:runnerId/jobs/:jobId/result` | POST | Report final job result |
| `/api/v1/runners/:runnerId/printers/discovery` | POST | Sync discovered printers |

These are additive and do not affect existing TypeScript runner behavior.