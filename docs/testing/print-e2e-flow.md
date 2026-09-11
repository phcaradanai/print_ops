# PrintOps Print Flow — Actual Implementation Map

Date: 2026-07-27
Branch: `mvp_nippon`
Method: source trace + executed end-to-end harness (`apps/api/src/tests/e2e/harness.ts`)

This documents what the code **does**, not what the contract suggests it should do.

> **Revision note.** The first version of this document (same date) recorded a
> system in which callbacks fired at accept time, carried `status: "QUEUED"`,
> were unreachable from NATS intake, and were never retried. All four of those
> are now fixed. Sections 1 and 3–5 have been rewritten against the current
> code; the old findings are preserved as "**Was:**" lines so the delta stays
> auditable. Architecture detail lives in
> [`docs/architecture/result-callbacks.md`](../architecture/result-callbacks.md).

## 1. There are four intake paths, not one

| # | Transport | Entry point | Service chain | Result-callback support |
|---|---|---|---|---|
| 1 | HTTP | `POST /api/v1/print-jobs` (`X-Api-Key`) | `AcceptExternalJobService` → `CreatePrintJobService` | optional `endpoint_code` |
| 2 | HTTP | `POST /api/v1/printer/:code_template/:code_profile` (`X-Api-Key`) | `DynamicPrintService` → `AcceptExternalJobService` → `CreatePrintJobService` | optional `endpoint_code` |
| 3 | HTTP | `POST /api/v1/intake/:endpointCode` (endpoint-owned auth) | `DynamicIntakeService` → `CreatePrintJobService` | endpoint from the path |
| 4 | NATS | JetStream subject `<PRINTOPS_NATS_SUBJECT_PREFIX>.<clientId>` | `handlePrintIntakeMessage` → `DynamicPrintService` → `AcceptExternalJobService` | optional `endpoint_code` in the envelope |

> **Was:** callbacks existed on path 3 only, and the asymmetry was structural —
> paths 1, 2 and 4 carried no endpoint reference of any kind. All four paths now
> resolve a `WebhookEndpoint`; on 1, 2 and 4 the reference is optional, so
> publishers that never send it are completely unaffected.

Note: `authRoutes` is registered on the **unprefixed** plugin, so login is
`POST /auth/login` — not `/api/v1/auth/login` like every other route.

## 2. Stage-by-stage

```
Input
 ├─ HTTP  → Fastify route → apiKeyHook (paths 1,2) or endpoint authMode (path 3)
 └─ NATS  → JetStream durable consumer, AckPolicy.Explicit, max_deliver=5, ack_wait=30s
      ↓
Envelope validation
      ↓
Idempotency      jobs.findByRequestId(request_id, source_system)   ← composite key
      ↓
Routing          path 3: RoutePolicyResolverService (match rules → printer+template)
                 paths 1,2,4: printer_code direct, or binding resolution
      ↓
Template check   an explicitly named template_code must exist and be PUBLISHED, else 422
      ↓
Callback intent  endpoint resolved, $.field destinations resolved to literals,
                 SSRF-checked, then PERSISTED ON THE JOB (job.metadata.callbackIntent)
      ↓
Render           TemplateRendererPort (path 3 always; path 1/2/4 only if template found)
      ↓
Persist          CreatePrintJobService  — ACCEPTED → VALIDATED → QUEUED
      ↓
Queue            InMemoryJobQueue (in-process; not Redis/BullMQ)
      ↓
Execute          Go runner (poll) OR in-process local worker (PRINTOPS_LOCAL_WORKER=true)
                 → AdapterRegistry.getAdapterForPrinter → adapter.executeCommand
      ↓
Terminal         SUCCESS / FAILED / UNVERIFIED / TIMEOUT / CANCELLED
                 + JobTrace steps + AuditLog, all persisted
      ↓
PrintJobTerminal published exactly once, AFTER the terminal state is durable
      ↓
ResultCallbackDispatcher (production EventBus subscriber)
      ↓
CallbackDelivery record → HTTP and/or NATS → outcome persisted → retry if applicable
```

### Status model actually persisted

`ACCEPTED` → `VALIDATED` → `QUEUED` → `DISPATCHED` → `PRINTING` →
`SUCCESS` / `FAILED` / `UNVERIFIED` / `TIMEOUT` / `CANCELLED`

No `RUNNER_RECEIVED`, `CALLBACK_PENDING` or `COMPLETED` state exists, and none
was added: **callback delivery is modelled separately**, on `CallbackDelivery`
(`PENDING` / `DELIVERING` / `DELIVERED` / `RETRY_SCHEDULED` / `FAILED` /
`SKIPPED`). A job reaching `SUCCESS` still says nothing about whether its
callback was delivered — that is deliberate, and the Job Detail page now shows
both side by side.

## 3. Callbacks now fire at terminal time

Two distinct events:

- **`print.job.accepted`** — sent by `DynamicIntakeService` at accept time,
  carrying `status: "QUEUED"`. An acceptance notification, and now labelled as
  one.
- **`print.job.completed`** — sent by `ResultCallbackDispatcher` after the print
  reaches a terminal state, carrying `status`.

