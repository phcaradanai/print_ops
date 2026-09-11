# OTA-00 — Repository Investigation (Lead Engineer findings)

Date: 2026-09-08 · Branch: `mvp_nippon` · Repo version: 0.1.28

Purpose: ground truth for the OTA architecture contracts. Every claim below was
verified against source, not inferred.

---

## 1. System topology

PrintOps is an npm-workspaces monorepo (Node >= 20) plus a Go runner:

| Component | Path | Tech | Version source |
|---|---|---|---|
| API server | `apps/api` | Fastify + TypeScript | `package.json` 0.1.28 |
| Web dashboard | `apps/web` | Vite + React | `package.json` (surfaced as `APP_VERSION` badge, tested in `apps/web/src/__tests__/appVersion.test.tsx`) |
| Desktop shell | `apps/desktop` | Tauri v2 (Rust) | `tauri.conf.json` + `Cargo.toml` both 0.1.28 |
| Runner | `apps/runner-go` | Go | `internal/config/config.go` `var Version = "0.1.0-mvp"` (ldflags-overridable, currently NOT wired in `build-all.js`) |
| Shared libs | `packages/domain`, `packages/shared`, `packages/adapters` | TypeScript | workspace versions |
| HTML print helper | `apps/windows-print-helper` | .NET (WebView2) | published into desktop resources |
| MCP server | `apps/printops-mcp` | TypeScript | guarded, separate |

**Desktop deployment model** (docs/architecture/desktop-tauri-architecture.md,
verified in `apps/desktop/src-tauri/src/lib.rs`):

- Tauri shell is a process **supervisor**: spawns `server.exe` (pkg-bundled API,
  127.0.0.1:31415) and `printops-runner.exe` (Go, discovery+heartbeat only,
  `PRINTOPS_JOBS_ENABLED=false`).
- The **sole print executor** in desktop mode is the API's in-process local
  worker (`LocalPrintScheduler` in `apps/api/src/services/local-print-scheduler.ts`,
  enabled via `PRINTOPS_LOCAL_WORKER=true`). The Go runner never claims jobs
  there — two claimants would double-print.
- Supervisor thread polls children every 2 s and restarts exiters
  (`restart_exited_child`, lib.rs:487); a `ShutdownGuard` suppresses restart
  during normal exit. Windows job object with `KILL_ON_JOB_CLOSE` binds
  children to the shell.
- `wait_for_server_health` (lib.rs:310) polls `/health` until 200 — an existing
  health-check primitive the OTA installer gate can reuse.
- NATS settings save already demonstrates the **in-place child restart** pattern
  (lib.rs:337-366): kill child, `spawn_child` again, wait for `/health`, report.
  This is the proven mechanism for updating `server.exe` without touching the
  shell or the window.
- Per-installation secrets (`jwt-secret.txt`, `runner-bootstrap-secret.txt`) and
  the SQLite DB live in the **per-user app data directory**, not the install
  dir — they already survive upgrades.
- NSIS installer with `nsis-hooks.nsh` (closes running PrintOps before
  upgrade); targets `msi` + `nsis`.

## 2. Print job lifecycle & the "idle" question

Job statuses (`packages/domain/src/models/job.ts`):
`ACCEPTED → VALIDATED → QUEUED → DISPATCHED → PRINTING → SUCCESS` plus
`UNVERIFIED / FAILED / TIMEOUT / CANCELLED / DUPLICATE_RETURNED`.

Queue: `JobQueuePort` (`packages/domain/src/ports/queue.port.ts`) —
`enqueue/dequeue/ack/nack/size/getMetrics`; `QueueMetrics` exposes `size` and
`inflight`. Implementation is `InMemoryJobQueue` (apps/api/src/infra/queue/).

`LocalPrintScheduler` keeps per-printer promise chains, has `settled()`
(waits for all scheduled work) and `drainAvailable()`. **Queue-idle detection
for the install gate = `queue.getMetrics()` size+inflight == 0 AND no job rows
in non-terminal status AND scheduler.settled()**. In runner-polling
deployments the API-side queue drains to DISPATCHED/PRINTING via runner claims;
job-status query (`jobs?status=`) is the portable signal.

