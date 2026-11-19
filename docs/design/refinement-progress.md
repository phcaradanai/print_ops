# Refinement progress

## 2026-11-19 — Silent background polling (no Freshness/toolbar bounce on intervals)

Scheduled background polling ticks in `apps/web/src/lib/pollController.ts` previously emitted `refreshing: true` (and `loading: true` on retries after an initial load failure) on every tick across all polling pages (`JobQueue`, `JobDetail`, `WebControlJobs`, `WebControlDevices`, `WebControlDeviceDetail`, `WebControlReleases`, `WebControlContent`, `Runners`, `LocalDiagnostics`, `CinemaBoard`, `CallbackDeliveryLog`). In `<Freshness>`, that mounted/unmounted `<span className="freshness-refreshing">` and toggled `<Button busy={refreshing}>` with a spinner every 1–30 seconds, shoving sibling buttons (`Export CSV`, `Columns`, `Cinema`, `Sync`, header actions) sideways and back on every interval.

- `pollController.ts`: scheduled background attempts (`foreground = false`) stay silent — `refreshing` is only set for explicit foreground refreshes (`controller.refresh()`), and `loading` is not re-triggered on background retries after an initial failure (`error != null`).
- `styles.css`: added `font-variant-numeric: tabular-nums` on `.freshness` so ticking relative timestamps keep constant digit widths.
- Validation: `pollController.test.ts` updated with silent-background-tick and failed-load-retry guards; `job-queue-layout.spec.ts` adds a Playwright guard verifying `Export CSV` keeps its exact `x` position and `Refresh` stays idle during an active 1.5s background poll.

## 2026-11-19 — Job Queue rebuilt on the Incoming Jobs layout, station scope only

The station Job Queue (`/jobs`) no longer has its own list. It now reads the same
page as Web Control's Incoming Jobs, scoped to this station's own jobs, so the two
views cannot drift into two definitions of a row, a verdict or a status bucket.

**Shared list, extracted.** `features/control-jobs/` became `features/job-list/`
(`JobTable`, `SelectionBar`, `JobDetailDrawer`, `JobColumnsDialog`) and
`features/cinema/` (`CinemaBoard`, `CinemaDisplayDialog`, `cinemaModel`,
`cinemaBoard.css`). Each list component now owns its stylesheet —
`jobTable.css`, `selectionBar.css`, `jobDetailDrawer.css` — carved out of the
deleted `pages/WebControlJobs.css`, so a page no longer owns another component's
rules. Class names were deliberately left alone (`wcj-*`, `cinema-*`) so the
existing Web Control Playwright suite keeps matching; the `wcj-` prefix is now
historical rather than positional, which is the debt this entry accepts.

**Generalized rather than forked.** `JobDetailDrawer` takes an optional
`stationName`, `canReview` (the station passes `false`: acknowledging an outcome is
a control-plane triage column, not a station record), optional review callbacks and
an `onOpenFullDetail` action, and is generic over the job type so each page keeps
its own row type. `JobColumnsDialog` takes an `options` list, `CinemaDisplayDialog`
takes `panelChoices`, `SelectionBar`'s review props became optional, and
`visibleJobColumns(selection, excluded)` withdraws a column from the render **and**
from a stored selection. `STATUS_BUCKET_LABEL_KEYS` moved into
`lib/controlJobsView.ts` so both pages name a bucket from one mapping.

**Station page.** Same frame as Incoming Jobs: no header actions, one scope bar
(count, `Freshness`, Export CSV, Columns, framed cinema group), status count chips,
sort selector, search + date presets, an Advanced panel (exact status, custom
dates, grouping, technical-search switch, incoming-key filters), a removable
condition toolbar, a pinned selection bar, column picker + resize + incoming-value
columns, grouped rendering, pagination at 50 rows, and the summary drawer. The
fleet concepts are gone: no station selector, station column, Manage devices, Sync
stations, reviewed-only filter or outcome filter.

**Kept because they are the station's own.** `?status=` deep links from the
dashboard's attention strip (an exact status arrives as a removable chip; the URL
is written back so the view stays shareable), CSV export, the `/jobs/:id` detail
page (now reachable from the drawer), reprint through `POST /jobs/:id/reprint`
with the runner/request safety gates, the 1,000-row truncation warning, the
physical-output warning, and 1.5 s polling. Per-row reprint is gone, matching
Incoming Jobs: reprint lives behind the row's View action, the drawer and one
confirmation that still demands a reason and an explicit duplicate-risk
acknowledgement.

**Removed.** `components/JobQueueControls.tsx` and its test, `pages/jobQueue.css`
(nothing was left in it), and `buildJobQueueView` — its three responsibilities now
live in `filterAndGroupJobs` (filters), `controlJobsView.ts` (buckets, sort) and the
page (paging), one module each.

**Copy.** The reused list vocabulary is read straight from the `control.jobs.*`
keys, deliberately: it is one surface with one vocabulary. Six new
`page.jobQueue.*` keys cover what only a station says (`scopeBarLabel`,
`scopeCount`, `tableLabel`, `emptyNoJobsHint`, `cinemaScope`, `reprintBlockedHint`)
and `subtitle` was reworded to state the scope. All exist in EN and TH.

Validation: web typecheck clean; 830 web unit tests pass (including
`designTokens.test.ts`, `layoutContract.test.ts`, the rewritten
`jobQueueFilter.test.ts` and the new excluded-column case in `jobColumns.test.ts`);
the production web build succeeds; full Playwright on the dashboard build ran 177
tests (68 skipped by the control-build gate): 176 passed, and one load-dependent
failure in `delete-flows.spec.ts` (Templates deletion, unrelated to this change)
that passed on an isolated rerun and in the previous full run. The rebuilt
`job-queue-layout.spec.ts` guards one action region, the absent station selector,
bucket count = rows shown, the `?status=` deep link, the withdrawn Station column,
keyboard resize and reset, the pinned batch bar, and no overflow at 1440/1024/390
in **both** languages; `reprint-safety.spec.ts` and `mobile-interactions.spec.ts`
were repointed at the drawer and bucket paths. Measured at 1024x768: the counts row
lands at y=407 and the first job row at y=614, inside a 768px viewport, with zero
horizontal overflow in TH and EN.

Remaining debt: the `wcj-` class prefix no longer matches its folder;
`CinemaBoard` still requires a `deviceId` per job, so the station passes a
synthetic `'local'` id; and the station queue has no equivalent of the control
plane's reviewed-outcome history by design, so the two pages differ in that one
region.

## 2026-11-19 — Sandbox unverified delivery feedback

`TemplateSandbox` now presents `UNVERIFIED` as a persistent, dismissible warning
using the shared `Alert` primitive. Thai and English copy explain that output may
already exist and ask the operator to inspect the printer before printing again.
Adapter diagnostics remain available in job details rather than being appended
to the operator banner. Confirmed success and actual failures keep their existing
feedback. The recorded job status and submission behavior are unchanged.

Browser regression coverage uses synthetic jobs, checks a single submission and
Thai/English layouts at 1440px, 1024px and 390px. Remaining debt: the existing
physical-output confirmation dialog and submitted-job link still have English
copy in Thai mode; this patch does not expand their scope.

Validation: 824 web unit tests and the production build passed. Playwright
reported 157 passed, 68 skipped and one Job Detail dimension-test timeout;
that timeout passed on an isolated rerun. All six new warning-layout cases
passed, including a screenshot pass with the warning scrolled into view.
The built frontend was copied into the running local `printops-app` container;
the served index returned HTTP 200 with the updated bundle. No additional
physical print jobs were submitted during this UI fix.

## 2026-11-19 — Job Queue layout symmetry and row-action spacing

The Job Queue (`/jobs`) had several visual alignment and spacing issues: the row
action buttons (view details icon button and Reprint button) sat directly inside
`DataCell` with no flex wrapper or gap so they touched/overlapped, table headers
used `12px` inline padding while data cells used `16px` (shifting every header
4px left of its column), the top search toolbar left half the card width empty
while the key-filter toolbar below spanned 100%, a redundant border doubled the
rule between the two toolbars, and at `1024px` `<Select>` controls stayed 38px
tall beside 44px `<Input>` and `<Button>` controls.

