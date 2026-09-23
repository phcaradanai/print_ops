# Repository Guidelines

<!-- graft:start -->
## Graft — repo context graph
This repo is indexed in `graft/`: small linked markdown nodes that explain each system and carry exact file:line spans. Query graph via graft MCP tools before grepping or opening full source files.
<!-- graft:end -->

## Project Overview
PrintOps is an industrial and clinical edge-print orchestration gateway. It bridges external integration systems (via authenticated REST APIs and NATS JetStream messaging) to physical thermal label printers, receipt printers, document printers, and Windows/CUPS spoolers.

Key missions and guarantees:
- **Zero Duplicate Prints**: Strict idempotency keys (`request_id` + `source_system`), atomic single-flight claim locks, and terminal execution states (`SUCCESS`, `UNVERIFIED`, `FAILED`, `TIMEOUT`, `DUPLICATE_RETURNED`).
- **Dynamic Decoupled Flow**: Callers provide logical template codes (`code_template`) and paper profile codes (`code_profile`); PrintOps resolves bound physical printers, renders native barcode commands (ZPL, TSPL, Datamax DPL) or HTML, and submits jobs.
- **Hardware Verification**: Queries physical device status (SNMP MIB queries, Windows Spooler job flags) to distinguish physical delivery from spooler handoff. Unconfirmed physical delivery marks jobs `UNVERIFIED` to block accidental reprint loops.
- **Supervised Breakaway OTA**: Self-updates for runners, API, and desktop shells via a detached Go updater process (`printops-updater`) with cryptographic Ed25519 manifest verification, pre-migration SQLite snapshots, and automatic rollback upon failed health checks.

---

## Architecture & Data Flow

### High-Level Architecture
```text
Enterprise Intake (HTTP REST / NATS JetStream)
            │
            ▼
    apps/api (Fastify + sql.js SQLite)
    ┌────────────────────────────────────────────────────────┐
    │  DynamicPrintService -> AcceptExternalJobService       │
    │  Idempotency Check -> Resolve Binding -> Create Job    │
    └────────────────────────────────────────────────────────┘
            │
            ├─────────────────────────────────────┐
            ▼ (Direct / Single Host)              ▼ (Distributed Runner)
    LocalPrintScheduler                   apps/runner-go (Poller)
    ExecuteJobService                     POST /api/v1/runners/:id/jobs/next
            │                                     │
            └─────────────────┬───────────────────┘
                              ▼
        packages/adapters & runner-go internal/printer
        (WinSpool, Raw TCP :9100, IPP, CUPS, ZPL/TSPL/DPL)
                              │
                              ▼
        Hardware Verification (SNMP / Spooler flags)
                              │
                              ▼
        emitPrintJobTerminal (SUCCESS | UNVERIFIED | FAILED)
                              │
                              ▼
        Webhook & Event Callbacks (HTTP HMAC-SHA256 / NATS JetStream)
```

### Data Flow Stages
1. **Ingestion**:
   - HTTP: `POST /api/v1/print-jobs/dynamic` or `POST /jobs`.
   - NATS: `PrintIntakeConsumer` (`apps/api/src/infra/nats/print-intake.ts`) listens to JetStream subjects (e.g., `printops.intake.>`).
   - Both delegate to `DynamicPrintService` -> `AcceptExternalJobService`: verifies idempotency, looks up template and paper profile binding, logs `IntakeAttempt`, and persists `Job` as `ACCEPTED` -> `VALIDATED` -> `QUEUED`.
2. **Scheduling & Claiming**:
   - `SqliteJobRepository.claimNextJob()` atomically updates status to `DISPATCHED` -> `PRINTING` under concurrency protection.
   - Handled locally by `LocalPrintScheduler` or claimed by Go runner (`apps/runner-go`).
3. **Execution & Translation**:
   - Native barcode engines render ZPL/TSPL/Datamax DPL with rotation, calibration offsets, and DPI adjustments.
   - Windows printers use `winpool` / `apps/windows-print-helper` (WebView2 HTML printing).
   - Network printers use raw TCP socket streams (port 9100) or IPP/CUPS.
   - Execution watchdog aborts hanging print calls after `PRINTOPS_EXECUTE_TIMEOUT_MS` (default 180s).
4. **Hardware Verification & Callbacks**:
   - Hardware status checked via SNMP MIB or spooler query. Unconfirmed jobs transition to `UNVERIFIED`.
   - `emitPrintJobTerminal()` notifies listeners and invokes `ResultCallbackDispatcher` for retried HTTP webhook POSTs or NATS JetStream event publishing.

---

## Key Directories

