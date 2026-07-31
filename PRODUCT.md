# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Print operators** — hospital staff monitoring job queues, printer status, and runner health via the web dashboard during clinical operations. Context: long shifts under fluorescent lights, need at-a-glance status with minimal cognitive load.
- **System administrators** — IT personnel registering printers from discovery, managing users/roles (OWNER/ADMIN/OPERATOR/VIEWER), configuring templates and paper profiles. Context: periodic configuration work, not daily monitoring.
- **Integration developers** — external teams sending print jobs via `POST /api/v1/print-jobs` with `X-Api-Key` authentication. Context: building and debugging integrations against the REST API.
- **Runner operators** — staff managing the local Go runner process that bridges the API to physical printers.

## Product Purpose

PrintOps is a generic print gateway for hospital environments. It accepts print jobs from external integration systems via HTTP REST API and routes them to printers on the local network. It does NOT connect directly to HIS (Hospital Information System) — an external integration program owned by the HIS/clinical team bridges that gap.

Core capabilities:
- Accept print jobs with idempotency guarantees (`request_id` + `source_system`)
- Validate, queue, and route jobs through the local Go runner to physical printers
- Record full trace/audit information for every job state transition
- Support multiple printer protocols via pluggable adapters (fake, IPP, CUPS, Windows Spooler, raw TCP 9100, ZPL, TSPL, SNMP)
- Provide a React web dashboard, served both in the browser and inside a Tauri desktop shell, for monitoring and administration

Success means: operators trust the system at a glance, jobs flow reliably from integration to printer, and administrators can configure and troubleshoot without friction.

## Positioning

PrintOps is deliberately **not** a HIS module and not a print driver. It occupies the gap between them: a protocol-agnostic gateway that an integration program can call over plain HTTP without knowing anything about the printer on the other end.

What a neighboring product could not truthfully copy:

- **Honest print outcomes.** The job model carries a distinct `UNVERIFIED` status — sent, no fault reported, but no device channel could confirm a page came out. Most print stacks collapse this into success or failure. PrintOps treats it as an operator decision, because a page may well exist and a blind automatic retry would duplicate a clinical label.
- **Full trace per job, not per system.** Every job carries `traceId` + `correlationId` from creation through a step-by-step trace timeline, so a specific failed sticker can be reconstructed rather than inferred from logs.
- **Idempotency at the front door.** `request_id` + `source_system` deduplication means an integration program can safely retry without printing twice — the API returns `DUPLICATE_RETURNED` instead.
- **Runs on the hospital's own hardware.** No cloud dependency, no outbound requirement; the whole gateway is installable on-premise.

## Operating Context

- **Single hospital, on-premise.** One customer site, installed on the hospital's own network. Sizing, auth, and admin flows target a single tenant — not multi-site federation and not multi-tenant SaaS.
- **The print chain:** HIS/clinical system → external integration program (out of scope) → `POST /api/v1/print-jobs` with `X-Api-Key` → PrintOps API (authenticate, idempotency check, validate, queue) → Go runner polls and claims a job → printer adapter → physical printer → result and trace events reported back.
- **Job lifecycle states:** `ACCEPTED` → `VALIDATED` → `QUEUED` → `DISPATCHED` → `PRINTING` → terminal (`SUCCESS`, `UNVERIFIED`, `FAILED`, `TIMEOUT`, `CANCELLED`, `DUPLICATE_RETURNED`). Priority is `urgent` / `high` / `normal` / `low`, weighted for queue ordering.
- **Two operating surfaces:** operators typically use the Tauri desktop shell on a print station (it launches the bundled Go runner binary and shows a startup splash while the local service boots); administrators may reach the same React UI in a browser.
- **Physical output is the deliverable.** Stickers and labels come out of real devices on the ward. A UI that looks correct while paper is stuck is a failure — device reality outranks screen state.
- **Windows is a first-class deployment target.** A dedicated `apps/windows-print-helper` exists alongside Windows Spooler discovery (`Get-Printer`) and a Windows service story; macOS/Linux discovery uses `lpstat`.
- **Bilingual by default.** The dashboard ships English and Thai (`apps/web/src/i18n/translations.ts`, `Locale = 'en' | 'th'`). Thai and English differ substantially in string length and line-breaking, so every label, table header, badge, and error message must survive both without truncation or reflow.

## Capabilities and Constraints

**Confirmed capabilities**

