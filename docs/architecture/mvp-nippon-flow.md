# MVP Nippon — End-to-End Flow

## Overview

The MVP Nippon phase establishes the complete print job lifecycle: from an external integration program calling the API, through the queue, to a local runner executing the job on a printer.

PrintOps does **NOT** connect to HIS directly. An external integration program (built by the HIS/clinical team) is responsible for constructing print jobs and calling PrintOps.

---

## Architecture Diagram

```
[HIS / Clinical System]
        |
        | (out of scope for PrintOps)
        ▼
[External Integration Program]
        |
        | POST /api/v1/print-jobs
        | X-Api-Key: <service-account-key>
        ▼
┌─────────────────────────────────────────────────────┐
│                   PrintOps API                      │
│                                                     │
│  1. Authenticate (X-Api-Key → ServiceAccount)       │
│  2. Idempotency check (request_id + source_system)  │
│  3. Validate (printer_code, copies, template_code)  │
│  4. Create Job (status: ACCEPTED → VALIDATED → QUEUED) │
│  5. Add to InMemoryQueue (priority-sorted)          │
│  6. Record trace step + audit log                   │
│                                                     │
│  ┌─────────────────────────────────────────┐        │
│  │           In-Memory Queue               │        │
│  │  QUEUED jobs sorted by priority weight  │        │
│  └─────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘
        ▲                │
        │                │ GET /runners/:id/poll
        │                │ (returns next QUEUED job)
        │                ▼
┌──────────────────────────────────┐
│         Local Runner             │
│                                  │
│  - Registers on startup          │
│  - Sends heartbeat every 10s     │
│  - Polls API every 2s            │
│  - On job: POST /jobs/:id/execute│
└──────────────────────────────────┘
        │
        │ (API executes adapter on behalf of runner)
        ▼
┌──────────────────────────────────┐
│       Printer Adapter            │
│   FakePrinterAdapter (MVP)       │
│   RawTcp9100Adapter (skeleton)   │
│   WindowsSpoolerAdapter (skeleton)│
└──────────────────────────────────┘
```

---

## Job Status Flow

```
POST /api/v1/print-jobs received
        │
        ▼
   ACCEPTED         ← job created, request_id recorded
        │
        ▼
   VALIDATED        ← printer_code verified, copies OK, template OK
        │
        ▼
   QUEUED           ← placed in priority queue
        │
        ▼ (runner polls)
   DISPATCHED       ← runner picked up job, adapter starting
        │
        ▼
   PRINTING         ← adapter sent bytes to printer
        │
      ┌─┴─────────────────┐
      ▼                   ▼
   SUCCESS            FAILED / TIMEOUT
```

Terminal states: `SUCCESS`, `FAILED`, `TIMEOUT`, `CANCELLED`, `DUPLICATE_RETURNED`

---

## Idempotency Flow

```
POST /api/v1/print-jobs
  request_id: "REQ-20260707-0001"
  source_system: "integration-service"
        │
        ▼
  jobs.findByRequestId("REQ-20260707-0001", "integration-service")
        │
  ┌─────┴──────────────────┐
  │ found?                 │ not found?
  ▼                        ▼
return existing job    create new job
status: DUPLICATE_RETURNED   status: ACCEPTED → QUEUED
duplicate: true              duplicate: false
HTTP 200                     HTTP 201
```

The uniqueness constraint (`request_id` + `source_system`) is enforced at:
- Service layer (in-memory check, O(1))
- DB layer: `UNIQUE INDEX` on `(request_id, source_system) WHERE request_id IS NOT NULL`

---

## Fast Print Path Timing

Every job records a full timing trace:

| Field | Recorded When |
|-------|--------------|
| `receivedAt` | API receives POST request |
| `validatedAt` | Printer/copies/template validation passes |
| `queuedAt` | Job placed in queue |
| `dispatchedAt` | Runner picks up job |
| `runnerReceivedAt` | Adapter begins execution |
| `spoolerSentAt` | Bytes sent to printer spooler |
| `printerAckAt` | Printer acknowledged receipt |
| `completedAt` | Job reaches terminal state |

Computed fields: `totalLatencyMs`, `validationMs`, `queueWaitMs`, `dispatchMs`, `runnerExecMs`, `spoolerMs`, `printerAckMs`

---

## Trace and Audit