- `JobQueue.tsx` / `jobQueue.css`: wrapped row actions in `<Inline gap="sm" className="job-queue-row-actions">` (right-aligned non-wrapping on desktop, left-aligned wrapping `<= 1024px`), widened `.job-queue-toolbar__search` to fill the top toolbar symmetrically with `.job-queue-keyfilters`, removed the duplicate `border-top` on `.job-queue-keyfilters`, centered the `copies` column header/cell, and widened payload chip gaps (`gap="sm"`).
- `experienceSystem.css`: aligned `.ui-data-head` and first/last table cell inline padding to `var(--spacing-lg)` (`1rem`) so column headers line up with cells and table edges align with the card's `1rem` toolbar inset.
- `inputs.css`: enforced `var(--control-height-touch)` (`44px`) on `.ui-input--sm/md`, `.ui-select--sm/md`, and `.ui-input-group .ui-input--sm/md` at `<= 1024px` / coarse pointers so selects, inputs, and buttons share one height on tablet viewports.
- `layout.tsx` / `WebControlContent.tsx`: added optional `align` prop (`'stretch' | 'start' | 'center' | 'end'`) to `Inline` and applied `align="end"` on the labelled field+button rows in Web Control Distribute Content (`Read catalog`, `Import copy`, and `Manage profiles`/`Manage templates`) so buttons sit flush with their sibling inputs/selects instead of floating vertically centered.
- Verified across 1440px, 1024px (TH/EN), and 390px (TH) screenshots, `apps/web` unit tests (824 tests including `designTokens.test.ts` and `layoutContract.test.ts`), Playwright `job-queue-layout.spec.ts` + `control-dimensions.spec.ts` (dashboard build), and `web-control-content-layout.spec.ts` (`VITE_CONTROL_APP=true` build).

## 2026-11-19 — One runner card per logical runner, and its printers once

Deleting a runner no longer leaves its discovered printers behind, but the
duplicates came back on every restart: registration matched on
`name + hostname`, and a Docker runner's hostname is its container id. Every
redeploy therefore created another runner record, another copy of every
discovered printer, and a second runner card — and the display dedupe could not
collapse the printer rows because their `computerName` also changed with the
container.

- The runner **name** is the identity. `RegisterRunnerService` reuses the
  most recently active record with that name and updates its hostname; a
  terminated tombstone still blocks re-registration. Two machines must use
  different `PRINTOPS_RUNNER_NAME` values.
- `latestRunnersByIdentity()` lists one card per name, preferring the record
  with the newest heartbeat, so records created by older builds stay in storage
  (audit) without being shown.
- Reconciliation (boot and the retention sweep) deletes discovery rows held by
  a duplicate record of a runner name that has a newer record, in addition to
  rows whose runner is gone. The runner list and the Discovery page therefore
  stop accumulating copies after every deploy.
- Tests: runner-registration (hostname change reuses the record, one card per
  name, terminated tombstone still refuses), discovery cleanup (shadowed-record
  rows removed in both storage modes, SQL sweep deletes only the older copy).

## 2026-11-19 — A runner can no longer report a print it never made

The Go runner accepted `PRINTOPS_EXECUTOR_MODE=cups`, but it has no CUPS
executor: the dispatcher registered only fake/raw-tcp/zpl/tspl/windows-spooler
and used the fake executor as its fallback. A `cups://` job claimed by such a
runner therefore came back SUCCESS with "fake print completed" while nothing
reached paper — a false positive, which is worse than UNVERIFIED because an
operator is invited to trust it.

- `buildDispatcher()` no longer uses the fake executor as the fallback; the
  fallback is the dispatcher's own refusing executor, so an unknown protocol
  fails with `no executor for protocol "..."`. Fake printing still works for
  printers that are explicitly declared with the `fake` protocol.
- `validateExecutorSupport()` refuses to start a job-executing runner configured
  with `PRINTOPS_EXECUTOR_MODE=cups` and states what to do instead. A
  discovery-only runner (`PRINTOPS_JOBS_ENABLED=false`, the station's normal
  CUPS configuration) still starts and logs that cups execution is absent.
- Tests: `cmd/printops-runner/executor_guard_test.go` proves the refusal, the
  loud failure for `cups`/`ipp`/unknown protocols, that the fake protocol still
  runs when it is explicit, and that a discovery-only runner advertises no
  protocols. Verified by running the binary: `cups` + jobs enabled exits 1 with
  the explanatory message before any login attempt.
- Still open by design: implementing a real CUPS executor (submit through `lp`
  and verify through the IPP job history) is a separate feature; until then the
  station's API executes CUPS jobs and the runner must stay discovery-only.

## 2026-11-19 — NATS settings are configurable in the server build too

The Linux server build could only reach NATS through `PRINTOPS_NATS_*`
environment variables: the Settings panel called `isTauriAvailable()` and told
every browser user that NATS was desktop-only, so a Docker station could not be
pointed at a broker without editing Compose. Both builds now behave the same.

- `apps/api/src/infra/nats/nats-settings.ts` mirrors the desktop shell's schema
  and validation (`nats://` URL, token-safe client id, dotted subject prefix)
  and persists `nats-settings.json` (0600) in the data directory, resolving the
  same path the desktop shell uses.
- `GET`/`PUT /api/v1/print-flow/nats-settings` read and apply the settings at
  runtime: `NatsConnectionManager` gained `applyConfig()` (serialised, drains
  the previous connection and consume loop before reconnecting, `undefined`
  disables intake) plus `getConfig()`, and `start()`/`stop()` are idempotent.
  Retry sleeps are interruptible, so saving during backoff returns in
  milliseconds. Callback senders are re-pointed on apply, and a saved file wins
  over environment variables at boot so "disabled" survives a restart.
- The panel is shown whenever the local API answers (server, Docker and desktop
  alike) and falls back to the Tauri bridge only for a desktop shell; save
  failures surface the API's own message and the source (file/env/default).
- Also fixed on the way: `connect()` no longer retries forever, which used to
  hang API shutdown and the connection-test request while the broker was down.
- Tests: `nats-connection-manager-config.test.ts` (4), `nats-settings-api.test.ts`
  (5, including VIEWER 403 and a redacted audit row) and web
  `natsSettings.test.ts` (8). Verified live against a real `dist/server.js` in
  `linux-server` mode: PUT applied at runtime (status went `CONNECTING` →
  `DEGRADED/CONNECTION_REFUSED` with a retry timestamp, no process restart).

## 2026-11-19 — Stop reporting a completed print as UNVERIFIED

A sandbox test print on the station's EPSON L6580 reached the device and printed,
yet the job was stored `UNVERIFIED` with `PRINT_NOT_VERIFIABLE`. The evidence
recorded by the old image showed the verification read happening once
(`runnerExecMs` 1208 ms against a 40 s window), so the loop gave up instead of
polling.

- `matchAttempt()` correlates device records by physical job (job-id, else the
  id inside job-uri, else uuid) and keeps the most advanced state, so one job
  listed in both the active and the completed set is one job. Only genuinely
  distinct device jobs stay ambiguous (and stay UNVERIFIED).
- `completedOutput()` accepts whichever counter the device publishes
  (`job-impressions-completed` or `job-media-sheets-completed`) instead of
  requiring an attribute this printer never sends.
- `confirmDeviceDelivery()` polls honestly: a failed read or an unsettled
  counter keeps polling, and it returns early only for a real reason (no IPP
  device URI, distinct duplicate jobs, terminal state 7/8) or when the window
  expires. The submission is never repeated.
- Tests: the CUPS adapter suite grew 19 → 27 cases, and the two new regression
  cases fail on the pre-fix adapter. Live proof: one sandbox print through the
  station path came back `SUCCESS` with `ippJobId 13`, `impressionsCompleted 1`;
  read-only checks against the real device confirm the matching job and still
  reject an unknown attempt and an overstated copy count.
- Known gaps reported, not changed: the Go runner has no CUPS executor at all
  (`apps/runner-go/cmd/printops-runner/main.go` registers only
  fake/raw-tcp/zpl/tspl/windows-spooler, so `PRINTOPS_EXECUTOR_MODE=cups` is
  accepted but resolves to the fake executor, which reports SUCCESS without
  printing), and the Epson keeps only the two most recent completed jobs in its
  IPP history.

## 2026-11-19 — Discovered printers of deleted runners are removed

Printer Discovery kept listing printers whose runner had been deleted, and the
same physical printer could appear several times. `discovered_printers` rows are
keyed by `runner_id`, but the repository port had no delete and
`RunnerLifecycleService.remove()` only deleted the runner record, so every row
survived forever; a runner that re-registered under a new id produced a second
copy, and the global-view dedupe could not collapse rows with a blank
`computerName` (their host key falls back to `runnerId`).

