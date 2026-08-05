# Terminal print-result callbacks

How PrintOps tells the system that asked for a print what actually happened to it.

---

## 1. Acceptance is not a result

There are **two** different callbacks, and conflating them was the original defect.

| | `print.job.accepted` | `print.job.completed` |
|---|---|---|
| Fired when | the job is queued | the print reaches a terminal state |
| Carries | `status: "QUEUED"` | `print_status: SUCCESS \| FAILED \| UNVERIFIED \| TIMEOUT \| CANCELLED` |
| Sent by | `DynamicIntakeService` / `DynamicPrintService` via `WebhookCallbackService` | `ResultCallbackDispatcher` |
| Retries | no (best-effort, single shot) | yes (bounded, persisted) |
| Delivery record | attempt log only | durable `CallbackDelivery` |

**Every job with a resolvable callback destination receives `print.job.completed`**
with its real final status — the terminal result is never optional once a
destination was configured. `callbackOnPrintResult` only decides whether the
`print.job.accepted` notification *also* fires:

- `callbackOnPrintResult = false` (default) → acceptance notification AND the
  terminal result. The caller hears about the print twice: once when it is
  queued, once when it terminates.
- `callbackOnPrintResult = true` → terminal result only. No acceptance
  notification.

The one exception is a **duplicate** submission: it creates no new print, so it
can never produce a terminal result. Duplicates always get the acceptance
notification, whatever the toggle says, so the caller is not left waiting on a
result that cannot arrive.

The toggle is read in exactly one place — `wantsAcceptanceCallback()` /
`wantsTerminalCallback()` in `callback-intent.service.ts` — so no intake path
can develop its own interpretation of it. The terminal-result intent is enabled
whenever a destination resolved, regardless of the toggle; `callbackOnPrintResult`
only ever silences the acceptance callback.

Acceptance callbacks fire for `POST /api/v1/intake/:endpointCode`, for
`POST /api/v1/printer/:code_template/:code_profile`, and for the NATS
print-intake envelope — the latter two identified by an optional
`endpoint_code`. `POST /api/v1/print-jobs` gets terminal callbacks only.

## 2. Flow

```
print request accepted
  └─ callback intent resolved + persisted WITH the job   (accept time)
     └─ job queued → dispatched → executed
        └─ terminal job state persisted
           └─ PrintJobTerminal published                 (exactly once)
              └─ ResultCallbackDispatcher (EventBus subscriber)
                 ├─ reads the persisted intent off the job
                 ├─ createIfAbsent(CallbackDelivery)     (idempotency point)
                 ├─ dispatch over HTTP and/or NATS
                 ├─ persist outcome + every attempt
                 └─ schedule a retry when applicable
                    └─ retry sweep (5s interval) picks up due deliveries
```

### Terminal event

`PrintJobTerminal` (`packages/domain/src/events/index.ts`) is emitted from
**every** site that can move a job to a terminal status, through the single
helper `emitPrintJobTerminal()`:

| Site | File |
|---|---|
| in-process / desktop executor, success | `services/execute-job.service.ts` |
| in-process / desktop executor, failure | `services/execute-job.service.ts` (`handleFailure`) |
| Go runner result endpoint | `routes/v1/runner-jobs.routes.ts` |
| operator cancel | `services/cancel-job.service.ts` |

Emitting from only the first two would make the E2E matrix pass under
`PRINTOPS_LOCAL_WORKER` while the real Go-runner deployment never fired a single
callback.

It is emitted **only after** the terminal state is durably persisted — the
subscriber reads the job back to resolve its intent.

### Terminal statuses

`SUCCESS`, `FAILED`, `UNVERIFIED`, `TIMEOUT`, `CANCELLED`.

`UNVERIFIED` is **never** flattened into `FAILED`. This codebase is built around
"could not confirm ≠ did not print": a page may physically exist, and telling an
integrator it failed invites a duplicate reprint of a patient or specimen label.

`TIMEOUT` belongs to the same may-have-printed family as `UNVERIFIED`, and the
two are distinguished by *what came back*, not by how long it took:

| Status | Meaning |
|---|---|
| `UNVERIFIED` | The device answered, but no evidence could be tied to **this** job. |
| `TIMEOUT` | The document reached the spooler and **nothing came back at all** before the execution watchdog expired (`PRINTOPS_EXECUTE_TIMEOUT_MS`, default 180 s). |