Readiness endpoint exists: `GET /system/readiness` (`apps/api/src/routes/v1/readiness.routes.ts`)
returns per-component `READY/DEGRADED/...` plus `versions` and
`database.schemaVersion` — a natural post-install health-check surface.
`/health` is the minimal liveness ping used by the Rust supervisor.

## 3. Content: Paper Profiles & Templates (Content OTA targets)

Storage: SQLite via sql.js when `DB_MODE=sqlite` (desktop default), else
in-memory. Schema migration is **already versioned**: `PRAGMA user_version`,
`CURRENT_SCHEMA_VERSION = 6`, transactional migrations, and a forward-guard
that refuses to open a newer-schema DB (`apps/api/src/infra/db/sqlite.schema.ts`).
This is the pattern Content OTA state tracking should follow.

- `paper_profiles` table: unique `code`, geometry fields, `fields` JSON,
  `layout` JSON. No ownership/source columns yet.
- `print_templates` table: unique `template_code`, `content`, integer
  `version` column (per-template, bumped on update), `status`
  DRAFT/PUBLISHED/DISABLED/ARCHIVED. No manifest-level versioning.
- `printer_template_bindings`, `printer_paper_calibrations` reference profiles
  by id — content sync must preserve referential integrity or remap ids.
- `imported_designs`: binary assets (base64) keyed by `paper_profile_id` +
  sha256 — part of profile content bundle.
- Existing import/export paths: `POST /paper-profiles/import|export`,
  `import-paper-profile.service.ts`; templates CRUD in
  `apps/api/src/routes/v1/template.routes.ts`. Import service is a usable
  reference for validation-before-activation semantics.
- Repositories: dual implementations (InMemory* / Sqlite*) chosen in
  `apps/api/src/app.ts:276-290` behind domain ports
  (`PaperProfileRepositoryPort`, `PrintTemplateRepositoryPort`).

**No MANAGED/LOCAL/FORKED ownership concept exists yet.** No content manifest,
no content versioning beyond per-template `version`.

## 4. Runner details relevant to OTA

- Config purely env/`PRINTOPS_CONFIG_FILE` (`internal/config/config.go`).
- `Version` var exists, reported in `Register` metadata (`"version": cfg.Version`)
  → API already stores runner version in `runners.metadata`.
- Service install/uninstall: **not implemented** (`internal/service/service.go`
  returns ErrNotImplemented) — runner runs in foreground or under the desktop
  supervisor. A standalone-runner update therefore means: stop process, replace
  binary, start process (supervisor already does exactly this on child exit).
- Runner auth: token, desktop bootstrap secret, or dev login.

## 5. Build & release pipeline (existing verification to extend)

- `npm run desktop:bundle` = `release:verify` → `tauri:build` → `release:verify --post-bundle`.
- `scripts/release-verify.mjs` + `release-verify-lib.mjs`: checks bundled
  resources exist/non-empty/fresh, version consistency across
  package.json/tauri.conf/Cargo.toml, forbidden tracked artifacts. **This is
  the natural home for artifact checksum/signature generation.**
- `build-all.js` builds web+api(pkg)+runner(go)+print helper, copies into
  `src-tauri/resources/`. Runner version is NOT injected via ldflags — gap to fix
  in OTA-01 so runner artifacts carry the release version.
- Tests: vitest per workspace (`npm test`), Go tests, Playwright config at root,
  e2e NATS script, packaged-desktop supervision smoke
  (`scripts/packaged-desktop-supervision-smoke.mjs`) — proves supervisor restart
  behavior end-to-end; OTA install/rollback tests can extend it.

## 6. Existing OTA-related artifacts

- `ota-Architecture` (repo root, untracked): ASCII sketch — Control Plane
  (Release + Content Registry) → Artifact Store/CDN → WAN direct or LAN Relay
  (local cache) → Update Agent (LAN→WAN resolver, verify sig/hash, download/stage,
  idle detection, install/rollback) → App + Runner → Profile/Template DB.
  This sketch is the seed for Agent 2's design; it is NOT yet a contract.
- `apps/web/src/__tests__/appVersion.test.tsx` + `AppVersionBadge`: version
  display exists in UI.