```text
├── apps/
│   ├── api/                  # Fastify REST API, SQLite (sql.js WASM), NATS intake, OTA engine
│   │   └── src/
│   │       ├── infra/        # DB schema/repos, NATS connection manager, queue, eventbus
│   │       ├── routes/v1/    # Fastify route controllers (auth, jobs, printers, ota, webhooks)
│   │       └── services/     # Core domain orchestration (dynamic print, OTA, callbacks)
│   ├── web/                  # Vite + React operator dashboard (single source of truth for UI)
│   │   └── src/
│   │       ├── features/     # Feature domains (webhooks, templates, paper-profiles)
│   │       ├── pages/        # Route views (JobQueue, Printers, Runners, Settings, etc.)
│   │       ├── components/ui/# Layout primitives and atomic UI components
│   │       └── i18n/         # Bilingual translation dictionaries (en, th)
│   ├── runner-go/            # Production Go runner (registers with API, polls jobs, executes)
│   │   ├── cmd/printops-runner/
│   │   └── internal/         # Job worker, printer discovery, execution engines, telemetry
│   ├── updater-go/           # Production Go updater (breakaway process, binary swap, rollback)
│   ├── desktop/              # Tauri v2 Windows shell supervising packaged API & runner
│   └── windows-print-helper/ # .NET 8 WebView2 HTML printing helper executable
├── packages/
│   ├── domain/               # Domain entities, interfaces/ports, status models, errors
│   ├── shared/               # ID generation, physical units (mm/in/dots), render math, error tree
│   └── adapters/             # TS printer drivers (winpool, snmp, zpl, tspl, datamax, ipp, cups)
├── scripts/                  # Release verifier, OTA provenance, smoke tests, CI harnesses
└── docs/                     # Architecture contracts, production runbooks, ADR decisions
```

---

## Development Commands

### Common Workflows
```bash
# Install all dependencies across monorepo workspaces
npm install

# Build all TypeScript packages, API, and Go binaries
npm run build

# Start full local development stack (API :31415, Web :3000, Go Runner)
PRINTOPS_API_BASE_URL=http://127.0.0.1:31415 PRINTOPS_DEV_PASSWORD='Dev-password1!' npm run dev

# Run individual services
npm run dev -w apps/api                                      # API only
npm run dev -w apps/web                                      # Web UI only (port 3000)
PRINTOPS_API_BASE_URL=http://127.0.0.1:31415 npm run dev:runner-go  # Go runner only
```

### Typecheck, Lint & Quality
```bash
# Typecheck TypeScript workspaces and run Go package checks
npm run typecheck

# Verify releases and packaging resources (clean git state, semver, toolchains)
npm run release:verify
```

### Packaging & Bundles
```bash
# Windows production packaging (builds packages, web, api pkg bundle, Go binaries, Tauri shell)
npm run desktop:bundle

# Smoke test packaged standalone binaries
npm run test:packaged-sidecars

# Smoke test Tauri supervision on Windows
npm run test:packaged-desktop
```

---

## Code Conventions & Common Patterns

### Naming Conventions
- **Files & Folders**: Strict `kebab-case` throughout: `*.service.ts`, `*.repo.ts`, `*.routes.ts`, `*.port.ts`, `*.model.ts`, `*.test.ts`.
- **Go Packages**: Short, purposeful single-word names under `internal/` (`jobs`, `discovery`, `printer`, `updater`, `telemetry`).
- **Interfaces & Ports**: Suffix with `Port` for architectural interfaces: `JobRepositoryPort`, `PrinterAdapterPort`, `JobQueuePort`.
- **Database Tables**: Plural `snake_case`: `jobs`, `printers`, `paper_profiles`, `webhook_endpoints`, `ota_update_state`.

### Error Handling & Status Hierarchy
- Root exception is `AppError` (`packages/shared/src/errors.ts`):
  - `ValidationError` (400) — invalid request structure or inputs.
  - `PermissionError` (403) — role or service account restriction.
  - `NotFoundError` (404) — missing resource.
  - `ConflictError` (409) — state collision (e.g., job already claimed or active OTA).
  - Specialized domain errors: `PRINT_NOT_VERIFIABLE`, `PRINT_RESULT_TIMEOUT`, `PRINTOPS_DB_LOCKED`.
- Fastify routes catch domain errors and format RFC 7807-compatible structured error payloads.

### Dependency Injection & Service Wiring
- **Ports & Adapters (Hexagonal)**: Domain models and port contracts live in `packages/domain`. Concrete adapters live in `packages/adapters` or `apps/api/src/infra`.
- **Fastify Composition Root (`apps/api/src/app.ts`)**:
  - Repositories instantiated based on environment: `SqliteJobRepository` (production) or `InMemoryJobRepository` (unit tests).
  - Services injected via constructors: `new DynamicPrintService({ jobs, templates, printers, ... })`.
  - Route handlers receive dependencies via factory parameters (`v1PrinterRoutes(app, deps)`).

