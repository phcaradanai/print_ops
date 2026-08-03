# PrintOps E2E Results — Transport × Callback Matrix

Date: 2026-07-31 (production-gate rerun)
Branch `mvp_nippon` · Windows, Node 24.18.0
Evidence: `artifacts/e2e/e2e-report.json`
Harness: `apps/api/src/tests/e2e/harness.ts`

Environment: API bound to a random loopback TCP port (`buildApp`), disposable
SQLite, `PRINTOPS_LOCAL_WORKER=true`, discovery-only Go runner, NATS 2.10.29
JetStream pinned by image digest on a random loopback port, real TCP HTTP
webhook receiver, and real NATS subscriber. Printer `OFFICE_LASER_01`
(protocol `fake`). No real printer was used.

The 2026-07-31 report is `PASS` with 25 findings, 10 webhook captures, two
terminal NATS callbacks, three intentional DLQ captures, and zero validation
failures. This remains automated loopback evidence, not cross-machine or
physical-printer acceptance.

> **Previous run (same date, before the fix)** recorded: rows 1–2 PARTIAL
> (callback body carried `status:"QUEUED"` while the job ended `SUCCESS`), rows
> 3–4 FAIL (0 callbacks — structurally unreachable), no retry, no SSRF guard,
> unknown `template_code` accepted. Those results are quoted inline below as
> "**Was:**" so the delta is auditable.

## Matrix

| Input | Callback | Print result | Terminal event | Delivery | Audit | Trace | Verdict |
|---|---|---|---|---|---|---|---|
| API (`/intake/:code`) | HTTP webhook | `SUCCESS` | emitted ×1 | `DELIVERED` att=1 `ACKNOWLEDGED` | yes | 7/7 steps | **PASS** |
| API (`/intake/:code`) | NATS | `SUCCESS` | emitted ×1 | `DELIVERED` att=1 `BEST_EFFORT` | yes | 7/7 steps | **PASS** |
| NATS intake (`endpoint_code`) | HTTP webhook | `SUCCESS` | emitted ×1 | `DELIVERED` att=1 `ACKNOWLEDGED` | yes | complete | **PASS** |
| NATS intake (`endpoint_code`) | NATS | `SUCCESS` | emitted ×1 | `DELIVERED` att=1 `BEST_EFFORT` | yes | complete | **PASS** |

Every cell verified: accepted → queued → printed on the fake printer → terminal
event emitted → callback payload carries the **terminal** status → delivery
record persisted → audit and trace complete.

> **Was:** rows 1–2 `delivered, but status:"QUEUED"` — PARTIAL; rows 3–4
> `0 callbacks` — FAIL.

Sample delivered payload (cell 1, verbatim from the report):

```json
{
  "version": 1,
  "event_id": "4a64b91e-a38e-4f49-a3ad-025a3c93952b",
  "event_type": "print.job.completed",
  "occurred_at": "2026-07-27T06:42:45.347Z",
  "request_id": "e2e-api-webhook-…",
  "job_id": "131a33aa-25f1-4c6a-ad68-016aadbcd3b9",
  "source_system": "e2e-e2e-http",
  "print_status": "SUCCESS",
  "printer_code": "OFFICE_LASER_01",
  "runner_id": "desktop-local-worker",
  "error": null,
  "trace_id": "trace_1c3bb5c3-…",
  "delivery": { "transports": ["HTTP"], "nats_mode": null }
}
```

Callback timing, measured directly:

```
statusInCallbackPayload      : "SUCCESS"
finalJobStatusAfterPrint     : "SUCCESS"
callbackReportsTerminalState : true
```

> **Was:** `"QUEUED"` / `"SUCCESS"` / `false`.

## Non-SUCCESS terminal results — PASS

The E2E matrix drives `SUCCESS` on the fake printer. Every other terminal status
is covered deterministically, because forcing them end to end would need real
failing hardware:

| Terminal status | How it is reached | Callback carries |
|---|---|---|
| `FAILED` (adapter) | printer with an unregistered protocol → registry lookup throws inside `execute()` | `print_status: FAILED`, `error.code: EXECUTION_ERROR` |
| `FAILED` (runner) | `POST /runners/:id/jobs/:jobId/result` with `status: FAILED` | `print_status: FAILED`, `error.code` from runner evidence |
| `UNVERIFIED` | runner reports `SUCCESS` for a `windows_spooler` printer with `device_confirmed` but no `ipp_job_confirmed` → `enforceWindowsSpoolerConfirmation` downgrades it | `print_status: UNVERIFIED`, `error.code: PRINT_NOT_VERIFIABLE` |
| `CANCELLED` | `CancelJobService` | `print_status: CANCELLED`, `error.code: JOB_CANCELLED` |

