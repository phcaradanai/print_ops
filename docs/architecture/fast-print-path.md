# Fast Print Path

## Performance Target

| Stage | Target |
|-------|--------|
| API accept (POST /api/v1/print-jobs) | < 200ms |
| Runner receives job from queue | < 1-2s (local network) |
| Label job starts printing (printer ready) | < 2-5s end-to-end |

## Timing Points

Every job records the following timestamps:

```
received_at        → API receives the HTTP request
validated_at       → Printer code resolved, copies/template validated
queued_at          → Job enqueued for runner pickup
dispatched_at      → Runner claimed the job
runner_received_at → Runner acknowledged (currently same as dispatched_at)
spooler_sent_at    → Adapter started sending to printer/spooler
printer_ack_at     → Printer acknowledged receipt
completed_at       → Job in SUCCESS or FAILED state
```

## Computed Latency Fields

Each completed job has a `latency` object:

```json
{
  "validationMs":   5,
  "queueWaitMs":    320,
  "dispatchMs":     2,
  "runnerExecMs":   85,
  "spoolerMs":      null,
  "printerAckMs":   0,
  "totalLatencyMs": 412
}
```

`totalLatencyMs = completed_at - received_at`

## Performance-Critical Code Path

```
[External Caller]
       ↓  HTTP POST /api/v1/print-jobs
[API: AcceptExternalJobService]
       ↓  idempotency check (in-memory: O(1), Postgres: index lookup)
       ↓  printer lookup by code (in-memory: O(n), Postgres: index)
       ↓  validation (copies, template)  → validatedAt
       ↓  enqueue (in-memory queue)      → queuedAt
[Runner: poll /runners/:id/poll]
       ↓  picks up QUEUED job            → dispatchedAt
[API: ExecuteJobService]
       ↓  adapter.executeCommand()       → spoolerSentAt, printerAckAt
       ↓  update job to SUCCESS          → completedAt
```

## Label Printer Path (Zebra / POSTEK / raw-tcp-9100)

For label printers on port 9100:
1. Runner opens TCP socket to `<printer_ip>:9100`
2. Sends raw ZPL or TSPL bytes
3. Closes connection
4. Reports success

Typical end-to-end for a single ZPL label: **< 500ms** on 100Mbps LAN.

## Bottlenecks to Monitor

- `queueWaitMs` high → runner is slow to poll or overloaded
- `dispatchMs` high → network latency between API and runner (should be < 5ms on LAN)
- `runnerExecMs` high → adapter/printer issue (paper, toner, sleep mode)
- `validationMs` high → too many printers in repo (add code index)
