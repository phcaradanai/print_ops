# Current Status

Last updated: 2026-08-03

## Architecture

| Component | Language | Status | Role |
|---|---|---|---|
| `apps/api` | TypeScript (Fastify) | **Production** | REST API, NATS intake, job queue, in-process print executor, result callbacks, audit/trace. Also serves the built SPA in the packaged desktop app. |
| `apps/web` | TypeScript (React + Vite) | **Production** | Operator/admin dashboard, EN + TH |
| `apps/desktop` | **Rust (Tauri v2)** | **Production** | Windows desktop shell. Single instance, supervises and restarts the `server.exe` and `printops-runner.exe` sidecars, owns per-installation secrets and NATS settings. **Not Electron.** |
| `apps/runner-go` | Go | **Production** | The only runner. In the packaged desktop it runs **discovery + heartbeat only**. |
| `apps/windows-print-helper` | C# (WebView2) | **Production** | Driver-rendered HTML printing for the Windows spooler path |

The TypeScript runner has been removed. Any document describing `apps/runner`
or a Node.js runner is stale.

## Persistence

SQLite via `sql.js` (pure WASM, no native dependency), selected with
`DB_MODE=sqlite`; the packaged desktop always uses it. In-memory mode remains
the default for tests and quick dev runs.

The store has an OS-owned exclusive process lock, atomic replace-on-save,
versioned migration with a pre-migration backup, and a retention sweep
(default 14-day hot window) that archives every pruned row to
`<db dir>/archive` before deleting it.

`infra/migrations/` holds an unapplied PostgreSQL schema, and
`infra/docker/docker-compose.yml` includes Postgres/Redis scaffolding that the
application does **not** talk to today. Both are future work, not current
behaviour — the compose file says so inline.

## Executor topology (packaged desktop)

One executor, chosen deliberately:

- The **API's in-process local worker** (`PRINTOPS_LOCAL_WORKER=true`) executes
  every queued job through the Windows spooler adapter.
- The **Go runner** advertises no executable protocols and does not poll for
  jobs (`PRINTOPS_JOBS_ENABLED=false`). It exists for printer discovery and
  heartbeat.

Two claimants on one queue would double-print, so `runtime-architecture.ts`
refuses to start a packaged build with an unsafe combination.

## Verification chain

Spooler acceptance is **not** treated as proof of output. The Windows adapter
seeks device-side evidence (SNMP page counter, or a correlated printer-side IPP
job); without it the job ends `UNVERIFIED`, never `SUCCESS`. An adapter that
returns no verdict at all within `PRINTOPS_EXECUTE_TIMEOUT_MS` (default 180 s)
ends the job as `TIMEOUT`. Both statuses mean a page may exist and are refused
for re-execution.

## Intake and callbacks

| Path | Transport |
|---|---|
| `POST /api/v1/print-jobs` | HTTP + `X-Api-Key` |
| `POST /api/v1/printer/:code_template/:code_profile` | HTTP + `X-Api-Key` |
| `POST /api/v1/intake/:endpointCode` | HTTP, per-endpoint auth |
| `medisync.print.intake.<clientId>` | NATS JetStream, client-scoped durable consumer |

Terminal results are delivered over HTTP (`ACKNOWLEDGED` on 2xx) and/or NATS
(currently Core publish, `BEST_EFFORT`) with durable delivery records, bounded
retry, crash recovery, HMAC signing, and an SSRF guard on caller-supplied URLs.
Payloads carry `data_quality` / `missing_fields` so a print that succeeded with
incomplete data never reads as a clean success.

## Test evidence (2026-08-03, this workstation)

| Suite | Result |
|---|---|
| `apps/api` (vitest) | 54 files, 432 tests — pass |
| `apps/runner-go` (`go test ./...`) | all packages pass |
| `packages/adapters` | 71 tests pass |
| `packages/shared` | 16 tests pass |
| release verifier negatives | 4/4 pass |

`apps/web` unit tests require a complete `npm install` (they fail with a
missing `unocss` if dev dependencies were pruned).

Automated loopback E2E covers the transport × callback matrix
(`docs/testing/print-e2e-results.md`). It is **not** a substitute for the
physical, clean-install and cross-machine gates tracked in
`docs/production/PROD-01-gap-table.md`, which remain outstanding.

## Product name

**PrintOps**, on every surface a user sees. The `@printerops/*` npm scope and
the `com.printerops.desktop` bundle identifier deliberately keep the old
spelling as internal identifiers.