- The port gained `deleteByRunner()`/`deleteById()`, implemented in both the
  in-memory and SQLite repositories (schema unchanged).
- `remove()` deletes the runner's discovery rows and records
  `discoveredPrintersRemoved` in the existing `runner.deleted` audit row.
- New `ReconcileDiscoveredPrintersService` deletes rows whose runner no longer
  exists; it runs at boot and in the retention sweep
  (`pruneOrphanedDiscoveredPrinters`, reported as `discoveredPrintersDeleted`),
  independent of the age/count retention settings because it is referential
  cleanup. No age rule is applied on purpose: a registered runner may be
  powered off for longer than any window and still own meaningful printers.
- `SyncPrinterDiscoveryService` collapses duplicates left by a re-registered
  runner (same normalised host + printer name, dead runner only) and never
  merges rows of two live runners.
- Tests: `discovered-printer-cleanup.test.ts` (16, both storage modes, route
  level `GET /v1/discovered-printers` after a delete, reconcile, re-registration
  collapse, retention sweep) plus extended lifecycle/retention suites.

## 2026-11-19 — Zero-command CUPS provisioning (station spooler parity)

Setting up a Linux station used to end in a terminal: CUPS had to be installed,
a driver chosen and `lpadmin` run on the host before PrintOps could import the
queue. Network scanning did not help, because it only probes raw JetDirect
port 9100 and a printer that answers IPP on 631 stayed invisible. CUPS is the
Linux equivalent of the Windows spooler, so PrintOps now manages it directly.

- **Discovery without CUPS.** `packages/adapters/src/windows/ipp-printer-client.ts`
  gained a generic IPP encoder/decoder and `getPrinterAttributes()`
  (operation `0x000B`). `CupsPrinterAdapter.probeHost()/probeHosts()` asks the
  device itself over IPPS first, then plain IPP, and reports make/model, state,
  advertised `printer-uri-supported` and whether the device is driverless.
- **Queue creation over IPP.** New `packages/adapters/src/cups/cups-admin-client.ts`
  sends `CUPS-Add-Modify-Printer` (`ppd-name=everywhere`), `Resume-Printer`,
  `CUPS-Accept-Jobs` and `CUPS-Delete-Printer` either over the local CUPS
  domain socket or to a TCP endpoint with HTTP Basic credentials. CUPS stops a
  destination while it first probes the device, so creation ends by resuming
  and accepting jobs; without that step a new queue reads as `disabled`.
- **Credentials stay on the station.** `apps/api/src/infra/cups-server-settings.ts`
  stores the CUPS administrator account in `data/cups-admin.json` (mode 0600)
  with `CUPS_ADMIN_USER`/`CUPS_ADMIN_PASSWORD` as an environment fallback. The
  status endpoint never returns the password.
- **API.** `CupsProvisioningService` (`apps/api/src/services/cups-provisioning.service.ts`)
  scans hosts, creates the queue, registers the printer (`cups://<queue>`),
  audits `printer.cups_queue_created`, and reports readiness
  (state stopped, missing/insecure filter, raw device reasons).
  New routes on `apps/api/src/routes/printer.routes.ts`:
  `POST /printers/cups-scan`, `POST /printers/cups-queues`,
  `GET|PUT|DELETE /printers/cups-admin`, and `GET /printers/cups-queues` now
  carries each queue's device URI.
- **Printers page.** The CUPS dialog is now three explicit steps — server,
  administrator account, and *Find a printer and add it to CUPS* — followed by
  the existing "register a queue that already exists" path for printers set up
  with a vendor tool. Creating a queue is one click; a stopped queue, a missing
  cup-filters package or a raw device reason is surfaced as a warning instead of
  a silent failure.
- **Fixed a latent IPP bug found while testing against the station CUPS.**
  Repeated `requested-attributes` carried the attribute name on every value;
  RFC 8011 requires an empty name on repeats and CUPS silently kept only the
  first, so a queue appeared to have no state. `requestedAttributeList()` now
  encodes the empty-name form, and `queueAttributes()` polls briefly because a
  freshly created destination answers before it finishes loading.
- Verified live against the station CUPS 2.4 and an EPSON L6580 Series:
  discovery returned `ipps://192.168.10.11:631/ipp/print`, queue creation via
  IPP returned `0x0000`, `Resume-Printer` moved the queue from state 5
  (stopped) to state 3 (idle, accepting), and `CUPS-Delete-Printer` removed it.
  The probe queue was deleted afterwards.
- Tests: `packages/adapters/src/cups/cups-discovery.test.ts` (10),
  `apps/api/src/tests/cups-provisioning.test.ts` (7), and the extended
  `apps/web/e2e/cups-printers.spec.ts` (7, including a full discover → create →
  warning → save-account run). Adapters 149, API 747, web 816 unit tests pass.
- Still manual, by design: a printer that exposes no IPP endpoint at all (raw
  9100-only or USB without a CUPS backend) needs a vendor driver/PPD, which
  PrintOps cannot choose for the operator. The manual `lpadmin` path stays
  documented in `push-registry.md`.

## 2026-11-18 — Import Linux CUPS queues from Printers

The Printers page on Linux offers **Add CUPS printer**. It tests and saves
the CUPS server address, then lists queues for registration. A registered
queue can be selected in Sandbox and printer bindings. The dialog reuses
shared form controls. Queues must already be configured and shared in CUPS.
The setup dialog links to a Thai and English guide for sharing a queue and
choosing the server address, with the connection form preserved on return.

## 2026-11-18 — Web Control job-mirror retention and paging

The Incoming Jobs mirror (`control_device_jobs`) had no cleanup. The station's
14-day history was pruned, but every copy the control plane received stayed in
SQLite forever; the page only ever reads the newest 1,000 rows per station, so
older rows were pure database growth (and every sql.js write rewrites the whole
file).

- Extended `pruneOldRecords` to prune **terminal** mirror rows by the same
  `PRINTOPS_RETENTION_DAYS` window and, when `PRINTOPS_RETENTION_MAX_ROWS` is
  positive, cap retention **per station** at that many rows. In-flight mirror
  rows are kept, matching the core job rule. `DUPLICATE_RETURNED` is treated as
  terminal for mirror rows.
- The same sweep now prunes `control_audit_logs` (command/OTA audit) by the same
  age/count rules, and removes `retention-*.json` archive files older than the
  age window after a successful sweep, so the archive is a recovery window
  rather than a permanent second database.
- Pruned mirror/audit rows are included in the archive-before-delete JSON
  (`controlDeviceJobs`, `controlAuditLogs`) and counted as
  `controlJobsDeleted` / `controlAuditLogsDeleted` / `archivesDeleted` in the
  sweep log.
- Corrected the stale "7 days / 1000 rows" comments in `retention.ts` and
  `CLAUDE.md` to the real defaults: 14 days, row cap disabled (0). Docker's
  `docker-compose.app.stack.yml` overrides to 7 days / 1,000 rows; the
  control-plane compose files set 14 days / 1,000 rows per station explicitly.
- The Incoming Jobs list is paged at 50 rows per page (`Pagination`), so a full
  1,000-row station window no longer creates a 1,000-row DOM at once. Filters
  reset to page 1; a shrinking feed clamps an open page.
- The job-details drawer uses **50vw** on desktop (720px at 1440px) so wide
  payload/evidence values have room; at 1024px and below it stays full width.
- Tests: `apps/api/src/tests/retention.test.ts` covers age cleanup across
  stations, per-station cap, control audit cleanup, archive content, archive
  file expiry, and "no delete when archiving fails"; web unit tests cover the
  page helpers.

**Verification:** API and web typecheck; `npm run test -w apps/web` — 745
passed; `npm run test -w apps/api` — 733 passed, 1 skipped (86 files);
`npx playwright test apps/web/e2e/web-control-jobs.spec.ts` — 24 passed after a
Web Control build; serial full Playwright — 141 passed, 24 skipped, 0 failed.

**Remaining gap:** the 1,000-rows-per-station API limit is still a single
payload for the list; paging only reduces the rendered DOM. Server-side list
paging/summary is the next step if a station's full 1,000-job payload becomes
the bottleneck.

## 2026-11-17 (later) — Incoming Jobs: four questions, one compact list

The Web Control `/control/jobs` page was a fleet dashboard followed by a payload
explorer. An operator had to read metric tiles, station cards, a wide table and a
wall of filters before answering what came in, where it went, whether it printed,
and what to do next. Redesigned around those four questions:

