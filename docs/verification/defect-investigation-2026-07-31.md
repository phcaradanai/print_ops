# PrintOps defect investigation — 2026-07-31

## Outcome

The five reported defects were investigated across the Web editor, API,
queue, local worker, Go runner, printer adapter, terminal-event path, and
callback dispatcher. The code and automated transport checks are complete.
Physical printer measurement and a Windows-native package build remain the two
explicit hardware/platform gates before production sign-off.

## Root causes and fixes

### DEFECT-01 — QR output about 0.5 mm too small

The QR path had three independent scale risks:

1. HTML used one fixed 168 px PNG and resized it to the requested CSS-mm box.
   At 203 DPI a 20 mm target is 160 dots. Interpolating the 168 px module image
   onto 160 device dots softened module edges; losing four edge dots is
   0.5005 mm at 203 DPI, matching the reported symptom.
2. ZPL used `^BQ` with fixed integer magnification. A 21-module QR at 203 DPI
   changes by 21 dots (2.63 mm) per magnification step, so it cannot meet a
   ±0.1 mm tolerance.
3. The Windows WebView2 helper did not explicitly pin its print scale, leaving
   a driver/browser fit factor as an avoidable second scale.

The fix is not a 0.5 mm offset. One shared `mm × DPI / 25.4` conversion now
serves the editor and backend. HTML uses an SVG module matrix in an exact CSS-mm
content box; ZPL uses a one-bit `^GF` bitmap rounded once to the nearest printer
dot; and WebView2 uses `ScaleFactor = 1.0`. The required four-module QR quiet
zone is calculated from the encoded matrix and rendered outside the configured
symbol box. Therefore `qrSizeMm = 20` means a 20 mm module matrix, not a smaller
matrix inside a 20 mm quiet-zone bounding box.

### DEFECT-02 — no queue status filter

The queue page fetched rows and rendered them directly. There was no filter
state, search composition, or client pagination, and the TypeScript job status
was only a compile-time union with no runtime source of truth.

`JOB_STATUSES` is now a domain runtime constant and `JobStatus` is derived from
it. The queue controls render `All` plus every domain status and its count. The
view applies exact status and search predicates before pagination. A 1.5-second
auto-refresh retains filter/search state and only clamps the current page when
the refreshed result set becomes shorter. The controls collapse to one column
on narrow screens and a filtered empty state is distinct from an empty queue.

### DEFECT-03 — `UNVERIFIED` callback missing

The live execution and runner-result paths already used the canonical terminal
event, but startup recovery had a separate transition: stale `DISPATCHED` or
`PRINTING` jobs were persisted as `UNVERIFIED` without emitting
`PrintJobTerminal`. Such a job was terminal in storage but invisible to the
dispatcher. Retention also had a duplicated terminal list that omitted
`TIMEOUT`, demonstrating the same source-of-truth drift.

Recovery now persists `UNVERIFIED` and then emits the same terminal event used
by normal execution. The dispatcher reads persisted callback intent, creates a
unique `(job, transport, target)` delivery, sends `UNVERIFIED` verbatim, and
uses the existing retry and idempotency lifecycle. Retention consumes the
domain `TERMINAL_PRINT_STATUSES` constant.

### DEFECT-04 — callbacks appear after the queue drains

Callback work must not be part of the print critical path. The in-process event
bus is fire-and-forget per event, and delivery records are per job, but a
multi-transport callback still awaited HTTP before starting NATS. There was no
regression test proving that a blocked Job A transport could not delay Job B.

Transport attempts now start independently with `Promise.all`. Event handlers
remain isolated per terminal event, so a slow or failing Job A callback cannot
block Job B or the printer scheduler. Payloads now carry accepted, queued,
started, and terminal timestamps; the delivery record supplies callback queued
(`createdAt`), started (`lastAttemptAt`), and delivered (`deliveredAt`) times.

### DEFECT-05 — avoidable delay between queued jobs

There were three concrete bottlenecks:

1. The desktop worker woke every 500 ms, dequeued one job, executed it, and
   returned to the timer, imposing another polling interval between jobs.
2. The Go loop claimed and executed only one job at a time globally, even when
   jobs targeted different printers.
3. Raw TCP opened and closed port 9100 for every job. The runner route also
   inherited the repository's newest-first list order rather than explicit
   priority/FIFO queue order.

