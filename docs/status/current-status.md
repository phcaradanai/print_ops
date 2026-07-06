# PrintOps — Current Status

**Project:** PrintOps — Universal Printer Operations & Observability Platform  
**Goal:** Centralised management, observability, and job-routing for heterogeneous printer fleets  
**Current phase:** Day 1 Foundation Complete  
**Last updated:** 2026-07-06  
**Branch:** `printerops-foundation`

---

## What is done

### Architecture scaffold
- npm monorepo: `packages/{domain,shared,adapters}` + `apps/{api,web,runner}`
- Clean Architecture layers: Domain → Application → Infrastructure → Interface
- TypeScript strict mode throughout (NodeNext modules, no `any`)

### Domain layer (`packages/domain`)
- Models: `Printer`, `PrinterCapability`, `PrinterStatus`, `PrintCommand`, `Job` (8 statuses), `JobTrace`, `AuditLog`, `Runner`, `User`
- RBAC: 4 roles (OWNER / ADMIN / OPERATOR / VIEWER), 15 permissions via `ROLE_PERMISSIONS`
- 14 domain events + `EventBusPort` interface
- 8 port interfaces: `PrinterAdapterPort`, `JobQueuePort`, 5 repository ports, `PermissionPolicyPort`, `ExportPort`, `NotificationPort`

### Shared utilities (`packages/shared`)
- `generateId()`, typed error classes (`NotFoundError`, `PermissionError`, `AppError`)

### Adapter layer (`packages/adapters`)
- `AdapterRegistry` — register/lookup adapters by protocol or printer
- `FakePrinterAdapter` — configurable `shouldFail` + `latencyMs`, full in-memory queue
- Placeholder stubs: IPP, CUPS, SNMP, Windows Spooler

### API app (`apps/api`)
- Fastify server with JWT auth + CORS
- 10 application services wired with in-memory infrastructure
- 18 REST routes across 6 route groups (auth, printers, jobs, runners, audit, export)
- `POST /jobs/:id/execute` — triggers `ExecuteJobService` directly
- Full in-memory implementations for all 5 repos, queue, event bus
- Seeded default admin: `admin@printerops.local`

### Runner app (`apps/runner`)
- Registers with API on startup
- Heartbeat loop every 30 s
- Poll loop every 5 s — dequeues jobs, calls `POST /jobs/:id/execute`

### Web app (`apps/web`)
- React + Vite + React Router v6
- 10 page skeletons: Dashboard, Printers, Jobs, JobDetail (trace timeline), Runners, Audit, Export, Settings, Login, NotFound
- Proxy `/api` → `http://localhost:3001`

### Tests
- `job-lifecycle.test.ts` — happy path PENDING→QUEUED→RUNNING→SUCCESS + failure path (2 tests)
- `permission.test.ts` — RBAC policy + CheckPermissionService (7 tests)
- **Total: 9/9 pass**

### Build
- `npm run build` — all 5 TypeScript packages compile clean (zero errors)
- `npm run build -w apps/web` — Vite builds successfully

### Docs
- `docs/architecture/` — overview, domain model, event catalog, ports & adapters, service catalog
- `docs/adr/0001-clean-architecture.md`
- `docs/operations/local-dev.md`

---

## What is not done yet (Day 2+)

- PostgreSQL repository implementations (all repos are in-memory)
- BullMQ/Redis queue adapter
- Real password hashing (MVP accepts any password)
- `CheckPermissionService.assertCan()` not wired into API route handlers
- IPP, CUPS, SNMP, Windows Spooler adapter implementations
- Frontend state management and real API integration (pages are skeletons)
- E2E / integration tests
- Docker Compose service definitions
- Notification adapter implementation

---

## Known limitations

| Limitation | Impact |
|---|---|
| In-memory storage | All data lost on restart; no persistence across runs |
| No password verification | Any password accepted at `/auth/login` in MVP |
| Permission guards not applied to routes | RBAC policy exists and is tested but routes don't call `assertCan` |
| Runner polls API via HTTP | Runs in-process with API in dev; separate process needs network |

---

## How to run locally

```bash
# Install dependencies
npm install

# Start API (port 3001) + Runner
npm run dev

# Start web (port 5173)
npm run dev -w apps/web

# Default login
# Email: admin@printerops.local
# Password: anything (MVP)
```

---

## How to test the fake printer flow

```bash
# 1. Start the API
npm run dev -w apps/api

# 2. Login and get a token
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@printerops.local","password":"any"}' | jq .token

# 3. Create a printer (replace TOKEN)
curl -s -X POST http://localhost:3001/printers \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Printer","protocol":"fake","host":"localhost"}' | jq .

# 4. Create a print job (replace PRINTER_ID)
curl -s -X POST http://localhost:3001/jobs \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"printerId":"PRINTER_ID","mimeType":"application/pdf","copies":1}' | jq .

# 5. Execute the job (replace JOB_ID)
curl -s -X POST http://localhost:3001/jobs/JOB_ID/execute \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":"runner-local"}' | jq .status

# Expected: "SUCCESS"

# 6. Inspect trace
curl -s http://localhost:3001/jobs/JOB_ID/trace \
  -H "Authorization: Bearer TOKEN" | jq .steps
```

---

## Next step: Day 2 Backend Core

See [`docs/status/next-steps.md`](./next-steps.md)