- **One list, not two modes.** All stations is the default and merges every
  station's mirrored jobs; selecting a station filters the same list through
  `?deviceId`. The metric tiles, fleet error table, station-directory cards and
  per-row payload chips are gone.
- **Compact station bar** with the station selector, device-condition summary,
  version, freshness, Sync and Manage devices in one region. Status counts are
  34px clickable chips (All, Needs review, In progress, Printed, Other) whose
  numbers come from the same filtered set as the rows. Attention jobs sort first,
  then newest.
- **Rows show only** the job reference, destination printer (plus station in All
  stations), literal status with a plain-language verdict for attention states,
  received time and one `View job` action. Mobile uses the responsive table's
  record cards; long references, station names, errors and payload values wrap.
- **Search and date presets above the list**; custom dates, grouping and payload
  key/value filters live behind `Advanced filters`. Every active condition is a
  removable chip, with Clear all.
- **Summary-first details drawer**: destination, status, received, copies; what
  happened and the next step reuse the existing `jobVerdict` copy (SUCCESS reads
  as reported-complete, never device-confirmed). Incoming data and technical
  details (full IDs, error code/message, timestamps, raw JSON, mirrored error
  log) are collapsed and copyable; `CodeBlock scroll={false}` keeps the drawer
  body the only vertical scroller.
- **Reprint safety preserved**: `job:retry` gates selection, the drawer action
  and the dialog; the destination comes from each job's station; an unknown
  outcome shows the "may already have printed / check the destination printer"
  warning and the final action is danger. `control:manage` is no longer used on
  this page — rename stays on Manage devices.
- **New helpers/tests**: `apps/web/src/lib/controlJobsView.ts` (bucket matching,
  counts, attention-first sort) with `controlJobsView.test.ts`; 67 new
  `control.jobs.*` keys in both locales; `web-control-jobs.spec.ts` (23 rendered
  tests, skips on the dashboard build because `/control/*` only exists when
  `VITE_CONTROL_APP=true`).

**Verification:** 745 web unit tests; web build; 23/23 control-build e2e; serial
full Playwright 141 passed / 23 skipped (the new control spec, dashboard build);
no horizontal overflow at 390px TH/EN; first row y 434 (1440) / 502 (1024) /
683 (390); no nested table or raw-JSON scrollbar. Detailed evidence:
`artifacts/browser/web-control-jobs/verification.md`.

**Remaining gaps:** the mirrored control feed carries no job trace/log, so the
drawer can show only an error log derived from `errorCode`/`errorMessage` and says
when none is present. Batch reprint, unknown `?deviceId`, sync success/failure and
background-refresh staleness are implemented but not exercised by the new e2e
spec. The full suite is load-flaky with default parallel workers on this machine;
serial is green.

## 2026-11-17 (release 0.1.48 / 1.0.11) — Runner terminate & delete

The Runners page had no way to stop or remove a job receiver. Added:

- **`POST /api/runners/:id/terminate`** stops a runner taking work and keeps its record
  as a tombstone (`metadata.terminated`, `terminatedAt`, `terminatedBy`, status
  `offline`); **`DELETE /api/runners/:id`** removes the registration. Both are guarded by
  `runner:manage`, audited (`runner.terminated` / `runner.deleted`) and publish
  `RunnerTerminated` / `RunnerDeleted`.
- **At least one runner must remain.** Removing the last runner able to claim work is
  refused with `409 CONFLICT` and an explanation, because the queue would silently stop
  draining. The rule counts raw records, so legacy duplicate rows still count; the page
  applies the same rule to the deduplicated list and disables the button with a reason.
- **A terminated runner cannot come back on its own**: heartbeat, the legacy poll, the
  `jobs/next` claim and re-registration under the same host+name all return `409`. It can
  still report results for jobs it already claimed, so in-flight work is not stranded.
- **UI:** an Actions column with Terminate/Delete, a confirmation `Dialog` (backdrop
  click disabled for the destructive case), a `Terminated` badge, an inline `Alert` on
  the API's 409 message, and a success notice. Reuses existing primitives; new strings in
  both locales; no new stylesheet or literal colour.
- **Tests:** `apps/api/src/tests/runner-lifecycle.test.ts` (9) and
  `apps/web/src/__tests__/runnerLifecycle.test.ts` (4).

## 2026-11-17 (later) — Web Control shows no data: job mirror, blank-screen gates

The Incoming Jobs hub shipped in `b01dae9` read a mirror that nothing ever filled,
and two page-level gates could blank the whole shell. Fixed:

- **Job mirror producer.** `PrintOpsControlAgent.buildHeartbeat()` now attaches
  up to 50 changed, redacted jobs (`HEARTBEAT_MAX_JOBS`), bounded to a 192 KiB
  serialized budget and resent in full every five minutes. The in-process agent
  reads `jobRepo`; the standalone agent reads it over loopback through the new
  `ControlTargetHttp.getLocalControlJobs()`. Nothing in the product had ever
  produced `recentJobs` or called `POST /control/devices/:id/jobs`, so the hub was
  empty for every station the control plane could not dial.