The desktop now drains all available messages into one promise chain per
printer. The Go runner prefetches a bounded eight jobs and schedules them onto
per-printer chains. Same-printer jobs remain sequential and FIFO; different
printers execute concurrently. Raw TCP keeps one mutex-protected connection per
target for up to 30 seconds idle, never retries an ambiguous write, and discards
the connection after error/timeout. Runner claiming is priority-descending and
FIFO within a priority.

## Changed architecture and flow

```text
qrSizeMm
  -> shared mm/dot conversion
  -> SVG + explicit outside quiet zone (HTML/preview)
  -> exact one-bit device-dot graphic + outside quiet zone (ZPL)
  -> WebView2 scale 1.0

persist terminal Job
  -> PrintJobTerminal (SUCCESS|FAILED|UNVERIFIED|TIMEOUT|CANCELLED)
  -> fire-and-forget event handler per Job
  -> create-if-absent delivery per transport
  -> concurrent HTTP/NATS attempts
  -> DELIVERED | RETRY_SCHEDULED | FAILED

queued jobs
  -> priority/FIFO claim
  -> per-printer sequential chain
  -> connection/session reuse
  -> asynchronous result callback
```

## Main files changed

- Physical units and domain vocabulary: `packages/shared/src/physical-units.ts`,
  `packages/domain/src/models/job.ts`.
- QR rendering/printing: `apps/api/src/infra/template/barcode-renderer.ts`,
  `apps/api/src/infra/template/simple-template-renderer.ts`,
  `apps/web/src/lib/barcode.ts`, Paper Profile/Template preview components, and
  `apps/windows-print-helper/Program.cs`.
- Queue UI: `apps/web/src/pages/JobQueue.tsx`,
  `apps/web/src/components/JobQueueControls.tsx`,
  `apps/web/src/lib/jobQueueView.ts`, translations and responsive CSS.
- Terminal callback flow: `apps/api/src/app.ts`,
  `apps/api/src/services/result-callback-dispatcher.ts`, and retention.
- Scheduling/adapter: `apps/api/src/services/local-print-scheduler.ts`, runner
  job route, `apps/runner-go/internal/jobs/jobs.go`, raw TCP executor and
  telemetry.
- Evidence: new/updated TS, React, and Go tests plus
  `scripts/benchmark-defect-05.ts` and `artifacts/e2e/e2e-report.json`.

## QR sizing evidence

Expected dots are the continuous formula; rendered dots are rounded once.
Physical size is `rendered dots × 25.4 / DPI`. All 15 cases are within ±0.1 mm.

| Requested | DPI | Expected dots | Rendered dots | Expected physical output | Error |
|---:|---:|---:|---:|---:|---:|
| 10 mm | 203 | 79.921 | 80 | 10.010 mm | +0.010 mm |
| 15 mm | 203 | 119.882 | 120 | 15.015 mm | +0.015 mm |
| 20 mm | 203 | 159.843 | 160 | 20.020 mm | +0.020 mm |
| 25 mm | 203 | 199.803 | 200 | 25.025 mm | +0.025 mm |
| 30 mm | 203 | 239.764 | 240 | 30.030 mm | +0.030 mm |
| 10 mm | 300 | 118.110 | 118 | 9.991 mm | -0.009 mm |
| 15 mm | 300 | 177.165 | 177 | 14.986 mm | -0.014 mm |
| 20 mm | 300 | 236.220 | 236 | 19.981 mm | -0.019 mm |
| 25 mm | 300 | 295.276 | 295 | 24.977 mm | -0.023 mm |
| 30 mm | 300 | 354.331 | 354 | 29.972 mm | -0.028 mm |
| 10 mm | 600 | 236.220 | 236 | 9.991 mm | -0.009 mm |
| 15 mm | 600 | 354.331 | 354 | 14.986 mm | -0.014 mm |
| 20 mm | 600 | 472.441 | 472 | 19.981 mm | -0.019 mm |
| 25 mm | 600 | 590.551 | 591 | 25.019 mm | +0.019 mm |
| 30 mm | 600 | 708.661 | 709 | 30.014 mm | +0.014 mm |

## Callback timing evidence

The real E2E run produced the following delivery timelines (UTC). `createdAt`
is callback-queued time and `lastAttemptAt` is callback-start time.

| Stage | Job A — real HTTP callback | Job B — real NATS callback |
|---|---|---|
| acceptedAt | 15:08:41.325 | 15:08:41.721 |
| queuedAt | 15:08:41.328 | 15:08:41.724 |
| startedAt | 15:08:41.630 | 15:08:42.130 |
| terminalAt | 15:08:41.683 | 15:08:42.186 |
| callbackQueuedAt | 15:08:41.689 | 15:08:42.190 |
| callbackStartedAt | 15:08:41.690 | 15:08:42.191 |
| callbackDeliveredAt | 15:08:41.699 | 15:08:42.193 |
| terminal-to-delivered | 16 ms | 7 ms |

