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

A single endpoint sends **one or the other**, never both, selected by
`callbackOnPrintResult`:

- `callbackOnPrintResult = false` → acceptance notification only. The print
  outcome is never reported.
- `callbackOnPrintResult = true` → terminal result only. No acceptance
  notification.

The one exception is a **duplicate** submission: it creates no new print, so it
can never produce a terminal result. Duplicates always get the acceptance
notification, whatever the toggle says, so the caller is not left waiting on a
result that cannot arrive.

The toggle is read in exactly one place — `wantsAcceptanceCallback()` /
`wantsTerminalCallback()` in `callback-intent.service.ts` — so no intake path
can develop its own interpretation of it. For a long time none of them read it
at all: the terminal callback fired unconditionally, and the acceptance
callback fired only for duplicates, which is why this section did not describe
the code.

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

`DUPLICATE_RETURNED` is not in this list — it is an acceptance outcome, not a
print outcome.

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

  "printer_code": "OFFICE_LASER_01",
  "runner_id": "desktop-local-worker",

  "error": null,
  "trace_id": "trace_1c3bb5c3-…",

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

Terminal deliveries are pruned alongside the jobs they belong to by the existing
retention sweep.

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

## 8. NATS delivery guarantee — `BEST_EFFORT`

Result callbacks over NATS use **Core NATS publish**, and the delivery record
says so: `guarantee: "BEST_EFFORT"`, never `ACKNOWLEDGED`.

This is a deliberate compatibility-mode decision, not an omission. The
print-intake connection explicitly does **not** own its JetStream stream (the
publisher's environment does — in this deployment, medisync-core ensures
`MEDISYNC`). PrintOps therefore cannot guarantee that a stream exists for an
arbitrary caller-supplied reply subject, and creating one on the caller's behalf
would silently take over retention policy for someone else's namespace.

**A successful Core NATS publish proves the bytes left this process. It does not
prove any subscriber received them.** Publish failures are persisted and retried
on the same schedule as HTTP; subscriber receipt is not, and never claimed to
be, confirmed.

An integrator who needs confirmed delivery should use the HTTP transport, whose
2xx is a real acknowledgement (`guarantee: "ACKNOWLEDGED"`).

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

**`DELIVERED` but the other system claims nothing arrived, over NATS** — expected
and documented: `BEST_EFFORT` means published, not received. Check the
subscriber and the subject.

**Nothing at all, and the job is `UNVERIFIED`** — the job IS terminal and a
callback WAS sent, carrying `print_status: "UNVERIFIED"`. A receiver that only
switches on `SUCCESS`/`FAILED` will drop it. That is a receiver-side bug; the
status is deliberate.