- 19 dashboard pages: Dashboard, Printers, Printer Detail, Discovered Printers, Local Diagnostics, Templates, Template Sandbox, Paper Profiles, Webhooks, Route Policies, Printer Bindings, Print Flow Bindings, Job Queue, Job Detail, Runners, Audit Logs, Export Center, Users & Roles, Settings.
- Four-level role hierarchy: OWNER / ADMIN / OPERATOR / VIEWER, enforced server-side via a permission guard.
- Two auth paths: JWT for human users, `X-Api-Key` service accounts for machine integrations.
- Printer discovery synced from the runner, plus manual registration.
- Templates with barcode rendering, paper profiles with import, and a sandbox for previewing before committing.
- Webhook result callbacks back to the calling integration.
- Audit logs, export center, and database backup.

**Technical constraints**

- Persistence is SQLite via `sql.js` (pure WASM, zero native dependencies) — chosen so the gateway installs on a hospital machine without a database server. `infra/migrations` holds SQL for future database-backed storage; `infra/docker/docker-compose.yml` references Dockerfiles that are not in the repo and is unverified.
- The Go runner (`apps/runner-go`) is the only runner. The TypeScript runner has been removed; anything describing a Node.js runner is stale.
- The desktop app is **Tauri** (`@tauri-apps/api` v2, `src-tauri/`), not Electron.
- NATS is a dependency of the API for messaging; the UI surfaces the case where a message leaves PrintOps but no subscriber acknowledges it.
- Clean Architecture layering is binding: Interface → Application → Domain (`packages/domain`, zero dependencies) → Infrastructure. Printer protocols resolve at runtime through an Adapter Registry keyed by protocol string.

**Explicitly undecided**

- **Product name is unsettled.** The repo uses "PrintOps" (README, service copy, error messages) and "PrinterOps" (browser title, login screen, `@printerops/*` package scope) interchangeably. Future work must not silently pick one — this needs a decision, not an inference.

## Brand Commitments

- Name in flux between "PrintOps" and "PrinterOps" (see above); no logo, wordmark, or brand asset exists in the repo.
- English and Thai are both shipping locales and a durable commitment, not a future nice-to-have.
- Voice in existing UI copy is plain, direct, and non-alarmist — it states what happened and what the operator can do ("Sensitive: this backup contains operational history. Store it encrypted and restore only while PrintOps is stopped."). No exclamation, no personality, no reassurance the system cannot back up.

## Evidence on Hand

- **Architecture and decisions:** `docs/architecture/` (overview, adapter system, template system, runner contract, safety boundaries, result callbacks, fast print path), `docs/decisions/` ADRs 0001–0003.
- **Operations guides:** `docs/operations/` (template setup, webhook integration, local Go runner on Windows and macOS, local dev).
- **Testing and verification:** `docs/testing/print-e2e-flow.md`, `docs/testing/print-e2e-results.md`, `docs/verification/`, `artifacts/e2e/e2e-report.json`.
- **Prior design work:** `DESIGN.md` + `.impeccable/design.json` (visual world of record), `docs/UI_QUALITY_GATE.md`, `docs/frontend/`, `docs/audits/`, `.impeccable/critique/`.
- **Real content:** the English/Thai translation dictionary is the authoritative source of product copy.

**Absences future work must not fabricate:** there are no customers, testimonials, case studies, press mentions, benchmarks, uptime figures, pricing, or licensing terms. No `.env.example` is committed. Some status docs are stale — `docs/status/current-status.md` calls the desktop app Electron and `docs/architecture/overview.md` still describes in-memory persistence; the code is the authority over both.

## Product Principles

1. **A printed page is the only proof.** The system reports what the device confirmed, not what it hoped. Never collapse an unconfirmed outcome into success, and never auto-retry something that may already be on paper.
2. **The gateway stays generic.** PrintOps knows about jobs, printers, and protocols — never about patients, medications, or clinical meaning. Domain knowledge belongs to the integration program on the other side of the API.
3. **Every job is reconstructable.** Trace and audit are not diagnostics bolted on later; they are part of accepting a job. If an operator asks "what happened to this label," the answer exists.
4. **Installable on the hospital's own hardware.** Choices that add infrastructure the site has to run and maintain (a database server, a cloud dependency, an outbound requirement) need to justify themselves against a single on-prem install.
5. **Bilingual is a constraint, not a feature.** English and Thai are equal citizens. Anything that only works in one of them is unfinished.

## Accessibility & Inclusion

- **WCAG 2.1 AA** minimum compliance
- **Prefers-reduced-motion** respected — all animations must have a reduced-motion fallback (instant or crossfade)
- **High contrast** — operators work long shifts under fluorescent hospital lighting; contrast must hold up under fatigue
- **Color not sole communicator** — status indicators must use shape/icon/text in addition to color (red/green color-blindness accommodation)
- **Keyboard navigable** — all dashboard functions accessible without mouse for power users
- **Bilingual EN/TH** — layouts must hold at both string lengths; Thai line-breaking and font fallback must not degrade legibility