`UNVERIFIED` is the one that matters most and is the reason this table exists:
reporting it as `FAILED` would invite a duplicate reprint of a label that may
already be in the tray, and reporting it as `SUCCESS` would hide a real
ambiguity. In every case the delivery is `DELIVERED` while the print is not
`SUCCESS` — print status and delivery status stay independent.

Files: `src/tests/result-callback.test.ts`,
`src/tests/runner-terminal-callback.test.ts`.

## Callback configuration behaves in both directions

| Case | Observed |
|---|---|
| `callbackOnPrintResult: true` | 1 callback, `event_type: print.job.completed`, `print_status: SUCCESS`, delivery persisted |
| `callbackOnPrintResult: false` | 1 callback, `event_type: print.job.accepted`, `status: QUEUED`, **0 delivery records** — result callback suppressed |
| NATS envelope with **no** `endpoint_code` | job printed `SUCCESS`, **0 callbacks** on either transport — existing publishers unaffected |
| NATS envelope with an `endpoint_code` owned by another `source_system` | **no job created**, message dead-lettered (1 DLQ message) |

> **Was:** `callbackOnPrintResult` was read by no code at all.

## Retry — PASS

Receiver forced to answer `500`, then allowed to recover:

```
CALLBACK-FAILURE-500
  finalJobStatus          : SUCCESS
  deliveryAttemptsObserved: 2
  retried                 : true
  delivery                : HTTP:RETRY_SCHEDULED att=2
                            lastHttpStatus 500, lastErrorCode HTTP_500
                            nextAttemptAt +30s

CALLBACK-RECOVERY-AFTER-500
  totalWebhookAttempts    : 3
  delivery                : HTTP:DELIVERED att=3 ACKNOWLEDGED
```

Attempt 1 immediate, attempt 2 after ~5 s + sweep granularity, attempt 3 after
~30 s once the receiver returned 200. The same `event_id` was sent on every
attempt, and all three attempts belong to **one** delivery record.

This is also the print-vs-delivery separation in practice: `print SUCCESS` and
`delivery RETRY_SCHEDULED` coexisted on the same job.

> **Was:** `deliveryAttemptsObserved: 1, retried: false` — one attempt, no
> backoff, no escalation. A briefly-down receiver meant the caller never learned
> the outcome, ever.

Retry classification, exhaustion, jitter bounds and the injected-clock schedule
are covered deterministically (no real waiting) in
`src/tests/callback-retry-policy.test.ts` and `src/tests/result-callback.test.ts`.

## Idempotency — PASS

### Print (unchanged)

| Scenario | Result |
|---|---|
| Same `request_id` twice via HTTP intake | 1 job. 1st `202`, 2nd `200 DUPLICATE_RETURNED`, same `print_job_id` |
| Same `request_id` twice via NATS | 1 job created, status `SUCCESS` |
| NATS intake then `POST /api/v1/print-jobs`, same id | `200 DUPLICATE_RETURNED` + `existing_job_id` |

**Duplicate submission still cannot produce duplicate physical output.** Dedup
key remains the composite `(request_id, source_system)`, applied before job
creation on every path. A different `source_system` is by design a different job.

### Callback (new)

| Scenario | Result |
|---|---|
| Same terminal event replayed with a different `event_id` | 1 delivery record, 1 HTTP call |
| Duplicate submission with a callback endpoint | 1 delivery record, 1 callback |
| 5 retry attempts | 1 delivery record, 5 attempts recorded against it |

Dedup key is `(printJobId, transport, target)`, enforced by a UNIQUE index —
deliberately **not** `event_id`, which is regenerated per publish and would let a
replay create a second callback. Covered in `src/tests/result-callback.test.ts`
and `src/tests/callback-delivery.repo.test.ts`.

## Negative cases

| Case | Status | Verdict |
|---|---|---|
| missing `request_id` | `400 VALIDATION_ERROR` | PASS |
| unknown endpoint code | `404 NOT_FOUND` | PASS |
| no route-policy match | `400` "Route policy … did not match" | PASS |
| unauthenticated `/print-jobs` | `401` Missing X-Api-Key | PASS |
| invalid API key | `401` Invalid or inactive API key | PASS |
| unknown printer | `404 NOT_FOUND` | PASS |
| payload > 64 KiB | `400` intake request too large | PASS |
| copies above printer limit | `400` exceeds printer limit | PASS |
| `copies: -5` / `0` / `2.7` | `400 VALIDATION_ERROR` | PASS (fixed in the previous pass) |
| NATS wrong `target_client_id` | dead-lettered, 1 DLQ message | PASS |
| NATS malformed JSON | dead-lettered, 1 DLQ message | PASS |
| **unknown `template_code`** | **`422 TEMPLATE_NOT_FOUND`, no job created** | **PASS — fixed** |
| `endpoint_code` unknown / disabled | `422 CALLBACK_ENDPOINT_NOT_FOUND` | PASS |
| `endpoint_code` owned by another system | `403 CALLBACK_ENDPOINT_FORBIDDEN` | PASS |
| callback URL = cloud metadata address | `422 CALLBACK_DESTINATION_REJECTED` | PASS |

