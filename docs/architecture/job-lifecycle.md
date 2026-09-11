# Job Lifecycle

The authoritative status vocabulary is `JOB_STATUSES` in
`packages/domain/src/models/job.ts`. Everything below describes that enum; if
this document and the enum disagree, the enum is right.

## State machine

```
              ┌──────────┐
              │ ACCEPTED │  job row created, request_id recorded
              └────┬─────┘
                   ▼
              ┌───────────┐
              │ VALIDATED │  printer / copies / template checked
              └────┬──────┘
                   ▼
              ┌────────┐
              │ QUEUED │  in the priority queue, durable in SQLite mode
              └───┬────┘
                  ▼  conditional claim — exactly one claimant wins
            ┌────────────┐
            │ DISPATCHED │  handed to an executor; document not yet on the wire
            └─────┬──────┘
                  ▼  adapter reports SPOOLER_ACCEPTED
            ┌──────────┐
            │ PRINTING │  the document is with the printing subsystem
            └────┬─────┘
                 │
   ┌─────────────┼──────────────┬──────────────┐
   ▼             ▼              ▼              ▼
SUCCESS     UNVERIFIED       TIMEOUT        FAILED
```

`CANCELLED` is reachable only from `ACCEPTED` / `VALIDATED` / `QUEUED`.
`DUPLICATE_RETURNED` is an intake outcome returned to the caller; it is never a
stored state a job transitions through.

## Terminal statuses

| Status | Meaning | Safe to auto-retry? |
|---|---|---|
| `SUCCESS` | The device confirmed the output. | n/a |
| `UNVERIFIED` | Sent, no fault reported, but no device channel could tie evidence to **this** job. | **No** — a page may exist |
| `TIMEOUT` | Reached the spooler, then nothing came back at all before the execution watchdog expired. | **No** — a page may exist |
| `FAILED` | A real, attributable failure. Nothing printed, or the failure happened before submission. | Yes, as a new job |
| `CANCELLED` | Stopped before dispatch. Never printed. | n/a |

The distinction between `UNVERIFIED` and `TIMEOUT` is *what came back*, not how
long it took: `UNVERIFIED` means the device answered but could not be
correlated; `TIMEOUT` means silence.

`UNVERIFIED`, `TIMEOUT`, `SUCCESS`, `CANCELLED`, `DUPLICATE_RETURNED`,
`DISPATCHED` and `PRINTING` are all in `NON_EXECUTABLE_STATUSES`
(`services/execute-job.service.ts`) — executing any of them is refused, because
each either already produced a page or may have. Reprinting one of these is an
explicit operator action that creates a **new** job, gated by the duplicate-risk
acknowledgement in the reprint dialog.

## Guarantees at each hop

**Intake → `QUEUED`.** Idempotency on `(request_id, source_system)`: a repeat
submission returns the original job as `DUPLICATE_RETURNED` and prints nothing.
A job that cannot produce a document (unknown template, missing paper profile,
renderer exception) never reaches `QUEUED` — it is rejected 4xx over HTTP and
dead-lettered over NATS.

**`QUEUED` → `DISPATCHED`.** A conditional `claim()`, not a read-then-write. Two
racing claimants (a double-clicked Print button, the local worker and a runner
drawing on the same queue) cannot both proceed; the loser gets a conflict.

**`DISPATCHED` → `PRINTING`.** Driven by the adapter's `SPOOLER_ACCEPTED`
progress callback, so `PRINTING` means the document actually reached the
printing subsystem rather than "we started trying".

**`PRINTING` → terminal.** For the Windows spooler path, spooler acceptance
alone is not success: without device confirmation (SNMP page counter or a
correlated IPP job) the verdict is `UNVERIFIED`, never `SUCCESS`.

**The watchdog.** Every adapter execution is bounded by
`PRINTOPS_EXECUTE_TIMEOUT_MS` (default 180 s, mirroring the Go runner). If it
expires after the spooler accepted the job the verdict is `TIMEOUT`; if before,
`FAILED` with `EXECUTION_TIMEOUT`. Either way the job reaches a terminal state
and emits its terminal event, so no accepted job can hang forever.

## Every terminal state emits an event

`emitPrintJobTerminal()` publishes `PrintJobTerminal` **after** the terminal
state is durably persisted. Emitting sites:

| Site | File |
|---|---|
| in-process executor, success | `services/execute-job.service.ts` |
| in-process executor, failure / unverified / timeout | `services/execute-job.service.ts` (`handleFailure`) |
| Go runner result endpoint | `routes/v1/runner-jobs.routes.ts` |
| operator cancel (pre-dispatch only) | `services/cancel-job.service.ts` |
| restart recovery of an ambiguous job | `app.ts` |

This is what makes "every accepted job has a terminal result the caller hears
about" true rather than aspirational. `ResultCallbackDispatcher` subscribes to
this event; see [result-callbacks.md](result-callbacks.md).

## Restart recovery

A desktop restart mid-flight is resolved by status, on the principle that a
page already on the wire must never be reprinted automatically:

| Status at restart | Action |
|---|---|
| `ACCEPTED`, `VALIDATED` | Completed to `QUEUED` — nothing was submitted yet, so this is safe. |
| `QUEUED` | Re-enqueued in the in-memory queue from the persisted row. |
| `DISPATCHED`, `PRINTING` | Closed as `UNVERIFIED` with `RECOVERY_PRINT_STATUS_UNKNOWN`, **not replayed**, and a terminal event is emitted so waiting callers are released. |

## Cancellation

Guaranteed before dispatch (via the same conditional claim, so it cannot race a
worker into overwriting a dispatched job); best-effort after, where the request
is recorded in `metadata.cancelRequested` and the executor's real verdict wins.
See [external-print-api.md](external-print-api.md) for the HTTP contract.