A receiver must treat both identically: a page may exist, so an automatic
reprint is unsafe. PrintOps enforces the same rule internally — both statuses
are non-executable, so re-running the job is refused and a reprint has to be a
deliberate new job.

`DUPLICATE_RETURNED` is not in this list — it is an acceptance outcome, not a
print outcome.

`CANCELLED` only ever means the job was stopped **before dispatch**. A cancel
requested after dispatch is best-effort and does not produce this status by
itself; see §5.1.

## 3. Callback intent (why it is persisted)

`JobCallbackIntent` lives in `job.metadata.callbackIntent` and is written once,
when the job is accepted.

```ts
{
  enabled: true,
  trigger: 'PRINT_RESULT',
  transports: ['HTTP'],
  endpointId, endpointCode,
  httpUrl: 'https://receiver.example/results',   // literal, already resolved
  natsSubject: 'medisync.results.c1',
  natsMode: 'CORE',
  disabledReason: undefined,
}
```

Three properties matter:

1. **Destinations are literals, not templates.** `callbackUrl` /
   `callbackNatsSubject` may be `$.reply_url`, which resolves against the
   *intake payload*. That payload does not exist at terminal time — only a
   redacted `payloadSnapshot` does. So resolution happens at accept time.
2. **It is a snapshot.** Editing the endpoint afterwards does not redirect
   results for prints already on the wire.
3. **A disabled intent is still stored**, with `disabledReason`, so the Job
   Detail page can say *why* nothing was delivered instead of showing a blank.

It rides in `job.metadata` rather than a dedicated column because `metadata` is
already a JSON blob that round-trips through both the in-memory and the SQLite
job repositories — no migration, and no way for the two DB modes to diverge.

## 4. Configuring a callback per intake path

| Path | How the endpoint is identified |
|---|---|
| `POST /api/v1/intake/:endpointCode` | the path segment (unchanged) |
| `POST /api/v1/print-jobs` | optional `endpoint_code` in the body |
| `POST /api/v1/printer/:tpl/:profile` | optional `endpoint_code` in the body |
| NATS envelope | optional `endpoint_code` field |

### NATS envelope (backward compatible)

```json
{
  "target_client_id": "client-a",
  "request_id": "req-001",
  "source_system": "medisync",
  "code_template": "TEST_LABEL",
  "code_profile": "LABEL_100X50",
  "printer_code": "OFFICE_LASER_01",
  "payload": { "label": "…", "reply_to": "medisync.results.client-a" },
  "endpoint_code": "MEDISYNC_RESULT_CALLBACK"
}
```

`endpoint_code` is **optional**. Publishers that never send it behave exactly as
before and get no result callback — this is the compatibility decision, taken
because the envelope previously carried no callback reference at all and every
existing publisher predates the field.

Validation happens **before anything prints**, because a physical page cannot be
un-printed:

| Condition | Response |
|---|---|
| endpoint does not exist / is disabled | `422 CALLBACK_ENDPOINT_NOT_FOUND` |
| `endpoint.sourceSystem ≠ source_system` | `403 CALLBACK_ENDPOINT_FORBIDDEN` |
| destination rejected by the SSRF guard | `422 CALLBACK_DESTINATION_REJECTED` |

Over NATS these are 4xx `AppError`s, so the consumer dead-letters the message
rather than retrying a poison envelope.

## 5. Payload contract

```json
{
  "version": 1,
  "event_id": "4a64b91e-…",
  "event_type": "print.job.completed",
  "occurred_at": "2026-07-27T06:42:45.347Z",

  "request_id": "req-001",
  "job_id": "131a33aa-…",
  "source_system": "medisync",

  "print_status": "SUCCESS",
  "data_quality": "OK",
  "missing_fields": [],
  "render_warnings": [],

  "printer_code": "OFFICE_LASER_01",
  "runner_id": "desktop-local-worker",

  "error": null,
  "trace_id": "trace_1c3bb5c3-…",

  "timeline": {
    "accepted_at": "2026-07-27T06:42:45.100Z",
    "queued_at":   "2026-07-27T06:42:45.110Z",
    "started_at":  "2026-07-27T06:42:45.180Z",
    "terminal_at": "2026-07-27T06:42:45.347Z"
  },

  "delivery": { "transports": ["HTTP"], "nats_mode": null }
}
```