- **Discovery address.** Discovery stores `host:port` instead of `hostname`, so a
  station on a non-default port is no longer pulled from `:31415` (which filed one
  station's jobs under another device). Pulls also discard a mirror whose reported
  installation identity disagrees with the device record, and SQLite `create()`
  now persists `ip_addresses_json`/`capabilities_json` (a discovered device had no
  pull address until a second discovery pass).
- **Co-located and multi-station discovery.** Discovery is a list
  (`PRINTOPS_CONTROL_DISCOVERY_TARGETS`), not one pinned station, and a background
  sweep now pulls the job mirror of *every* station the control plane knows — enrolled,
  announced or discovered — every 30 seconds, so a customer that appears once shows up
  without pressing Sync. No deployment names a specific station in a required variable.
- **Pull authentication.** `/control/local-jobs` (job payloads) and its reprint trigger
  were unauthenticated. An enrolled station is now read with a credential both sides
  derive from the device token hash (no configuration per customer); a station that
  never enrolled uses the optional `PRINTOPS_CONTROL_PULL_TOKEN`; an operator session
  or the loopback updater token also works. A station with neither warns at startup.
- **Blank Web Control shell.** An empty `allowedPages` array denied every page and
  emptied the sidebar (RBAC parity made this reachable); a legacy page list saved by
  the dashboard build locked the control build out; unknown `/control/*` URLs
  rendered an empty `<main>` because there was no catch-all route; and the Jobs hub
  read `currentVersion`, which the API never sends. All four are fixed, with tests
  in `apps/web/src/__tests__/` and `apps/api/src/tests/`.
- **Web container followed a stale API address.** `apps/web/nginx.conf` resolved the
  API upstream once at startup, so recreating only the API container left the running
  web container proxying to the old address — the dashboard then showed nothing while
  the API was healthy. It now resolves per request via Docker's resolver.
- **Verified in Docker Desktop** with a control plane, two separate stations and the
  web image built from source: both stations were discovered from the generic target
  list, their jobs appeared without pressing Sync, the payload explorer received the
  keys, the web container served the Web Control bundle and returned the same data,
  and unauthenticated station pulls were refused once the shared token was set.

## 2026-11-12 (later) — real-data review and concept retheme

The first pass used a mocked API and missed problems that only appear with records. This pass rendered all 18 routes against the running dev API (real data, Thai and English, 1440 and 390px) and applied the owner's concept board.

**Visual system:** indigo primary, light rail, cool page canvas, 8/12px corners, soft card lift on top-level surfaces only, separate metric cards, underline tabs, soft status pills (all through tokens; ~110 hard-coded blue/navy literals converted to tokens first).

**Consistency fixes:** one row-action pattern (bordered icon buttons, outlined danger) on Templates, Paper Profiles, Webhooks and Printer Bindings; Users moved the active switch into the Status column and put actions on one line; header actions share 44px with the freshness stamp first; table empty states are quiet; one table-head colour (feature overrides removed); the Web Control indicator joined the right-hand topbar tools; panel footers in a grid pin to the bottom (Export Center).

**Page fixes:** Route Policies subtitle (EN/TH, checked against the API's actual matching), Evidence Canvas editor, list first; Printer Bindings dropdowns instead of typing a profile UUID, no demo pre-fill, profile codes instead of ID hashes, Edit now scrolls `<main>`; Print Flow aligned copy rows, duplicate URL removed, 3-column bind form, a Default badge instead of "Enabled"; Sandbox literal `<strong>` tags; Webhooks pager and phone page-size select; Settings Reset demoted.

**Verification:** typecheck clean; 674/674 unit tests; production build OK; axe 0 violations and no overflow on 36 real-data renders; Playwright 55 pass / 25 fail, the same 25 as unmodified `main`.

**Follow-up in the same session:**
- Confirmations added: deleting a printer binding restates printer/template/paper first; Settings Reset (which clears this device's stored X-Api-Key) restates that consequence first, using the previously unused `settings.resetConfirm` string.
- Printer Bindings English form labels were raw keys (`printerCode`, …) — now "Printer / Template / Paper profile".
- Settings readiness: problems sorted first (unavailable → degraded → not configured → ready) and rendered as one ruled list instead of 13 cards.
- 1024px (the desktop window width): row actions no longer wrap into 218px-tall rows; when a table is wider than its frame, the actions column is pinned to the right edge (the legacy `.data-table { overflow: hidden }` that defeated this is now `visible`).
- Final check: 108/108 real-data renders (18 routes × 1440/1024/390 × TH/EN) with 0 axe violations, 0 overflow, 0 raw keys; typecheck clean; 674/674 unit; build OK; Playwright fails the same 25 tests as `main`.

**Second follow-up:**
- Settings readiness messages now render in Thai: `i18n/readinessMessages.ts` maps every sentence the API emits (a test reads `readiness.routes.ts` and fails if a new literal sentence is added without a translation); unknown text still shows verbatim.
- Sandbox copies stepper: the − and + buttons both announced as "Copies"; now "Decrease/Increase copies", and − is disabled at 1.
- Paper-profile field cards: the Key input gets its own row (was ~150px, under the 160px readability floor).
- E2E suite repaired: the 25 long-standing failures were stale selectors from earlier refactors (removed `.pp-icon-btn`, `.ds-modal`, `.job-queue-cards`, mobile nav now a dialog), outdated copy, a fixture that client validation correctly blocks, and a QR test that measured the quiet-zone box instead of the symbol. Selectors moved to roles/names. Result: 80/80, twice in a row; 677/677 unit.
- Two renders that failed during the 108-render sweep were 30s timeouts under 4-worker load; both passed on re-run with no findings.

**Owner decision (2026-11-12): Printer Bindings owns binding management.** Print Flow no longer has its own create form or default/enabled toggles; it shows the bindings read-only beside the API they drive, with a "Manage bindings" link. Users granted only Print Flow access can still see bindings but must be given Printer Bindings access to change them.

Also verified at 1920, 1280 and 768px (54 more renders, 0 issues), and edge-to-edge panels now inset their title row.

**Still needs the owner (not changed):**
- Native-speaker review of the Thai copy (including the new readiness translations); a Windows build to see the desktop shell.


## 2026-11-12 — cross-page audit and token pass

**Done** (details and evidence in `ux-audit.md`):

- Muted text token `#6b7280` → `#5f6673`; pastel error text → `--state-danger-text`. axe contrast violations: 20/20 routes → 0.
- 134 literal font sizes mapped onto the seven-rung scale; added `--font-action-size`. Rendered sizes outside the scale: 4 → 0 (apart from the sanctioned verdict headline).
- `StatusBadge.css` made the sole owner of `.status-badge` (two competing blocks deleted from `styles.css`).
- Job Detail: missing `page.jobDetail.printer` label (EN/TH); Copy Debug JSON moved out of `<summary>`.
- Webhooks: labelled the hidden import file input.
- Route error screen rebuilt from the shared `Button`; gradient/glow button CSS removed.
- 390px gutter 8px → 12px; selection, accent and scrollbar colours themed.
- Guards: `apps/web/src/__tests__/designTokens.test.ts` (contrast, type scale, ownership ratchet, no new hotfix sheets).
- Docs: this folder, DESIGN.md token/rule updates, `.impeccable/design.json` sidecar, AGENTS.md frontend rules.

**Verification:**

- `npm run typecheck -w apps/web`: clean. `vitest`: 674/674. Production build: OK.
- Rendered sweep, 20 routes × 1440/1024/390: 0 axe violations, 0 horizontal overflow.
- Playwright e2e: 55 pass / 25 fail, identical failing set on unmodified `main` (stash, rebuild, rerun, diff).
- Not verified: Tauri native window, physical screen reader, Thai copy review by a native speaker.

## 2026-11-12 — network printer discovery

- Added a network search form to Discovered Printers: select a Runner, enter IPv4 addresses/CIDR/ranges, then review search state and register reachable TCP 9100 candidates.
- Reused `Panel`, `Stack`, `FormField`, `Input`, `Select`, `Button`, `Alert`, and existing typography exports. No stylesheet, token, or global override was added.
- Added English/Thai copy for queued, running, completed, incomplete, expired, validation, and retry states. Search remains unavailable for viewers and explains when a Runner update is required.
- Rendered English and Thai at 1440px, 1024px, and 390px: labels and help text wrap, controls remain usable, and no horizontal page overflow was observed. Captures: `artifacts/browser/commit-network-{en,th}-{1440,1024,390}.png`.
- Unit tests: 677 web tests passed; production web build passed. The full Playwright suite passed 130 tests, including registration, newer searches from another operator, invalid inputs, status retry, permissions, and restored terminal states.
- Remaining verification: actual VPN/printer access and native Windows packaging. No additional styling debt introduced.

## 2026-11-18 — Incoming Jobs cinema mode

- Added a fullscreen presentation mode to `/control/jobs`: `CinemaBoard`
  (`apps/web/src/features/control-jobs/`), a scoped `cinemaBoard.css`, and a
  pure `cinemaModel.ts` with 16 unit tests plus 5 server-rendered board
  contracts. Entry is a station-bar button plus `?cinema=1`; exit is any key, a
  tap/click that did not drag, or leaving fullscreen.
- The board projects the feed the page already reads: counts come from
  `countStatusBuckets` (no second status list), plus a 30-minute flow ladder, a
  station ladder, a newest-first feed and a ticker, and a live indicator that
  states the age of the last successful poll.
- Design delta, recorded in `DESIGN.md` ("Cinema mode") and
  `docs/design/incoming-jobs-cinema-mode.md`: the board borrows the Evidence
  Canvas shades, adds a display type ladder and scoped motion. All three are
  confined to `.cinema`; every other surface stays light and still. Motion stops
  under `prefers-reduced-motion`.
- Verified: 766 web unit tests pass, typecheck passes, Control build passes,
  35/35 Incoming Jobs Playwright tests pass (9 cinema cases + 6 screenshots at
  1440/1024/390 in EN/TH), and an in-browser contrast audit found no text role
  below 4.5:1 on the board. The dashboard build then ran the full suite:
  141 passed, 34 skipped (the Control-only spec), 0 failed.
- No new API, no token renamed, no shared component restyled. Remaining work:
  a real wall-display check on the target screen and an operator pass on the
  copy in Thai.
- Interval budget kept small: the board ticks at the feed cadence (5 s) instead
  of every second, only the header clock keeps its own 1 s timer, and both
  timers pause while the tab is hidden.
- Independent review (design/a11y, React correctness, tests/i18n) found four
  majors and six minors. Fixed before landing: fullscreen ownership under React
  StrictMode (the board closed itself on entry in dev), the pulsing "New" label
  dropping below AA mid-animation, pointer-down exit blocking touch scrolling,
  flow-ladder columns remounting every second, a cold start claiming "Live",
  colour-only offline state, a vacuous document-scroll assertion, and
  non-discriminating test fixtures. Kept deliberately: the single-line reference
  on the board (full value in the title attribute and on the page behind it),
  and "any key exits" including Tab (the owner's exit requirement).

## 2026-11-18 — Incoming Jobs cinema: choose the row label

- The cinema feed used the job reference as its only row label, and operators do
  not recognise `REQ-...`. Added a **Display data** dialog in the station bar that
  projects up to three incoming payload keys onto the board, in the order chosen,
  with a sample value and a job count behind each key.
- The choice lives in `?cinemaFields=hn,patient_name`, so a wall display can be
  configured once and survive a reload. Rows show the values as the main label and
  keep the reference in muted mono, falling back to the reference when a job has
  none of the chosen values.
- Reused `extractJobPayload`, so the picker can only offer keys the drawer and the
  payload filters already show. New model functions `describeCinemaFields` and
  `cinemaJobLabel`; no new stylesheet.
- Verified: 776 web unit tests (10 new), typecheck, Control build, 36/36 Incoming
  Jobs Playwright tests (1 new display-field case).

## 2026-11-18 — Incoming Jobs list columns

- The list's five columns were fixed. A **Columns** picker now toggles Destination,
  Station, Received, Copies, Template, Source, Runner, Error code **and any
  incoming payload key** (up to three, in click order). Job, Status and Actions
  stay fixed. Job fields keep a canonical order, an empty value renders an em
  dash, and adding the Station column stops the destination cell from repeating
  the station.
- Incoming-value columns are offered by key with a sample value and job count from
  the same `extractJobPayload` projection the drawer uses; a selected key that
  leaves the scope stays listed and renders em dashes rather than disappearing.
  Long values clamp to two lines with the full value in the title.
- New pure module `lib/jobColumns.ts` with 10 unit tests. The row and the head now
  render from one column list, so the two cannot drift.
- The choice is a workstation preference in `localStorage`
  (`printops-control-jobs-columns`), like the locale - not URL state, because it
  is presentation rather than a filter. Unreadable stored ids fall back to the
  shipped default (Destination + Received); valid payload ids survive.
- Verified: 786 web unit tests, typecheck, Control build, 38/38 Incoming Jobs
  Playwright tests (2 new column cases: job fields and incoming payload keys).

## 2026-11-18 — Station bar: cinema controls are one group

- "Display data" and "Cinema mode" now sit in one hairline-framed, lightly tinted
  group (`role="group"`, "Cinema display"): they configure the fullscreen board
  and never change this page's list. "Columns" stays outside the group because it
  does change the list.
- Page-scoped CSS only (`wcj-cinema-group` in `WebControlJobs.css`), tokens plus
  `color-mix`, no new shared component and no global override.
- Verified: typecheck, 786 web unit tests, Control build, 39/39 Incoming Jobs
  Playwright tests (1 new check for the frame, radius, tint and group role), full
  suite 141 passed with the Control-only spec skipped.

## 2026-11-18 — Incoming Jobs: removable reference and live column widths

- The job reference is no longer a fixed column: the Columns picker can remove it
  (Status and Actions stay). Column dividers are draggable, with arrow-key nudges
  and double-click/Home resets; a column grows by taking width from its right
  neighbour, so the table keeps its total width and never overflows. Widths are
  session state and reset on reload, per the "arrange it live" rule; the column
  choice stays a stored workstation preference.
- Cinema rows gained "Show job reference" (drop the trailing reference when a
  value is chosen) and a Narrow/Balanced/Wide value column. Both are session
  state applied to the board, which stays passive.
- Verified: 787 web unit tests, typecheck, Control build, 41/41 Incoming Jobs
  Playwright tests (2 new: hide-reference + drag/keyboard resize + session-only
  reset; cinema hide-reference/width), full suite 141 passed.

## 2026-11-18 — Incoming Jobs: cross-station selection and a pinned reprint bar

- Selection no longer requires a single-station scope: every row carries a
  checkbox in All stations too, because each job carries its own device and the
  batch submit already posts per job. The reprint dialog names the distinct
  destinations.
- The batch bar is fixed to the bottom of the viewport (rail offset, safe-area
  padding, floating shadow, z-index under dialogs), with a spacer so it cannot
  hide the last row. It appears the moment a row is checked and stays on screen
  while the list scrolls.
- Verified: 787 web unit tests, typecheck, Control build, 42/42 Incoming Jobs
  Playwright tests (1 new: cross-station select, fixed position, scroll, dialog
  destinations, clear), full suite 141 passed.

## 2026-11-18 — Incoming Jobs: acknowledge an UNVERIFIED outcome

- Operators can mark a `FAILED`/`UNVERIFIED`/`TIMEOUT`/unknown job as reviewed
  from its drawer. The control plane stores the acknowledgement
  (`control_device_jobs.reviewed_at` / `reviewed_by`, additive `ensureColumn`, no
  schema bump); the station's status, payload and error text are never rewritten.
  A reviewed job leaves Needs review, counts as Other, sorts after the pending
  ones, and shows a muted "Reviewed" line with the status unchanged. "Undo
  review" restores it.
- The mirror upsert moved from `INSERT OR REPLACE` to `ON CONFLICT DO UPDATE`, so
  a station re-sync refreshes the job body without deleting the acknowledgement.
  `POST /api/v1/control/devices/:id/jobs/:jobId/review` (`job:retry`) also
  excludes reviewed jobs from the server-side attention stat.
- Verified: 790 web unit tests, 27 control API tests (3 new for the
  acknowledgement), typecheck for both workspaces, Control build, 43/43 Incoming
  Jobs Playwright tests (1 new: reviewed job leaves Needs review with its status
  intact), full suite 141 passed.

## 2026-11-18 — Job Queue: the rows finally line up

Reported: uneven padding on the queue page, inputs flush against the card edge,
and buttons that were not on the same line as the fields they belonged to.

Measured before touching anything (Playwright, computed boxes at 1440/1024/390):

- the search row inset its content by 16px, the key-filter row below it inset by
  **0** - so the two toolbars inside one card started at different x positions and
  the second one's inputs touched the border;
- the key filter used a four-column `Grid`, and `.ui-grid--4` collapses to one
  column at 1024px, so on a laptop the three fields stacked full width and the
  action buttons dropped onto a line of their own;
- the two header actions were 44px and 29px tall (freshness used a `sm` button),
  leaving the pair visibly ragged.

Fixes, all scoped and measured:

- `.job-queue-keyfilters` now insets `0.75rem 1rem` and carries a top divider, so
  both rows of the card align to the same 16px grid.
- the fields became a wrapping flex row (`flex: 1 1 10rem; min-width: 9rem`) with
  the actions in their own bottom-aligned box, so fields and buttons share one
  line at 1440 and 1024 and wrap cleanly at 390 instead of splitting the row.
- the freshness refresh button is a normal-size button now, so every page header
  with a page action beside it has one honest line.

New guard: `apps/web/e2e/job-queue-layout.spec.ts` asserts both toolbars inset
their content identically and symmetrically, that the action group's bottom edge
matches the inputs' in the key-filter row, that the two header actions share a
centre line from 1024 up, and that the card never scrolls sideways - at 1440,
1024 and 390. Verified: 816 web unit tests, the affected dashboard specs 25/25,
full suite in the release log.

## 2026-11-18 — Incoming Jobs: confirm what happened, and filter by it

Reported: an UNVERIFIED row only offered a bare "reviewed" mark, the "printed -
cannot be confirmed" note kept showing after somebody had actually checked, and
there was no way to filter by status at all - the buckets answer "what needs me?",
never "show me UNVERIFIED".

- **The drawer asks the real question.** Two buttons, *Confirm: it printed* and
  *Confirm: it did not print*, store `reviewed_outcome` (`PRINTED` /
  `NOT_PRINTED`) beside the acknowledgement. Additive column, no schema bump, and
  the station status is still never rewritten.
- **The row states the move.** `UNVERIFIED → it printed` under the status badge
  instead of relabelling the job; the drawer says the same plus who confirmed it.
- **The unconfirmed warning is shown only while it is still unconfirmed.**
- **Exact status filter** (any single server status) and **Confirmed outcome
  filter** (any / not confirmed yet / printed / did not print) in the advanced
  panel, both applied to the base set so count chips and rows agree, both visible
  and removable in the active-filters row, both reset by Clear all.
- **Undo clears both**, and the API ignores an outcome on an un-acknowledgement.
- API: `POST /control/devices/:id/jobs/:jobId/review` accepts an optional
  `outcome`, validates it against the two answers, audits it, and reads it back in
  the fleet payload.
- Verified: 740 API tests (2 new: outcome stored/replaced/cleared, audited with
  the review) and 816 web unit tests; 64/64 Incoming Jobs Playwright tests (the
  review test now proves the transition, the cleared warning and the undo; one new
  test proves both filters and their chips).

## 2026-11-18 — Incoming Jobs: the technical details can leave the search

Searching matched the fields the drawer keeps under "Technical details", which is
how support finds a job from a log line but also why a short word can return rows
that look unrelated. The fix is a switch, not a narrower search:

- `collectJobSearchCandidates` now tags each candidate `primary` or `technical`
  (internal job id, source reference, error code and message, raw snapshot). One
  list, so the filter and the "Matched: ..." explanation drop them together.
- A checkbox in the advanced panel (**Search technical details too**) turns them
  off for the session; default stays on so nothing existing changes.
- While it is off it behaves like any other condition: a removable
  **Technical details excluded** chip in the active-filters row, and Clear all
  restores it.
- Verified: 816 web unit tests (4 new), 63/63 Incoming Jobs Playwright tests
  (1 new: 'cable' finds the failed job, switching the details off empties the
  list, a template hit still works, the chip restores it), typecheck, Control
  build.

## 2026-11-18 — Incoming Jobs: the caps that rationed space are gone

The report: a wide screen sat half empty while the operator could not show the
fourth value they needed, on either surface, and the ID could not be dropped
everywhere.

- **Cinema row values: three -> eight.** Each value is its own span inside a flex
  row, so they share the width equally and truncate individually (full value in the
  row title) instead of one joined string that clipped as a whole. A fourth value
  now costs nothing but a narrower share.
- **Incoming list columns: three -> eight.** Same reasoning: the ceiling exists to
  stop "select everything", not to ration width the table already has.
- **The cinema reference is now the operator's call.** "Show job reference" no
  longer depends on having chosen values, so a site that never uses references can
  hide them outright. Only the reference and Status/Actions stay optional/fixed on
  the list as before, so the ID column can be removed on both surfaces.
- **One overflow bug found by the new measured test:** with four values, the feed
  header's unbreakable key list pushed the 390px board 30px sideways (then 338px
  once the label change landed). `.cinema-card-meta` had no `min-width: 0`, so it
  sized to content; it now shrinks and `.cinema-feed-fields` clips with an
  ellipsis.
- Verified: 812 web unit tests (2 new: five-value rows, the ceiling itself), 62/62
  Incoming Jobs Playwright tests (3 new capability tests, 2 measured across
  TH at 1440 and 390), typecheck, Control build.

## 2026-11-18 — Incoming Jobs: search explains itself (reported bug)

Typing `do` returned rows whose references began `ab`, with nothing on them
containing the query. The filter was working; it was matching fields the table
does not show - `ab` is inside `PATIENT_LABEL` (template code), and a short term
like `do` was also matching payload *keys* such as `dob`.

- **Incoming keys now match the whole term** (`dob` finds them, `do` does not);
  values still match anywhere inside them, and the advanced panel's `key = value`
  filter is the way to browse by key. The phantom class is gone.
- **Every row can say why it is there.** `collectJobSearchCandidates` /
  `describeJobSearchMatches` / `hiddenSearchMatches` name the field that matched
  and the column that would show it; the reference cell gains one muted line
  (`Matched: Template · PATIENT_LABEL`) only for hits no visible column shows, and
  one line above the list counts those rows. Turning the column on removes the
  hint, because the row now shows the value.
- The filter and the explanation read the same candidate list, so they cannot
  disagree about what matched.
- Verified: 810 web unit tests (10 new), 57/57 Incoming Jobs Playwright tests
  (1 new behaviour test, 6 measured layout tests across EN/TH at 1440/1024/390).

## 2026-11-18 — Incoming Jobs: the page sheds its three biggest regions

`WebControlJobs.tsx` had grown to 2.6k lines, one feature at a time. Three
regions moved into `features/control-jobs/`, each with the state that only it
needs:

- **`SelectionBar.tsx`** - the pinned batch bar. It now measures itself and
  reports its height to the page instead of the page measuring a DOM node it does
  not own, and it decides which of the four actions exist from three counts.
- **`JobDetailDrawer.tsx`** - the whole summary drawer: verdict copy, incoming
  data, technical fields, raw JSON, logs, and its own copy-to-clipboard feedback
  (the page no longer holds `copiedField` or the two-second timer).
- **`JobTable.tsx`** - header, group select-all, body rows, column widths and the
  resize handles, as a `colgroup` + `thead` + `tbody` fragment so the page keeps
  `<DataTable>` (which is what makes record cards below 768px). Cell *meaning*
  stays in the page as `renderCell`, and the width limits moved here so the
  handle's announced range and the clamp cannot disagree.

Supporting moves: `copyTextToClipboard` to `lib/clipboard.ts`, and the three
copies of `{name}` interpolation (`fill`, `formatMsg`, the paper-profile
`formatMessage`) now resolve to `lib/formatMessage.ts`.

Result: 2,631 -> 2,117 lines, with 800 unit tests, typecheck, Control build and
49/49 Incoming Jobs Playwright tests green. What is left in the page is the page's
own job - URL state, filters, selection and the reprint handshake - plus the
filters panel and the station bar, which the same split should take next.

## 2026-11-18 — Repository hygiene: three traps that cost real time

- **The publish workflow had a `push` trigger on its own file.** Editing it
  republished whatever version its default held, which invalidates the digests
  recorded in `push-registry.md`. It is `workflow_dispatch` only now, the version
  has no default, and a guard refuses to publish a tag that already exists.
- **`.delta/` holds the agent harness's throwaway worktrees** - full copies of this
  repo. A path-filtered `vitest` run matched the stale copy and reported its
  failures as ours. It is ignored by git and excluded from the web test run.
- **The API image shipped its compiled tests**, and then its `.d.ts`/`.map` build
  outputs as well. Both never leave the build stage now.

## 2026-11-18 — Incoming Jobs: two filters that could only ever be empty

- "Needs review" and "Reviewed only" are disjoint by definition, so having both on
  produced a guaranteed empty list. They are now mutually exclusive: turning the
  reviewed view on drops the triage filter, and picking Needs review leaves the
  reviewed view. Verified in the same test that proves the reviewed rows.

## 2026-11-18 — Incoming Jobs: the selection bar no longer covers the list on a phone

- Four actions (clear, mark, undo, reprint) wrap to four lines at 390px: the bar
  measured 146px against a flat 72px spacer, so it sat on top of the pagination and
  the last rows. The spacer now takes the measured bar height (ResizeObserver, plus
  the 4.5rem fallback for first paint), and a new measured test holds the line:
  bar inside the viewport, no sideways scroll, four reachable actions, spacer at
  least as tall as the bar.

Verified: 800 web unit tests, 49/49 Incoming Jobs Playwright tests (1 new).

## 2026-11-18 — Incoming Jobs: the acknowledgement, from the operator's side

Five decisions taken by looking at who is actually standing in front of the page:

- **The Reviewed chip moved out of the status toolbar.** Acknowledgements cut
  across the status buckets, so a chip inside a toolbar labelled "Filter by
  status" read as a fifth bucket. It now sits with sort/search/dates as
  **Reviewed only (N)**.
- **Bulk undo exists.** A mis-clicked batch used to have to be repaired one
  drawer at a time; selecting acknowledged rows now offers **Undo review (N)** in
  the same pinned bar, through the same sequential handler.
- **The reviewed-only view cannot outlive its rows.** Undo the last
  acknowledgement in scope and it switches itself off, instead of leaving an empty
  list behind a hidden-but-active filter.
- **Reading keys no longer close the cinema board.** Tab, arrows, Home/End/PageUp/
  PageDown and a bare modifier are ignored; Escape, any click and every other key
  still exit. "Press anything to get out" holds for a person at the wall, and a
  screen-reader user can finally read the board instead of closing it on the first
  arrow press.
- **The API image no longer ships its compiled tests** (`rm -rf apps/api/dist/tests`
  in the build stage): no test runner or test code belongs on the server.

Verified: 800 web unit tests, 48/48 Incoming Jobs Playwright tests (1 new keyboard
test, the bulk test now covers undo), typecheck, Control build.

## 2026-11-18 — Incoming Jobs: the cinema board honours the acknowledgement

- The board derived its "Needs review" tile, the attention segment of the
  throughput stack, the per-station review count and the row tone from the raw
  status, so an acknowledged job still glowed amber on the wall while the list had
  already filed it under Other. `cinemaNeedsReview` / `cinemaJobTone` in
  `cinemaModel.ts` now apply the same `reviewedAt` rule as `matchesStatusBucket`,
  and `CinemaJob` carries `reviewedAt`.
- Verified: 32 `cinemaModel` tests (6 new covering tiles, throughput, station rows
  and both tone helpers), 7 cinema board tests.

## 2026-11-18 — Control plane: acknowledge is audited

- `setJobReviewed` was the only mutation in `WebControlRegistryService` that wrote
  no `control/audit` record, so "who cleared this UNVERIFIED job, and when?" had
  no answer beyond the current `reviewed_by` column. It now records
  `job.reviewed` / `job.unreviewed` with the actor, the job id and the status the
  job carried (read from the mirror, falling back to the row after a restart).
- Verified: 5 API tests (2 new: the audited pair, and that a refused
  acknowledgement writes nothing).

## 2026-11-18 — Incoming Jobs: find what was acknowledged, and clear it in bulk

- Added a **Reviewed (N)** chip to the count toolbar (only when the scope carries
  acknowledgements) that narrows the list to those rows; Clear all filters drops
  it. Without it an acknowledged job was indistinguishable from the rest of Other.
- Added **Mark N as reviewed** to the pinned selection bar, counting only the
  selected rows that still need a human; sequential requests, selection cleared on
  success, first failure reported and the run stopped.
- Added **Reset widths**, which appears next to Advanced filters only once a column
  has been dragged.
- Changing the sort order now returns to page 1, like any other filter change.
- Verified: 800 web unit tests, 47/47 Incoming Jobs Playwright tests (3 new).

## 2026-11-18 — Incoming Jobs: cinema panels, and the page starts shedding weight

- The **Display data** dialog now also chooses which optional panels the board
  carries - throughput chart, station list, scrolling ticker - stored in the URL as
  `cinemaPanels`. The job list is never optional; missing, empty or unknown values
  keep the full board, the last panel cannot be unchecked, and the layout reflows
  (flow full width without the ladder, the ladder full width without the flow, the
  feed owning the board when neither is on).
- Extracted `JobColumnsDialog` and `CinemaDisplayDialog` into
  `features/control-jobs/`, and the `{name}` interpolation into
  `lib/formatMessage.ts`. `WebControlJobs.tsx` is still large (~2.5k lines): the
  job table, the station bar and the drawer are the next extraction, deferred so
  this round could ship.

## 2026-11-18 — Incoming Jobs: sort by received time

- Added a compact sort selector above the list: Needs review first (the existing
  triage order, still the default), Newest first and Oldest first. The time sorts
  are pure `createdAt` orders with a stable tail for unparseable timestamps and
  the same `id` tie-break; group rows use the same order. Session state, like the
  filters.
- `needsReviewFirstHint` now only renders while the triage order is active, so the
  page cannot claim an order it is not using.
- Verified: 792 web unit tests (2 new for `sortJobs`), typecheck, Control build,
  44/44 Incoming Jobs Playwright tests (1 new), full suite 141 passed.

## Next, in order

1. **Fold the paper-profile hotfix layers** (`paperProfilesLayoutHotfix`, `Closure`, `Completion`, `LibraryGeometryHotfix`) into `paperProfilesLibrary.css` / `paperProfilesEditor.css`, deleting `!important` as you go. Gate: `paper-profile-ux` and `paper-profile-layout-regression` e2e, which first need their pre-existing failures fixed so they can detect a regression. Then delete the entries from the hotfix list in `designTokens.test.ts`.
2. **Retire `experienceSystem.css` as an override layer**: move each rule into the component stylesheet that owns the class (see `component-inventory.md`), one family per change, lowering the ratchet ceiling each time.
3. Fix the 25 pre-existing e2e failures (mostly paper-profile editor selectors and 30s timeouts).
4. Guard `Settings.tsx` against a missing `executor` in the runtime-architecture response.
5. Consider placing `RouteErrorBoundary` inside the shell so navigation survives a route crash.

## 2026-11-12 — Linux CUPS runtime diagnostics

- Settings now names the Linux CUPS executor in both English and Thai. Existing
  CardDetail primitives, typography and styles are reused; no CSS changed.
- Rendered and checked at 1440px, 1024px and 390px in both locales; no page
  overflow. Captures: `artifacts/browser/settings-linux-{en,th}-{1440,1024,390}.png`.
- Web unit tests: 677 passed. Production web build passed. Full Playwright: 136
  passed, including the six Linux diagnostics viewport/locale cases.
- Remaining operational work: validate the installed Linux driver and physical
  G2000 output against the existing template/profile. No new styling debt.

## 2026-11-17 — Incoming Job Payload Visibility & Web Control Incoming Jobs Hub

- **Incoming payload visibility (`/jobs` & `/jobs/:id`)**:
  - Added shared payload helper (`apps/web/src/lib/jobPayload.ts`) and indexed incoming payload keys/values in `buildJobQueueView` (`apps/web/src/lib/jobQueueView.ts`).
  - `JobQueue` now displays up to 4 extracted incoming `key: value` `<Badge>`s (+ overflow) in the queue table and a full incoming `key: value` `CardDetail` block inside the quick-triage `Drawer`, falling back to `payloadHint` only when no key/value fields exist.
  - `JobDetail` now displays incoming payload `CardDetail` fields and formatted JSON for non-sandbox jobs (`JobConfigurationPanel`), and `ReprintJobService` preserves `payload`, `mappedPayload`, `intakePayload`, and `code_profile` on reprints.
- **Web Control Incoming Jobs Hub (`/control/jobs`) & Station Management**:
  - New route/nav item `/control/jobs` (`WebControlJobs.tsx`) reusing existing `PageLayout`, `Panel`, `Grid`, `MetricGrid`/`MetricTile`, `DataTable`, `FormField`, `Chip`, `CardDetail`, `Drawer`, `Dialog`, `CodeBlock`, `Alert`, `EmptyState` primitives with zero custom CSS files or inline hex literals.
  - Fleet overview shows 6 summary metrics, a fleet error breakdown panel with direct error drill-down, station filters, and station cards with custom `displayName` editing (`PATCH /api/v1/control/devices/:id`).
  - Station drill-down supports free-text payload/metadata search, status filter (`ALL`, `NEEDS_ATTENTION`, `JOB_STATUSES`), date presets & custom date range, dynamic `key: value` filter builder with autocomplete values and clickable `Chip`s on job rows, grouping (`none | date | status | template | printer | source | key:<field>`), full payload `Drawer`, and single/batch remote re-print confirmation `Dialog` (`POST /api/v1/control/devices/:id/jobs/:jobId/reprint`).
  - Added `View Jobs` and `Edit Display Name` actions on `WebControlDevices.tsx` and `WebControlDeviceDetail.tsx` with 100% EN/TH translation parity.
- **Verification**:
  - `npm run build -w packages/domain` passed.
  - `npm run typecheck --workspaces` passed across all TypeScript workspaces (`@printerops/adapters`, `@printerops/domain`, `@printerops/shared`, `@printerops/api`, `@printerops/mcp`, `@printerops/web`); `typecheck:runner-go` skipped because `go` is not on the Windows shell PATH.
  - `apps/api`: `control-jobs.test.ts` (3/3) and `control-api.test.ts` (19/19) passed; 80/83 test files (685/688 tests, 2 skipped) passed, with 1 pre-existing Windows-only path failure in `src/tests/retention.test.ts` (`/dev/null/impossible-archive`).
  - `apps/web`: `jobPayload.test.ts` (5/5), `layoutContract.test.ts` (12/12), `i18n.test.ts` (55/55), `jobQueueFilter.test.tsx` (5/5), `jobDetailEvidence.test.tsx` passed (710/711 tests, 72/73 files); 1 pre-existing Windows backslash failure in `designTokens.test.ts` (`components\ui\ui.css`). Production web build (`npm run build -w apps/web`) passed.
  - Playwright E2E could not launch on this host because Playwright Chromium executable (`headless_shell.exe`) is not installed.


## 2026-11-19 — Resize geometry and preview fidelity

- Explicit width/height edits now determine sheet orientation without silently swapping sides when crossing a square. Visual field anchors stay fixed, including imported rotated geometry. Orientation selection swaps both dimensions atomically for undo.
- HTML previews retain renderer-generated SVG image QR/barcodes and restore only the trusted bundled print font after sanitizing authored HTML. Sandbox paper chrome no longer adds 20px padding plus a border to the physical page; narrow screens scroll the full sheet inside the workbench. Existing stylesheet ownership and tokens are retained.
- Verification: 829 web unit tests passed; production build passed; final complete Playwright suite: 170 passed, 68 intentionally skipped. Resize and renderer-to-Sandbox geometry/font/QR cases are included. Resize and Sandbox checks cover Thai/English at 1440, 1024 and 390px.
- Live HAPY inspection confirmed CHG profile and auto-template positions match. Editor label fallbacks differ from actual data: most defaults are empty; the authorized job payload omits some keys and uses drug_unit where the profile expects unit. No patient defaults or remote profiles were changed. Physical TM-L100 cut length remains unmeasured; confirmed local driver setting and remedy are in docs/tm-l100-fixed-length.md. Changes are in the source workspace, not deployed to the running app.