Every state transition records:

**Trace Step** (in `print_job_traces`):
```json
{
  "stepName": "job_dispatched",
  "startedAt": "2026-07-07T11:00:00.001Z",
  "finishedAt": "2026-07-07T11:00:00.002Z",
  "durationMs": 1,
  "status": "success",
  "outputSummary": "adapter=FakePrinterAdapter protocol=fake"
}
```

**Audit Log** (in `audit_logs`):
```json
{
  "action": "job.succeeded",
  "actorId": "runner-001",
  "resourceType": "job",
  "resourceId": "job-abc123",
  "timestamp": "2026-07-07T11:00:00.002Z",
  "details": { "adapter": "FakePrinterAdapter", "latencyMs": 45 }
}
```

---

## Safety Boundaries

1. **API Key Auth** — every external call requires `X-Api-Key` header
2. **Printer Allowlist** — `ServiceAccount.allowedPrinterCodes` restricts which printers a caller can use (empty = all allowed)
3. **Copies Limit** — `Printer.maxCopiesPerJob` enforced per job
4. **Template Allowlist** — `Printer.allowedTemplates` restricts which templates a printer accepts
5. **Payload Never Stored Raw** — only `payloadSnapshot` (`keys=[...] len=N`) saved to DB
6. **No Secrets in Logs** — Fastify logger redacts `Authorization`, `X-Api-Key`, `body.payload`
7. **Duplicate Print Prevention** — idempotency guarantee means same order never prints twice

---

## How to Run Locally

```bash
npm install

# Terminal 1: API server (port 3001)
npm run dev -w apps/api

# Terminal 2: Local runner (Go — the only runner)
cd apps/runner-go && go run ./cmd/printops-runner run
# Auto-logins with dev credentials if PRINTOPS_RUNNER_TOKEN is not set

# Terminal 3: Dashboard (port 3000)
npm run dev -w apps/web
```

### Send a Test Print Job

```bash
curl -X POST http://localhost:3001/api/v1/print-jobs \
  -H "X-Api-Key: printops-dev-apikey-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "REQ-20260707-0001",
    "source_system": "integration-service",
    "printer_code": "LAB_LABEL_01",
    "payload": { "patient": "Test Patient", "barcode": "ABC123" },
    "copies": 1,
    "priority": "normal"
  }'

# Resend same request → returns DUPLICATE_RETURNED (no second print)
```

### View Trace Timeline

```bash
curl http://localhost:3001/api/v1/print-jobs/<JOB_ID>/trace \
  -H "X-Api-Key: printops-dev-apikey-2026" | jq .steps
```

---

## Status of this document

The flow above is still accurate in shape. The gaps this section used to list
have since been closed — as of 2026-08-03:

| Component | Then | Now |
|-----------|------|-----|
| Storage | In-memory only | SQLite (`sql.js`) with an exclusive lock, atomic saves, versioned migrations, and archive-before-prune retention. In-memory remains the test default. |
| Printer adapters | Fake only | Windows spooler adapter with SNMP/IPP verification is the production executor; a WebView2 helper renders HTML through the real driver. |
| Queue | In-memory priority queue | Still in-memory **by design** — but `QUEUED` jobs are persisted and re-enqueued at boot. No Redis/BullMQ. |
| Runner execution | Delegated to the API | The API's in-process local worker is the sole executor in the packaged desktop; the Go runner does discovery and heartbeat only. |
| Password hashing | Any password accepted | Salted scrypt, with first-run OWNER bootstrap. |
| RBAC enforcement | Not wired to routes | `requirePermission()` guards the dashboard routes; service accounts carry printer/template allowlists. |

Two things this document still describes optimistically:

- **The status flow diagram omits `UNVERIFIED` and `TIMEOUT`.** Both are real
  terminal states meaning a page may physically exist. See
  [job-lifecycle.md](job-lifecycle.md) for the state machine that is actually
  implemented.
- **The "How to Run Locally" section references `apps/runner`**, which no longer
  exists. Use `npm run dev` at the repo root, or
  `cd apps/runner-go && go run ./cmd/printops-runner run`.

What remains genuinely unproven is not in this file: it is the physical printer,
clean-install and cross-machine evidence tracked in
[../production/PROD-01-gap-table.md](../production/PROD-01-gap-table.md).