`callbackOnPrintResult` selects between them (`true` = result only, `false` =
acceptance only). A duplicate submission always gets the acceptance
notification, because it creates no print and can therefore never produce a
result.

Measured, current run:

```
callbackEventType    : "print.job.completed"
callbackPrintStatus  : "SUCCESS"
finalJobStatus       : "SUCCESS"
reportsTerminalStatus: true
```

> **Was:** `"status":"QUEUED"` in the callback body while the job's real final
> status ~1s later was `"SUCCESS"`; `execute-job.service.ts` had no callback
> logic; `InMemoryEventBus.subscribe()` had no non-test caller anywhere in the
> repo; and `callbackOnPrintResult` was dead configuration read by nothing.

### Terminal-event emission sites

`emitPrintJobTerminal()` is called from every site that can move a job to a
terminal status:

| Site | File |
|---|---|
| in-process executor, success | `services/execute-job.service.ts` |
| in-process executor, failure | `services/execute-job.service.ts` (`handleFailure`) |
| Go runner result endpoint | `routes/v1/runner-jobs.routes.ts` |
| operator cancel | `services/cancel-job.service.ts` |

The Go-runner site matters: emitting only from `ExecuteJobService` would make
this harness pass under `PRINTOPS_LOCAL_WORKER=true` while the shipping
Go-runner deployment never fired a single callback.

## 4. Delivery guarantees (measured, not assumed)

| Channel | Guarantee |
|---|---|
| NATS intake (inbound) | JetStream durable, explicit ack, `max_deliver` 5, DLQ via `medisync.dlq.<subject>` on poison messages |
| HTTP callback (outbound) | Bounded retry: 5 attempts at ~0s / 5s / 30s / 2min / 10min ±20% jitter, 10s request timeout. Every attempt persisted. `guarantee: ACKNOWLEDGED` on 2xx |
| NATS callback (outbound) | Core NATS publish. Publish failures are retried on the same schedule; success is reported as `guarantee: BEST_EFFORT` and **never** as confirmed subscriber delivery |

Retry classification: 5xx / 408 / 429 / connection failures / timeouts are
retried; other 4xx and SSRF-rejected destinations fail immediately.

> **Was:** HTTP callbacks were fire-and-forget, single attempt, no retry; NATS
> callbacks were Core publish with no persistence and no retry, and nothing
> distinguished "published" from "delivered".

JetStream is **not** used for outbound callbacks, on purpose: the print-intake
connection does not own its stream (the publisher's environment does), so
PrintOps cannot guarantee a stream exists for a caller-supplied reply subject.
See `docs/architecture/result-callbacks.md` §8.

A 4xx `AppError` from the intake path is still treated as poison and
dead-lettered; anything else is NAKed for redelivery. An `endpoint_code` that
does not exist, is disabled, or belongs to another `source_system` produces a
4xx and is therefore dead-lettered **without printing**.

## 5. Callback target resolution and outbound safety

`callbackUrl` / `callbackNatsSubject` accept a literal, a whole-value `$.field`
path, or `$.field` tokens embedded in a string — resolved against the original
intake payload. A publisher can therefore supply its own reply address per
request.

Resolution now happens **at accept time**, and the resolved literal is persisted
on the job, because the intake payload no longer exists when the print finishes
(only a redacted `payloadSnapshot` does).

Resolved HTTP URLs pass `infra/http/callback-url-guard.ts` at accept time and
again before every delivery attempt. It rejects non-`http(s)` schemes, embedded
credentials, malformed hosts, cloud metadata, link-local, unspecified, multicast
and broadcast targets — while **allowing RFC1918 and loopback by default**,
because this is a LAN print gateway. Tighten with `WEBHOOK_ALLOWED_HOSTS`,
`WEBHOOK_ALLOWED_CIDRS`, `WEBHOOK_BLOCK_METADATA`.

> **Was:** no allowlist and no SSRF guard of any kind on the resolved URL.

## 6. Reproducing

```bash
# JetStream-enabled NATS
docker run -d --rm --name printops-e2e-nats -p 14222:4222 nats:2-alpine -js

# whole matrix: boots the app in-process, drives all four cells plus the
# retry/idempotency/negative cases, writes artifacts/e2e/e2e-report.json, exits.
# Takes ~2 minutes: it deliberately waits out a real 30s retry backoff.
npx tsx apps/api/src/tests/e2e/harness.ts

docker rm -f printops-e2e-nats
```

Deterministic coverage of the same behaviour, with no broker and no waiting,
lives in the unit/integration suites (injected clock, no `sleep`):

```bash
npx vitest run src/tests/result-callback.test.ts \
               src/tests/callback-delivery.repo.test.ts \
               src/tests/callback-retry-policy.test.ts \
               src/tests/callback-url-guard.test.ts --root apps/api
```

The harness routes every job to `OFFICE_LASER_01` (protocol `fake`).
**`LAB_LABEL_01` is `windows_spooler` and points at a real EPSON device** —
the seeded `lab-label-static` route policy targets it, so do not reuse that
policy for testing.