Failure:

```json
{
  "print_status": "FAILED",
  "error": { "code": "PRINTER_OFFLINE", "message": "The selected printer was offline." }
}
```

- **Identical over HTTP and NATS.** The same JSON body, byte for byte.
- **No print payload.** A callback is a notification, not a copy of the document.
- **HTTP headers**: `X-PrintOps-Event-Id`, `X-PrintOps-Delivery-Id`,
  `X-PrintOps-Event-Type`.
- **`event_id` is stable across retries** — dedupe on it.

### 5.1 Data completeness — `data_quality`

A print can succeed physically while the data on it was incomplete. Reporting
that as a bare `SUCCESS` tells the caller their data was fine, which is a lie
the caller then builds on. Three fields carry the truth alongside the status:

| Field | Values |
|---|---|
| `data_quality` | `"OK"` — every template field resolved. `"WITH_WARNINGS"` — the document rendered, but the renderer reported at least one problem. |
| `missing_fields` | Field keys the payload did not supply, e.g. `["hn", "barcode"]`. They printed as blanks. |
| `render_warnings` | Every raw render warning, including non-missing-field ones such as an unrenderable barcode value. |

```json
{
  "print_status": "SUCCESS",
  "data_quality": "WITH_WARNINGS",
  "missing_fields": ["hn"],
  "render_warnings": ["Missing field: hn"]
}
```

This is deliberately **two orthogonal fields, not a `SUCCESS_WITH_WARNING`
status** (decision 2026-08-03). `print_status` is the canonical vocabulary that
the database, the queue filter, the dashboard badges and every integrator
already switch on; adding members to it to express a second dimension would
break all of them. `SUCCESS` + `WITH_WARNINGS` and `UNVERIFIED` + `WITH_WARNINGS`
compose naturally.

**A caller that treats `data_quality: "WITH_WARNINGS"` as a plain success is
choosing to ignore it.** Both fields are always present, so the check is
`print_status === 'SUCCESS' && data_quality === 'OK'`.

What does *not* reach a callback at all: a template that cannot render **at
all**. A renderer exception or a template whose paper profile is missing is
rejected at intake (`422 RENDER_FAILED` / `422 TEMPLATE_PROFILE_MISSING`), no
job is created, and nothing prints — printing the raw payload and calling it a
success is exactly the failure this prevents. Missing *fields* print; a missing
*document* does not.

### `callbackPayloadTemplate` does not apply here

The endpoint's `callbackPayloadTemplate` shapes the **acceptance** callback only.
Terminal result callbacks always use the fixed envelope above.

That is deliberate: a result callback is a contract every receiver parses the
same way, and a per-endpoint template would make `print_status` optional in
practice. The Webhooks page warns about it when result callbacks are enabled, so
an operator does not configure a template that is then quietly ignored.

If a receiver needs extra fields, add them to the versioned envelope and bump
`version` — do not reintroduce per-endpoint shaping.

## 6. Delivery model

`CallbackDelivery` (SQLite table `callback_deliveries`, or the in-memory
repository) is **durable business data**, separate from the 500-entry
`WebhookCallbackAttempt` ring buffer, which remains the per-attempt diagnostic
child record. A ring buffer cannot be a retry worker's source of truth: "restart
with a pending delivery" would silently lose work.

```
PENDING ──> DELIVERING ──> DELIVERED
                │
                ├──> RETRY_SCHEDULED ──> DELIVERING …
                └──> FAILED
SKIPPED
```

Indexed on `(print_job_id, transport, target)` (UNIQUE), `print_job_id`,
`request_id`, `event_id`, `delivery_status`, `next_attempt_at`.

Terminal deliveries are pruned alongside the jobs they belong to by the
retention sweep (default 14-day hot window), which archives every row it prunes
to `<db dir>/archive` as timestamped JSON before deleting it.

### Print status vs delivery status

They are different fields and different questions:

```
Print result:    SUCCESS
Result delivery: FAILED after 5 attempts
```
```
Print result:    FAILED
Result delivery: DELIVERED
```

## 7. HTTP retry policy

| Attempt | Delay before it |
|---|---|
| 1 | immediate |
| 2 | ~5 s |
| 3 | ~30 s |
| 4 | ~2 min |
| 5 | ~10 min |