### Asynchronous Patterns & Database Concurrency
- **SQLite Single-Writer via sql.js**: In-process WebAssembly SQLite (`sql.js`) flushes to disk debounced via microtasks (`queueMicrotask`).
- **Socket Lock Endpoint**: Prevents multiple process instances from opening the same `printops.db` file. Controlled via `databaseLockEndpoint`. Sequential Vitest tests required for lock verification.
- **Idempotency & Single-Flight**: Incoming print jobs check duplicate keys before entering the queue.

### Frontend State & UI Architecture (`apps/web`)
- **Single Source of Truth**: `apps/web/src` is the only UI codebase; desktop shell serves a compiled copy.
- **Primitives**: Radix UI headless components, UnoCSS utility classes, TanStack Table for dense lists.
- **Complex UI State**: Handled via React `useReducer` (e.g., `editorReducer.ts` for SVG canvas paper profile layout designer).
- **Internationalization**: Bilingual Thai (`th`) and English (`en`) dictionaries in `apps/web/src/i18n/`. Default runtime locale is `th`.

---

## Important Files

### Entry Points
- `apps/api/src/dev-server.ts` — Local development API server.
- `apps/api/src/server.ts` — Production API server entry (compiled for `pkg` standalone executable).
- `apps/api/src/app.ts` — Fastify application factory and service dependency injection graph.
- `apps/web/src/main.tsx` — Web frontend application entry point.
- `apps/runner-go/cmd/printops-runner/main.go` — Standalone production Go runner.
- `apps/updater-go/cmd/printops-updater/main.go` — Breakaway OTA updater executable.
- `apps/desktop/src-tauri/src/main.rs` — Tauri desktop shell process supervisor.

### Key Configurations
- `package.json` — Root workspaces, build commands, and engine requirements.
- `apps/api/tsconfig.json` & `packages/*/tsconfig.json` — NodeNext ESM TypeScript project references.
- `apps/web/vite.config.ts` & `apps/web/uno.config.ts` — Vite bundle settings and UnoCSS presets.
- `apps/desktop/src-tauri/tauri.conf.json` — Tauri Windows desktop configuration and bundle assets.
- `scripts/release-verify.mjs` — Release integrity and preflight verification script.
- `docs/ota/OTA-architecture-contracts.md` — Authoritative OTA contracts, envelopes, and state machine.

---

## Runtime & Tooling Preferences

- **JavaScript Runtime**: **Node.js `>=20.0.0`** (enforced in `package.json` engines). Do NOT use Bun for running API or production scripts.
- **Package Manager**: **npm `>=10.0.0`** (uses native npm workspaces `packages/*`, `apps/*`).
- **TypeScript**: `^5.4.5`, configured with `NodeNext` module resolution and `.js` relative import extensions.
- **Go**: **`1.21+`** (modules specify `go 1.26` syntax compatibility).
- **C# / .NET**: **.NET 8.0 / .NET Framework 4.8** (required for `windows-print-helper` WebView2 HTML printing).
- **Bundler / Binary Packaging**: `esbuild` converts ESM to CommonJS, and `pkg` packages Node + `sql-wasm.wasm` + static web assets into a single Windows `server.exe`.
- **Platform Constraints**: Full packaging (`npm run desktop:bundle`) requires a Windows x64 build host due to WiX MSI and Windows spooler dependencies.

---

## Testing & QA

### Test Frameworks
- **Vitest**: Unit and integration tests for `apps/api`, `packages/domain`, `packages/shared`, `packages/adapters`, and `apps/web`.
- **Playwright**: Browser-based E2E tests (`apps/web/e2e/`) running against built static assets (`apps/web/dist`).
- **Go Standard `testing`**: Unit and concurrency tests for `apps/runner-go` and `apps/updater-go`.
- **Node Test Runner (`node:test`)**: Standalone release verification and cryptographic provenance tests (`scripts/*.test.mjs`).

### Running Tests
```bash
# Run all workspace unit tests and Go tests
npm test

# Run API tests only (Vitest)
npm run test -w apps/api

# Run Web UI unit tests (Vitest)
npm run test -w apps/web

# Run individual package tests
npm run test -w packages/domain
npm run test -w packages/shared
npm run test -w packages/adapters

# Run Go tests
npm run test:runner-go
npm run test:updater-go

# Run Playwright E2E tests
npx playwright test

# Run release verifier test suite
npm run test:release-verifier
```

### Mocking & Isolation Conventions
- Use `InMemory*Repository` test doubles and `FakePrinterAdapter` for fast service tests.
- When testing SQLite persistence, always use temporary directories (`mkdtempSync`) and properly call `closeDatabase()` in `afterEach`.
- Database lock tests must run sequentially (`describe.sequential`) to prevent lock collisions across workers.
- Playwright E2E uses synthetic authentication tokens and intercepts API calls with `page.route` via `apps/web/e2e/support.ts`. Ensure `locale: 'en'` is passed when asserting English UI text.
