# Runner Contract

This document defines the contract between PrintOps runners (TypeScript and Go) and the API.

## Authentication

| Method | Header | Notes |
|---|---|---|
| Bearer JWT | `Authorization: Bearer <token>` | Preferred |
| Dev Login | POST `/api/v1/auth/login` | Returns `{ token }`; fallback when `PRINTOPS_RUNNER_TOKEN` is unset |

## Endpoints

### Register

```
POST /api/v1/runners/register
Authorization: Bearer <token>
Content-Type: application/json

Request:
{
  "runner_id": "go-runner-01",       // optional; server assigns if omitted
  "name": "Lab Go Runner",
  "hostname": "LAB-PC-01",
  "os": "windows",
  "arch": "amd64",
  "version": "0.1.0-mvp",
  "started_at": "2025-07-08T10:00:00Z",
  "capabilities": ["RAW_TCP_9100", "FAKE"],
  "local_ip": "192.168.1.50",        // best effort
  "status": "ONLINE",
  "supportedProtocols": ["RAW_TCP_9100"],
  "metadata": { "discovery_mode": "fake", "executor_mode": "fake" }
}

Response (200):
{
  "id": "runner-uuid-123",
  "name": "Lab Go Runner",
  "hostname": "LAB-PC-01",
  "status": "ONLINE"
}
```

### Heartbeat

```
POST /api/v1/runners/:runnerId/heartbeat
Authorization: Bearer <token>

Request:
{
  "timestamp": "2025-07-08T10:00:15Z",
  "uptime_seconds": 15,
  "memory_mb": 12.5,
  "discovery_mode": "fake",
  "executor_mode": "fake",
  "last_job_at": "2025-07-08T09:59:00Z",  // nullable
  "last_error": ""                         // nullable; last error if any
}

Response: 200 OK (empty body)
```

### Discovery Sync

```
POST /api/v1/runners/:runnerId/printers/discovery
Authorization: Bearer <token>

Request:
{
  "runner_id": "runner-uuid-123",
  "computer_name": "LAB-PC-01",
  "os": "windows",
  "discovered_at": "2025-07-08T10:00:00Z",
  "items": [
    {
      "local_printer_id": "LAB_LABEL_01",
      "name": "LAB_LABEL_01",
      "display_name": "Lab Label Printer 01",
      "driver_name": "Zebra ZD230",
      "port_name": "IP_10.0.0.50",
      "uri": "socket://10.0.0.50:9100",
      "status": "IDLE",
      "is_default": true,
      "is_shared": false,
      "share_name": "",
      "location": "Lab Room 1",
      "comment": "",
      "connection_type": "NETWORK",
      "raw": { /* platform-specific raw data */ }
    }
  ]
}

Response: 200 OK
```

### Job Next (Claim)

```
POST /api/v1/runners/:runnerId/jobs/next
Authorization: Bearer <token>

Request:
{
  "wait_ms": 500    // long-poll hint; 0 = return immediately
}

Response (200 with job):
{
  "job": {
    "id": "job-uuid-456",
    "status": "QUEUED",
    "printer_code": "LAB_LABEL_01",
    "printer_name": "Lab Label Printer 01",
    "payload": "base64...",      // safe message only; sensitive data omitted
    "copies": 1,
    "priority": 5,
    "trace_id": "trace-uuid-789",
    "created_at": "2025-07-08T09:59:00Z"
  }
}

Response (204 No Content):
// No job available
```

### Job Event (Trace)

```
POST /api/v1/runners/:runnerId/jobs/:jobId/events
Authorization: Bearer <token>

Request:
{
  "event_type": "RUNNER_EXECUTION_STARTED",
  "trace_id": "trace-uuid-789",
  "job_id": "job-uuid-456",
  "runner_id": "runner-uuid-123",
  "timestamp": "2025-07-08T10:00:01Z",
  "duration_ms": null,       // optional; present for timing events
  "status": "started",
  "safe_message": "execution started for fake executor",
  "evidence": {              // non-sensitive evidence only
    "executor": "fake"
  }
}

Response: 200 OK
```

### Job Result

```
POST /api/v1/runners/:runnerId/jobs/:jobId/result
Authorization: Bearer <token>

Request:
{
  "trace_id": "trace-uuid-789",
  "job_id": "job-uuid-456",
  "runner_id": "runner-uuid-123",
  "status": "SUCCESS",         // SUCCESS | FAILED
  "executor": "fake",
  "duration_ms": 150,
  "error_code": "",            // present on FAILED
  "error_message": "",         // present on FAILED
  "evidence": {
    "executor": "fake",
    "message": "fake print completed",
    "duration_ms": 150
  },
  "timing": {
    "poll_started_at": "...",
    "job_received_at": "...",
    "execution_started_at": "...",
    "execution_finished_at": "...",
    "result_reported_at": "..."
  }
}

Response: 200 OK
```

### Legacy Execution Report (Backward Compat)

```
POST /api/v1/jobs/:jobId/execute
Authorization: Bearer <token>

Request:
{
  "runnerId": "runner-uuid-123"
}

Response: 200 OK
```

## Event Types

| Event | Status | Description |
|---|---|---|
| `RUNNER_JOB_RECEIVED` | `received` | Job claimed from queue |
| `RUNNER_EXECUTION_STARTED` | `started` | Executor about to run |
| `FAKE_SPOOLER_SENT` | `spooler_sent` | Fake: payload "sent" to spooler |
| `FAKE_PRINTER_ACK` | `printer_ack` | Fake: printer "acknowledged" |
| `RUNNER_SPOOLER_SENT` | `spooler_sent` | Real: payload sent to spooler/socket |
| `RUNNER_PRINTER_ACK` | `printer_ack` | Real: printer acknowledged |
| `RUNNER_EXECUTION_SUCCEEDED` | `succeeded` | Job completed |
| `RUNNER_EXECUTION_FAILED` | `failed` | Job failed |

## Status Codes

| Runner Status | Job Status | Result Status |
|---|---|---|
| `ONLINE` | `QUEUED` | `SUCCESS` |
| `OFFLINE` | `ASSIGNED` | `FAILED` |
| `BUSY` | `PRINTING` | |
| `ERROR` | `DONE` | |
| | `FAILED` | |

## Backward Compatibility

All new endpoints are additive. The TypeScript runner's existing endpoints and behavior are unchanged. Both runners can coexist and poll the same API concurrently.