±20 % jitter, so a batch of callbacks that failed together does not retry in
lockstep. Configurable with `WEBHOOK_CALLBACK_MAX_ATTEMPTS` and
`WEBHOOK_CALLBACK_TIMEOUT_MS` (default 10 s per request).

| Outcome | Retried? |
|---|---|
| connection refused / DNS / TLS / socket reset | yes |
| request timeout | yes |
| HTTP 408, 429 | yes |
| HTTP 5xx | yes |
| other HTTP 4xx | **no** — permanent, fails immediately |
| SSRF-rejected destination | **no** — waiting will not make it legitimate |

Nothing sleeps. The policy computes a `next_attempt_at` and a 5-second sweep
picks deliveries up when they come due, which is what makes retry exhaustion and
restart recovery testable in milliseconds.

## 8. NATS delivery guarantee — JetStream at-least-once

Result callbacks over NATS are published to **JetStream and wait for a PubAck**
(decision 2026-08-03). The delivery record reports what was actually obtained:

| `guarantee` | Meaning |
|---|---|
| `ACKNOWLEDGED` | A JetStream PubAck came back — the broker persisted the message. |
| `BEST_EFFORT` | A Core publish left this process. Nothing more is proven. |

Every publish carries `Nats-Msg-Id: <event_id>`. Retries re-send the identical
id, so the broker's duplicate window collapses them into one stored message and
agrees with the receiver's own `event_id` dedupe. **At-least-once with dedupe,
not exactly-once**: a receiver must still be idempotent.

### PrintOps does not create the stream

The receiving environment owns the stream that captures the callback subject,
exactly as it owns the intake stream (`MEDISYNC`, ensured by medisync-core).
Creating one on a caller's behalf would silently take over retention policy for
someone else's namespace.

If no stream captures the subject, the delivery fails with **`NATS_NO_STREAM`**
and is **retried** — that failure mode is usually "the receiver has not
provisioned its stream yet", which an operator fixes without restarting
PrintOps. It is deliberately *not* downgraded to a Core publish: at-least-once
that quietly becomes best-effort is the kind of false guarantee this codebase
refuses to report.

### Choosing the mode

`PRINTOPS_CALLBACK_NATS_MODE` — `JETSTREAM` (default) or `CORE`. Set `CORE`
where a stream genuinely cannot be provisioned and best-effort is accepted with
open eyes.

The mode is **snapshotted onto the job's callback intent at accept time**, like
every other destination detail, so changing the deployment setting never alters
the contract of a print already on the wire.

Acceptance notifications (§1) remain Core publish regardless: they are
single-shot and best-effort by design, with no delivery record or retry worker
that a PubAck could inform.

## 9. Outbound safety (SSRF)

Callback URLs are frequently caller-supplied (`$.field`), which is a textbook
SSRF primitive. `infra/http/callback-url-guard.ts` applies:

**Always rejected** — non-`http`/`https` schemes, embedded credentials,
malformed hosts, cloud metadata (`169.254.169.254`, `metadata.google.internal`,
`100.100.100.200`, …), link-local, unspecified (`0.0.0.0`, `::`), multicast and
broadcast. IPv4-mapped IPv6 (`::ffff:169.254.169.254`) is normalised first.

**Allowed by default** — RFC1918 (`10/8`, `172.16/12`, `192.168/16`) and
loopback. PrintOps is a LAN print gateway; blanket-blocking private ranges, the
usual advice, would break its normal deployment.

**Operator tightening** —

| Variable | Effect |
|---|---|
| `WEBHOOK_ALLOWED_HOSTS` | comma-separated hosts (supports `*.example.com`). When set, only these. |
| `WEBHOOK_ALLOWED_CIDRS` | comma-separated IPv4 CIDRs. Literal-IP targets must fall inside one. |
| `WEBHOOK_BLOCK_METADATA` | `false` to allow metadata addresses. Default `true`. |

The guard runs **twice**: at accept time (so a bad destination is refused while a
caller still exists to receive the error) and again before every delivery
attempt (which narrows the DNS-rebinding window between acceptance and a
10-minute retry).

## 10. Idempotency

**Print** — unchanged. `findByRequestId(request_id, source_system)` returns the
existing job; the conditional `claim()` in `ExecuteJobService` and the runner
result route ensures one physical print.

