# External Print API

## Overview

PrintOps does NOT connect to HIS directly. An **external integration program** (owned by a separate team) communicates with HIS and forwards print commands to PrintOps via this API.

PrintOps is a **generic print gateway** — it does not understand HIS business logic.

## Authentication

External callers must authenticate with an **API key** (service account):

```
X-Api-Key: <api_key>
```

API keys are managed per `source_system`. Each service account has:
- Allowed printer codes (empty = all printers allowed)
- Allowed template codes (empty = all templates allowed)
- Max copies per job
- Max payload bytes

## Endpoints

### POST /api/v1/print-jobs

Accept a print job from an external integration program.

**Request:**
```json
{
  "request_id": "REQ-20260707-0001",
  "source_system": "integration-service",
  "source_reference": "ORDER-123456",
  "printer_code": "LAB_LABEL_01",
  "template_code": "default-label",
  "payload": { "patient_name": "...", "barcode": "..." },
  "copies": 1,
  "priority": "normal",
  "metadata": {}
}
```

**Response (201 Created):**
```json
{
  "print_job_id": "uuid",
  "request_id": "REQ-20260707-0001",
  "status": "QUEUED",
  "trace_id": "trace_uuid",
  "accepted_at": "2026-07-07T10:00:00Z",
  "duplicate": false
}
```

**Response (200 OK) — duplicate request_id:**
```json
{
  "print_job_id": "original-uuid",
  "request_id": "REQ-20260707-0001",
  "status": "DUPLICATE_RETURNED",
  "duplicate": true,
  "existing_job_id": "original-uuid"
}
```

`endpoint_code` is an optional body field naming a configured webhook endpoint
that should receive this job's terminal result. Omit it and no result callback
is sent. See [result-callbacks.md](result-callbacks.md).

**Rejections** — every one of these happens *before* anything is printed, and
returns `{ "error": "<CODE>", "message": "…" }`:

| Status | Code | Cause |
|---|---|---|
| 400 | — | `request_id` or `printer_code` missing |
| 401 | — | missing / invalid / inactive `X-Api-Key` |
| 403 | — | `printer_code` outside this service account's allowlist |
| 422 | `TEMPLATE_NOT_FOUND` | `template_code` does not exist or is not `PUBLISHED` |
| 422 | `TEMPLATE_PROFILE_MISSING` | the template's paper profile is gone, so no document can be produced |
| 422 | `RENDER_FAILED` | the renderer raised an error on this payload |
| 422 | `CALLBACK_ENDPOINT_NOT_FOUND` | `endpoint_code` unknown or disabled |
| 403 | `CALLBACK_ENDPOINT_FORBIDDEN` | the endpoint belongs to a different `source_system` |
| 422 | `CALLBACK_DESTINATION_REJECTED` | the resolved callback URL was refused by the SSRF guard |

A **missing payload field** is not a rejection: the job prints with that field
blank and the terminal callback reports it via `data_quality` /
`missing_fields`. A document that cannot be rendered **at all** is a rejection —
PrintOps never falls back to printing the raw payload.

### POST /api/v1/printer/:code_template/:code_profile

The dynamic print route. The printer is resolved from the
`code_template` + `code_profile` binding instead of being named directly; the
body carries `request_id`, `source_system`, `payload`, and optionally
`printer_code` (overrides the binding), `copies`, `priority`, `endpoint_code`.
Same idempotency, same rejection codes, same trace and audit as
`POST /print-jobs`.

### GET /api/v1/print-jobs/:id

Get job details by job ID. The stored payload is redacted — only
`payloadSnapshot` (`keys=[…] len=N`) is exposed, never the raw document.

### GET /api/v1/print-jobs/by-request-id/:requestId?source_system=...

Look up a job by the original `request_id` from the calling system.

### POST /api/v1/print-jobs/:id/cancel

Cancellation is **guaranteed only before dispatch**. Once the document has been
handed to the executor, the physical outcome wins.

| Response | `cancel_outcome` | Meaning |
|---|---|---|
| 200 OK | `CANCELLED` | The job was in `ACCEPTED` / `VALIDATED` / `QUEUED` and is now terminal. It will never print. |
| 202 Accepted | `CANCEL_REQUESTED` | The job was already `DISPATCHED` / `PRINTING`. The request is recorded, but the executor may not stop in time — **keep waiting for the terminal result callback**, which reports what actually happened. |
| 400 | — | The job is already terminal; there is nothing to cancel. |

A best-effort cancel never overwrites the job's status, so a page that printed
is never reported as `CANCELLED`.

### GET /api/v1/print-jobs/:id/trace

Get full trace timeline for a job.

### GET /api/v1/printers

List active printers and their codes.

### GET /api/v1/printers/:id/status

Get current status of a specific printer.

## Idempotency

`request_id` + `source_system` is unique. Sending the same request twice will NOT create a duplicate job or trigger a duplicate print. The original job is returned with `status: DUPLICATE_RETURNED`.

## Job statuses a caller will see

`ACCEPTED` → `VALIDATED` → `QUEUED` → `DISPATCHED` → `PRINTING` → terminal.

Terminal: `SUCCESS`, `UNVERIFIED`, `TIMEOUT`, `FAILED`, `CANCELLED`
(plus `DUPLICATE_RETURNED`, which is an acceptance outcome, not a print one).

**`UNVERIFIED` and `TIMEOUT` both mean a page may physically exist** — the
device could not confirm the job, or nothing came back before the watchdog
expired. Neither is a failure and neither is safe to reprint automatically.
A caller that switches only on `SUCCESS`/`FAILED` will mishandle them.

See [job-lifecycle.md](job-lifecycle.md) for the full state machine.

## Priority Levels

| Value | Weight | Use Case |
|-------|--------|----------|
| urgent | 100 | Emergency / STAT orders |
| high | 75 | Routine clinical orders |
| normal | 50 | Standard operations (default) |
| low | 25 | Batch / background prints |

## Dev Testing

```bash
# API key for dev environment
export API_KEY="printops-dev-apikey-2026"

# Create a print job
curl -X POST http://localhost:3001/api/v1/print-jobs \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "REQ-TEST-001",
    "source_system": "integration-service",
    "printer_code": "LAB_LABEL_01",
    "payload": { "label": "test" },
    "copies": 1,
    "priority": "normal"
  }'
```