- No update state machine, no manifest schema, no signing, no LAN/WAN resolver,
  no relay, no content ownership — all greenfield.

## 7. Constraints & invariants confirmed from code

1. **Never kill server.exe mid-job**: the local worker executes inside
   server.exe; the install gate must confirm idle via queue metrics + job
   statuses before any child restart. The supervisor's 2 s restart loop must
   be suppressed (ShutdownGuard-like flag) during a deliberate update swap.
2. **DB safety**: sql.js keeps the DB in memory and rewrites the file on
   write; a server.exe swap while it holds state could lose writes → the
   update flow must stop the child cleanly, not kill it mid-write. Schema
   forward-guard already prevents a downgraded app from opening a newer DB —
   **rollback across a schema migration is a real hazard** the architecture
   must address (content/app compat rules, or schema-version pinning in the
   release manifest).
3. **Job object**: children die with the shell; an app-level (shell) update
   means the whole NSIS/MSI upgrade path with `nsis-hooks.nsh` shutdown —
   acceptable only when queue is idle.
4. **Loopback-only API + per-installation secrets**: update agent endpoints
   must live behind the existing auth/permission system
   (`requirePermission`, RBAC roles OWNER/ADMIN/OPERATOR/VIEWER). New
   permissions needed (e.g. `ota:read`, `ota:manage`).
5. **Two runner modes** (desktop-supervised discovery-only vs standalone
   job executor) need different update choreography; both flow through the
   same supervisor/stop-start primitive.
6. Retention sweeps, NATS callbacks, webhook machinery must remain untouched
   by OTA work (mission invariant).

## 8. Recommended integration seams (for the Architect)

- **Update agent placement**: inside `server.exe` (API) as a service +
  routes, because it already owns DB, auth, queue metrics, and is supervised;
  Rust shell only needs one new capability: "swap child binary + restart
  child" (extend the proven NATS-restart pattern) and "self-update request"
  (defer to installer when queue idle).
- **Content OTA**: new tables (`content_manifests`, `content_items` or columns
  on existing tables: `ownership`, `source_version`, `content_hash`), migrated
  as schema version 7 via the existing migration machinery.
- **Distribution**: artifact layout = per-release directory with
  `manifest.json` (versions, sha256, signature, min-supported-version),
  consumable from WAN HTTPS or LAN relay (static file server / SMB share).
  Resolver tries LAN base URLs first with short timeout, falls back to WAN.
- **Version model**: single release train version (0.1.28-style) shared by
  desktop/api/web; runner version must be injected at build (ldflags) and
  match the release; content manifests versioned independently (profiles-N,
  templates-N per the sketch).

## 9. Phase mapping to this repo (Lead's plan)

| Phase | Concrete work in this repo |
|---|---|
| OTA-01 | manifest/version schema (packages/domain models + API tables v7 + release-verify emits manifest.json + runner ldflags version) |
| OTA-02 | update-state service in apps/api (`GET/POST /api/v1/ota/*`), download+verify (sha256 first, sig in OTA-08), staged dir under app-data |
| OTA-03 | idle-gate (queue metrics + job statuses + scheduler.settled), Tauri child-swap command reusing NATS-restart pattern, /health+/system/readiness post-install check, rollback = keep previous staged version, supervisor guard flag |
| OTA-04 | content manifest sync: ownership columns, transactional apply, validation-before-activate (reuse import validation), history/rollback table |
| OTA-05 | LAN-first/WAN-fallback source resolver in the update agent |
| OTA-06 | LAN relay = static manifest+artifact server (extend release output; could be a tiny Go/Node server in infra/) |
| OTA-07 | Update UI in apps/web (Settings/OTA page), RBAC permissions, status badge |
| OTA-08 | signing (minisign/ed25519 over sha256 digests), downgrade protection (min-version in manifest + stored high-water mark) |
| OTA-09 | failure-test suite (the 17 scenarios) as vitest + extension of packaged-desktop-supervision-smoke |
| OTA-10 | production readiness review vs acceptance list |

Open questions for product owner (non-blocking for contracts):
- Where does the WAN artifact store live (existing CDN/S3/GitHub releases)?
- Is a central Control Plane API in scope now, or manifest files only (file-based registry)?
- Signing key custody (who holds the release key)?