**Callback** — keyed on `(printJobId, transport, target)`, enforced by a UNIQUE
index and `createIfAbsent()`.

Explicitly **not** keyed on `event_id`: that is a fresh `generateId()` per
publish, so it is stable only within one process for one publish, and a
redelivered event would create a second delivery — a duplicate callback. A job
reaches a terminal state exactly once, so the job id is the durable natural key.
`event_id` is stored for correlation and is what the *receiver* dedupes on,
because it is re-sent verbatim on every retry.

## 11. Failure recovery

| Failure | Behaviour |
|---|---|
| receiver down | retried on the backoff schedule, up to `maxAttempts` |
| receiver returns 4xx | delivery `FAILED` immediately, error visible on Job Detail |
| attempts exhausted | delivery `FAILED`, `lastErrorCode` / `lastHttpStatus` persisted |
| process crash mid-attempt | `recoverInFlight()` at boot re-arms `DELIVERING` / `PENDING` rows |
| process restart with a scheduled retry | SQLite mode: row survives, sweep picks it up. Memory mode: lost with the process (see limits) |
| NATS not connected | delivery retried; error `NATS_NOT_CONNECTED` |
| adapter wedged, no verdict | the execution watchdog ends the job as `TIMEOUT` (or `FAILED` if the spooler never accepted it) and emits the terminal event, so the caller is never left waiting forever |

## 12. Query API

`GET /api/v1/callback-deliveries` — durable delivery records.

Filters: `printJobId`, `requestId`, `eventId`, `deliveryStatus`, `transport`,
`endpointId`, plus `limit` / `offset`. Unknown enum values return
`400 INVALID_FILTER` rather than silently returning everything.

`GET /api/v1/webhook-endpoints/callback-log` — individual attempts (live and
sandbox test fires). Existing filters (`endpointId`, `outcome`, `transport`)
preserved; `printJobId` and `requestId` added.

## 13. Operator troubleshooting

**"The print worked but the other system never heard about it."**
Job Detail → *Result Delivery*. Read `Callback` first:

- *Not configured* — no `endpoint_code` was supplied (or the intake endpoint has
  `callbackTransport: NONE`).
- *Disabled* — read the stated reason. Usually `callbackOnPrintResult` is off,
  or the transport is configured but `$.reply_url` was absent from the payload.
- *Enabled* with a delivery row — read `deliveryStatus`, `Attempts`,
  `Next retry` and the error line.

**`RETRY_SCHEDULED` and stuck** — check `Next retry`. Attempt 5 is ~12 minutes
after the print. Nothing is lost; it is waiting.

**`FAILED` with HTTP 4xx** — the receiver rejected the request itself. Not
retried on purpose. Check the URL and the receiver's expectations.

**`FAILED` with `CALLBACK_URL_*`** — the SSRF guard refused the destination. See
§9; the code names the exact rule.

**`DELIVERED` but the other system claims nothing arrived, over NATS** — read
the `guarantee`. `ACKNOWLEDGED` means the broker stored the message, so the gap
is downstream: check the receiver's consumer, its filter subject, and whether it
acked and discarded. `BEST_EFFORT` means published, not received — check the
subscriber and the subject, and consider whether this endpoint should be on
JetStream (§8).

**`RETRY_SCHEDULED` with `NATS_NO_STREAM`** — no JetStream stream captures the
callback subject. PrintOps will not create it; the receiving environment must,
after which the pending retries deliver on their own. To accept best-effort
delivery instead, set `PRINTOPS_CALLBACK_NATS_MODE=CORE` (this applies to newly
accepted jobs — in-flight ones keep the mode they were accepted with).

**Nothing at all, and the job is `UNVERIFIED` or `TIMEOUT`** — the job IS
terminal and a callback WAS sent, carrying that status. A receiver that only
switches on `SUCCESS`/`FAILED` will drop it. That is a receiver-side bug; the
status is deliberate. Both mean a page may exist: do not auto-reprint.

**The receiver says the data was fine, but the label came out with blanks** —
check `data_quality` and `missing_fields` on the delivered payload (§5.1). If
they say `WITH_WARNINGS`, PrintOps reported the gap and the receiver ignored it;
the missing values were absent from the intake payload, upstream of PrintOps.
