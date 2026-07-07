# PrintOps — Current Status

**Project:** PrintOps — Generic Print Gateway Service
**Goal:** Accept print commands from external integration programs and deliver to local printers via runners
**Current phase:** MVP Nippon Complete
**Last updated:** 2026-07-07
**Branch:** `mvp_nippon`

---

## Architecture Summary

PrintOps is a **generic print gateway**. It does NOT connect to HIS directly.

```
[HIS]
  ↓ (external integration program — separate team)
[External Integration Program]
  ↓  POST /api/v1/print-jobs  (X-Api-Key auth)
[PrintOps API]  ←→  [In-memory / PostgreSQL]
  ↓  poll /runners/:id/poll
[Local Runner]  (PC on LAN with printer access)
  ↓
[Printer — Zebra / POSTEK / Windows Spooler / CUPS / raw TCP 9100]
```

---

## What is Done

### External Print API (`/api/v1/`)
- `POST /api/v1/print-jobs` — accept from external integration program
- `GET /api/v1/print-jobs/:id` — job detail
- `GET /api/v1/print-jobs/by-request-id/:requestId` — lookup by request_id
- `POST /api/v1/print-jobs/:id/cancel` — cancel ACCEPTED/VALIDATED/QUEUED/DISPATCHED
- `GET /api/v1/print-jobs/:id/trace` — full trace timeline
- `GET /api/v1/printers` — list active printers
- `GET /api/v1/printers/:id/status` — printer status
- API key authentication (`X-Api-Key` header, SHA-256 hashed at rest)

### Job Lifecycle (10 statuses)
`ACCEPTED → VALIDATED → QUEUED → DISPATCHED → PRINTING → SUCCESS`
(alternatives: `FAILED`, `TIMEOUT`, `CANCELLED`, `DUPLICATE_RETURNED`)

### Idempotency
- `request_id + source_system` is unique — DB UNIQUE index enforced
- Duplicate requests return existing job with `status: DUPLICATE_RETURNED`
- No duplicate prints — guaranteed at service + DB layer

### Fast Print Path Timing
All jobs record: `receivedAt`, `validatedAt`, `queuedAt`, `dispatchedAt`,
`runnerReceivedAt`, `spoolerSentAt`, `printerAckAt`, `completedAt`

Computed latency: `totalLatencyMs`, `validationMs`, `queueWaitMs`, `dispatchMs`, `runnerExecMs`

### Safety
- API key auth for external callers (service accounts with per-caller printer/template allowlists)
- JWT + RBAC for internal dashboard (OWNER / ADMIN / OPERATOR / VIEWER)
- Payload never stored raw — only `payloadSnapshot` (keys + length)
- Auth headers and payloads redacted from Fastify logger
- Copies limit enforced per printer (`maxCopiesPerJob`)
- Template allowlist enforced per printer (`allowedTemplates`)
- All cancellations + config changes audited

### Printer Adapters
- `FakePrinterAdapter` — full implementation (configurable latency/failure)
- `RawTcp9100Adapter` — skeleton for Zebra/POSTEK/raw port 9100
- `WindowsSpoolerAdapter` — skeleton
- `CupsPrinterAdapter` — skeleton
- `IppPrinterAdapter` — skeleton
- `ZplBuilder` — ZPL II command builder helper
- `TsplBuilder` — TSPL command builder helper

### Runner App
- Registers on startup (10 retry attempts with 3s backoff)
- Heartbeat every 10s
- Polls `/runners/:id/poll` every 2s for QUEUED jobs
- Executes via API → adapter registry → printer
- Reports timing + status
- Continues on heartbeat/poll failure (reconnect-ready)

### DB Schema (SQL DDL)
- Migration: `infra/migrations/001_initial_schema.sql`
- Tables: `service_accounts`, `printers`, `printer_status_snapshots`,
  `runners`, `runner_heartbeats`, `print_jobs`, `print_job_events`,
  `print_job_traces`, `audit_logs`, `users`
- Idempotency enforced by UNIQUE index on `(request_id, source_system)`

### Dashboard / Web
- Dashboard: total jobs, runners online, active printers, failed count, avg/p95 latency, recent jobs
- Job Queue: status, printerCode, sourceSystem, latency, priority
- Job Detail: trace timeline with step-by-step timing
- Printers: list with code, protocol, status, maxCopies
- Runners: list with status, heartbeat age, hostname (auto-refreshes 15s)
- Audit Logs: paginated table with action, actor, resource
- Export Center: jobs CSV/JSON, audit CSV, printer status CSV

### Export
- `GET /exports/jobs.csv` — all jobs with fast-path timing columns
- `GET /exports/jobs.json` — full job JSON
- `GET /exports/audit.csv` — audit log CSV
- `GET /exports/printers.csv` — printer list CSV

### Tests: 23/23 pass
- Idempotency (duplicate request_id prevention)
- Different source_system = separate jobs
- Invalid printer_code rejection
- Copies limit enforcement
- Template validation
- Fake printer job success + failure
- Trace timeline with all steps
- Audit log creation
- Latency fields populated
- Job cancellation (valid + invalid state)
- Runner heartbeat updates status

### Build: All packages clean
`npm run build` — 5 packages, zero TypeScript errors

---

## Known Limitations

| Limitation | Impact |
|---|---|
| In-memory storage | All data lost on restart |
| No real password hashing | Any password accepted at `/auth/login` |
| Permission guards not on internal routes | RBAC exists but not wired to `/jobs`, `/printers` |
| RawTcp9100/Windows/CUPS adapters are skeletons | Cannot print to real printers yet |
| In-memory queue | No BullMQ/Redis persistence or distributed workers |

---

## How to Run Locally

```bash
npm install

# API on port 3001
npm run dev -w apps/api

# Local runner
npm run dev -w apps/runner

# Dashboard on port 3000
npm run dev -w apps/web

# Login: admin@printerops.local / any-password
# Dev API key: printops-dev-apikey-2026
```

## How to Test Fake Print (External API)

```bash
export API_KEY="printops-dev-apikey-2026"

curl -X POST http://localhost:3001/api/v1/print-jobs \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "REQ-TEST-001",
    "source_system": "integration-service",
    "printer_code": "LAB_LABEL_01",
    "payload": { "patient": "test", "barcode": "ABC123" },
    "copies": 1,
    "priority": "normal"
  }'

# Trace timeline
curl http://localhost:3001/api/v1/print-jobs/<ID>/trace \
  -H "X-Api-Key: $API_KEY" | jq .steps

# Test idempotency — send same request_id again → DUPLICATE_RETURNED
```

---

See [`docs/status/next-steps.md`](./next-steps.md) for next prompt.
