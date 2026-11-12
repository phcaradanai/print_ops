# Network Printer Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Operators search IPv4 printers through a selected VPN-connected Runner and register TCP candidates from the dashboard.

**Architecture:** Persist bounded search commands in SQLite; a separate Go Runner loop claims commands, opens TCP connections without writing payloads, and reports results. Reuse discovered-printer storage and registration, with explicit network metadata distinguishing raw TCP from installed spooler queues.

**Tech Stack:** TypeScript, Fastify, sql.js, Go standard library, React, existing UI primitives and bilingual dictionary.

**Spec:** `docs/superpowers/specs/2026-11-12-network-printer-discovery-design.md`

## Global Constraints

- Port 9100 only; never send print bytes during discovery.
- IPv4 single address, CIDR, inclusive range; maximum 256 distinct addresses.
- One outstanding search per Runner; 16 simultaneous connections maximum, 1.5 seconds per connection, 60-second scan deadline.
- Independent from print-job polling, including discovery-only desktop Runners.
- Preserve existing OS discovery, registrations, and unrelated workspace changes.
- Outbound authenticated HTTP from Runner; persistent claims and bounded expiry.

## Review Focus

- Host bits in CIDR, reversed ranges, invalid octets and oversized inputs must not expand unboundedly (Task 1).
- Concurrent starts/claims/results and late results must not overwrite a terminal or newer search (Task 1).
- A TCP listener is only a candidate; no print bytes or fabricated printer identity (Tasks 2–3).
- Old/offline Runners and reloads must show actionable state (Tasks 1 and 3).
- Repeated scans must retain registration identity and installed spooler registrations (Tasks 1 and 4).

### Task 1: Persistent search commands and registration

**Files:** Domain model/port `packages/domain/src/{models/network-printer-search.ts,ports/network-printer-search.port.ts,index.ts}`; repositories `apps/api/src/infra/repos/{in-memory-network-printer-search.repo.ts,sqlite/sqlite-network-printer-search.repo.ts}`; service `apps/api/src/services/network-printer-search.service.ts`; routes `apps/api/src/routes/v1/network-printer-search.routes.ts`; existing `sqlite.schema.ts`, `app.ts`, `register-discovered-printer.service.ts`; tests `apps/api/src/tests/network-printer-search.test.ts`.

**Interfaces:** `NetworkPrinterSearch` with id, runnerId, targets, state, timestamps, claimToken, addresses and message. Repository atomic create/claim/finish with lazy expiry. Service `start(runnerId, targets, actorId)`, `get(id)`, `latest(runnerId)`, `claim(runnerId)`, `finish(runnerId,id,claimToken,addresses,incomplete)`. REST under `/v1/runners/:runnerId/printer-searches` and `/v1/printer-searches/:id`.

- [x] Write failing tests for normalization/bounds, persistence, concurrent claims, queue/lease expiry, result validation, permission guards, capability checks and TCP registration.
- [x] Run `npm run test -w apps/api -- src/tests/network-printer-search.test.ts`; expect feature-missing failures.
- [x] Implement domain contracts, memory/SQLite repositories and schema version 10. Use 120-second queue expiry and 75-second claim expiry, with a 60-second Runner scan deadline.
- [x] Implement permission-guarded API routes, service composition, audit, stable discovered identities and raw TCP registration.
- [x] Run targeted tests and `npm run typecheck -w apps/api`; expect passing results.

### Task 2: Runner network scanner and command loop

**Files:** `apps/runner-go/internal/discovery/network/{network.go,network_test.go,loop.go,loop_test.go}`, `apps/runner-go/internal/api/network-search.go`, `apps/runner-go/cmd/printops-runner/main.go`.

**Interfaces:** Runner claims `{id,targets,claimToken}`, validates normalized IPv4 targets independently, scans, reports `{claimToken,addresses,incomplete}`. Separate loop runs before the jobs-enabled branch. Registration metadata `network_printer_search: true` advertises support.

- [x] Write failing tests for open/closed connections, cancellation, at most 16 workers, maximum 256 addresses, zero writes, HTTP claim/result paths, and partial results.
- [x] Run `go test ./internal/discovery/network ./internal/api`; expect missing-feature failures.
- [x] Implement bounded scanner, typed HTTP methods, and independent polling loop; report partial timeout results within the 75-second lease.
- [x] Run `go test ./...`; expect passing results.

### Task 3: Dashboard search and result workflow

**Files:** `apps/web/src/features/printer-discovery/network-printer-search.tsx`, `apps/web/src/pages/DiscoveredPrinters.tsx`, `apps/web/src/i18n/translations.ts`, `apps/web/e2e/network-printer-search.spec.ts`.

**Interfaces:** Existing Runner list plus capability metadata; Task 1 routes and DTO. On terminal results refresh existing discovery list; preserve selected Runner/latest search across reload via latest endpoint. Hide actions from users without printer:create.

- [x] Write browser tests for validation, Runner selection, queue/running/completed/empty/failed states, disabled old Runners, TCP candidate wording and registration.
- [x] Implement form with existing labels/inputs/buttons, bounded polling and cleanup; all copy in English and Thai. Display results from the current search explicitly and retain existing discovery list for registration.
- [x] Run web typecheck/build and browser test with repository E2E config; expect passing results.

### Task 4: End-to-end verification and operations notes

**Files:** `docs/architecture/runner-printer-discovery.md`; relevant tests from Tasks 1–3.

**Interfaces:** Whole search→claim→report→discover→register chain.

- [x] Verify API chain including repeated reports/scans preserving registration links; ensure malformed network metadata cannot create a wrong endpoint.
- [x] Run relevant API/web/Go suites and typechecks; inspect browser desktop/mobile in one bounded pass.
- [x] Document IPv4 formats, limits, port 9100, updating Runner, timeout interpretation and VPN deployment verification.
- [x] Request independent code review, address important findings with failing tests then fixes, and report verified results and real-VPN testing limits.

## Verification record

- Root npm test: 1,509 JavaScript tests passed, 1 existing conditional test skipped; both Go modules passed.
- Network API tests: 27 passed across memory and SQLite stores.
- Browser tests: 9 passed, covering English/Thai, mobile layout, registration, old Runners, invalid input, status retry, and another operator starting a newer search.
- API/web builds and typechecks passed. Release verifier tests: 25 passed, 4 conditional skips.
- A temporary smoke harness ran the actual API and built Go Runner with jobs disabled against a local TCP 9100 listener, then registered the result; zero print bytes were observed.
- Independent review found a stale optimistic QUEUED snapshot; the new browser regression failed before the fix and passed afterward. A separate registration regression caught colliding numeric IP names and passed after preserving endpoint identity in default printer codes.
- Initial Go test execution was blocked by an unavailable toolchain. An official temporary toolchain was downloaded to /tmp, checked against its published SHA-256, and used for subsequent Go builds/tests. The initial Go RED invocation did not run feature assertions.
- Temporary local browser configuration and smoke/toolchain files are development-only; no package dependency or user machine configuration was changed.
- Actual VPN/physical printer verification and Windows installer packaging were not performed.
- Pre-commit verification under the updated frontend rules: root `npm test` passed again; web production build passed; the full Playwright suite passed 130 tests. English and Thai were rendered at 1440px, 1024px, and 390px with no horizontal overflow.