### unknown template_code — now fixed

> **Was:** `201 CREATED`. `accept-external-job.service.ts` did
> `if (template) { …render… }` with no `else`, so an unknown `template_code` was
> silently ignored: the job was created, `templateCode` persisted as the bogus
> value, `renderedPrintPayload` left `undefined`, and the job reached `SUCCESS`.

Two holes, both closed:

1. `AcceptExternalJobService` now rejects an explicitly provided `template_code`
   that does not resolve to a `PUBLISHED` template. `app.ts` passes the template
   repository (and deliberately **not** the paper repo or renderer), which turns
   on validation without switching on server-side rendering for a route that has
   never done it.
2. `DynamicPrintService` validates `code_template` even when an explicit
   `printer_code` short-circuits binding resolution — previously the *only*
   place the template was checked.

Omitting `template_code` entirely is unchanged: the raw payload is accepted, as
before. Only an explicitly-named non-existent template is refused.

## SSRF guard — PASS

23 cases in `src/tests/callback-url-guard.test.ts`. Rejected: non-`http(s)`
schemes, embedded credentials, malformed hosts, AWS/GCP/Azure/Alibaba metadata
(including `::ffff:` IPv4-mapped forms), link-local, `0.0.0.0`, `::`, multicast,
broadcast. Allowed by default: `10/8`, `172.16/12`, `192.168/16`, `127.0.0.1` —
because a LAN print gateway's real receiver lives there. Tightening via
`WEBHOOK_ALLOWED_HOSTS` / `WEBHOOK_ALLOWED_CIDRS` verified in both directions.

> **Was:** no SSRF guard existed on the field-resolved callback URL.

## Trace and audit — PASS

Every successful job produced a complete 7-step trace:

```
job_accepted:success → job_validated:success → route_resolved:success
→ template_resolved:success → template_rendered:success
→ job_dispatched:success → adapter_execute:success
```

Correlatable by `request_id`, `job_id`, `trace_id`, `correlationId`.

Callback delivery is **not** a trace step, by design: it is a separate concern
with its own durable record. It is correlatable to the job by `printJobId`,
`requestId` and `eventId` via `GET /api/v1/callback-deliveries` and the filtered
`GET /api/v1/webhook-endpoints/callback-log`.

## Verification commands

| Command | Result | Notes |
|---|---|---|
| `npm test` | **PASS** | 698 tests (71 + 310 + 317), 0 failures |
| `npm run typecheck` | **PASS** | all workspaces + Go |
| `npm run build -w apps/web` | **PASS** | — |
| `cd apps/runner-go && go build ./...` | **PASS** | — |
| `cd apps/runner-go && go vet ./...` | **PASS** | — |
| `docker compose -f infra/docker/docker-compose.yml config` | **PASS** | — |
| `npx tsx apps/api/src/tests/e2e/harness.ts` | **PASS** | 4/4 matrix cells, retry recovery, idempotency |
| lint | **NOT RUN — no lint tooling configured** | repo has no eslint/biome/golangci config |

## Not run / blocked

| Area | Status | Reason |
|---|---|---|
| Real printer smoke test | **NOT RUN** | No confirmed-safe device; `LAB_LABEL_01` targets a real EPSON |
| Go runner transport | **PARTIAL** | The harness used `PRINTOPS_LOCAL_WORKER`, so the runner **poll/claim** path was not exercised end to end. The runner **result** route — the emission site that actually ships — is covered by `runner-terminal-callback.test.ts`, which drives the real HTTP route and asserts SUCCESS, FAILED, the Windows-spooler `UNVERIFIED` downgrade, the 409 late-duplicate case, and the no-intent case |
| Interactive browser UX | **NOT RUN** | Job Detail / Webhooks changes verified by typecheck + `npm run build -w apps/web` only |
| Windows spooler adapter | **NOT RUN** | Would drive real hardware |
| SQLite mode, end to end | **PARTIAL** | The delivery repository contract and restart-with-pending-delivery are covered against real SQLite in `callback-delivery.repo.test.ts`; the E2E harness itself ran `DB_MODE=memory` |
| Service restart mid-queue | **N/A** | Queue is in-memory; restart loses the queue by design. Callback deliveries survive in SQLite mode |
| Callback signing | **N/A** | Not implemented. `signingSecretRef` is not modelled |
| C# helper / desktop Tauri | **NOT RUN** | Out of scope |

## Real printer

```
FAKE_PRINT_VERIFIED_ONLY
```

All print execution went through `FakePrinterAdapter` on `OFFICE_LASER_01`.
Jobs reached `SUCCESS` with `adapter_execute:success` in the trace. No physical
page was produced and none was attempted.