The failure-isolation integration test separately holds Job A's HTTP promise
open, terminals Job B, and observes Job B `DELIVERED` while Job A remains
`DELIVERING`; only then is Job A released. A second test holds HTTP for one
`BOTH` callback and observes NATS deliver independently.

## Performance evidence

Controlled benchmark settings: 100 ms poll interval and 20 ms fake printer
execution. This isolates scheduling overhead; it is not a physical-printer
throughput claim.

| Scenario | Before | After | Improvement | Before/after idle gap | Max printer concurrency after |
|---|---:|---:|---:|---:|---:|
| 1 job | 122 ms | 121 ms | 0.8% | n/a | 1 |
| 2 jobs, same printer | 223 ms | 141 ms | 36.8% | 80 ms / 0 ms | 1 |
| 5 jobs, same printer | 527 ms | 202 ms | 61.7% | 81 ms / 0 ms | 1 |
| 2 jobs, different printers | 222 ms | 122 ms | 45.0% | 82 ms / n/a | 2 |

Metric coverage is available as follows: job latency stores `queueWaitMs`,
`dispatchMs` (runner dispatch), `runnerExecMs`, and `totalLatencyMs`; template
timing/traces store `renderMs`; raw TCP evidence stores
`printer_initialize_ms` and `print_submit_ms`; the Go runner records
`result_report_ms`; callback attempts record `durationMs` (callback dispatch);
and both schedulers record `printer_execution_ms` and
`idle_gap_between_jobs_ms`.

## Verification commands and results

- `GOCACHE=/private/tmp/printops-go-cache npm test` — PASS. API: 48 files,
  389 tests. Web: 24 files, 458 tests. All Go packages passed.
- `GOCACHE=/private/tmp/printops-go-cache npm run typecheck` — PASS for domain,
  shared, adapters, API, Web, and Go runner.
- `GOCACHE=/private/tmp/printops-go-cache npm run build` — PASS for domain,
  shared, adapters, API, and Go runner.
- `npm run build -w apps/web` — PASS, production Vite bundle generated.
- `go test -race ./internal/jobs ./internal/printer/rawtcp` — PASS.
- `npm run test:e2e:nats` — PASS using a real Docker NATS JetStream server,
  real API/local worker, real HTTP receiver, and real NATS subscriber. The
  matrix covered API/NATS intake × HTTP/NATS callback, exact-one callback,
  duplicate intake, DLQ, HTTP 500 retry, and recovery to `DELIVERED` on attempt
  3. Artifact validation is `PASS` with 10 HTTP captures, 2 NATS captures, and
  3 DLQ captures.
- `node --import tsx scripts/benchmark-defect-05.ts` — PASS; wrote the ignored
  reproducible performance JSON under `artifacts/verification/`.

New tests cover unit conversion and the 15 QR cases, HTML/ZPL quiet-zone
separation, queue filtering/search/pagination/refresh, all five terminal status
payloads, live and recovery `UNVERIFIED`, retry/idempotency, per-job callback
isolation, independent transports, FIFO ordering, same-printer sequencing,
different-printer concurrency, raw-TCP connection reuse, and the race detector.

## Remaining limitations and real-printer readiness

1. No physical 203/300/600 DPI printer, ruler/caliper, or scanner was available
   in this environment. The dot math and generated bytes meet tolerance, but a
   real-printer acceptance pass must measure the dark module matrix (excluding
   its outside quiet zone) and confirm the installed Windows driver is set to
   100%/actual size.
2. This macOS host has neither `dotnet` nor `cargo`, and the Tauri bundle targets
   Windows MSI/NSIS. The Web, API, and Go parts build, but the Windows helper
   and final Desktop package were not compiled here. That platform build is a
   release gate, especially for the WebView2 `ScaleFactor` change.
3. Exact auto-generated QR sizing is implemented for HTML/SVG and ZPL. TSPL,
   EPL, RAW_TEXT, and JSON layouts still treat native printer commands as
   template-author responsibility.
4. Queue counts/filtering operate on the dashboard's loaded 1,000-row
   operational window. This matches the default terminal-job retention cap,
   but installations configured above that cap should move search/counts to a
   server-paginated aggregate endpoint.

The change is ready for Windows packaging and controlled physical-printer QA;
it is not yet honest to mark physical-output verification complete.
