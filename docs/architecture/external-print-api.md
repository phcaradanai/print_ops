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

### GET /api/v1/print-jobs/:id

Get job details by job ID.

### GET /api/v1/print-jobs/by-request-id/:requestId?source_system=...

Look up a job by the original `request_id` from the calling system.

### POST /api/v1/print-jobs/:id/cancel

Cancel a job in `ACCEPTED`, `VALIDATED`, `QUEUED`, or `DISPATCHED` status.

### GET /api/v1/print-jobs/:id/trace

Get full trace timeline for a job.

### GET /api/v1/printers

List active printers and their codes.

### GET /api/v1/printers/:id/status

Get current status of a specific printer.

## Idempotency

`request_id` + `source_system` is unique. Sending the same request twice will NOT create a duplicate job or trigger a duplicate print. The original job is returned with `status: DUPLICATE_RETURNED`.

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
