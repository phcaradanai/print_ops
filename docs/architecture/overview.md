# Architecture Overview

PrintOps is a multi-app monorepo following Clean Architecture with DDD-inspired
domain modeling. It ships as a Windows desktop application that carries its own
local API, database, and printer-discovery agent.

## Monorepo Layout

```
apps/
  api/                   – Fastify REST API + NATS intake + in-process print executor (TypeScript)
  web/                   – Vite + React dashboard, EN/TH (TypeScript)
  desktop/               – Tauri v2 shell, supervises the sidecars (Rust)
  runner-go/             – Printer discovery + heartbeat agent (Go)
  windows-print-helper/  – WebView2 driver-rendered HTML printing (C#)
packages/
  domain/    – Pure domain models, ports/interfaces, domain events (no dependencies)
  shared/    – Shared utilities: ID generation, errors, logger, physical units
  adapters/  – PrinterAdapterPort implementations + AdapterRegistry
docs/
infra/
  docker/      – compose scaffolding (Postgres/Redis are NOT used by the app today)
  migrations/  – unapplied PostgreSQL schema, future work
scripts/     – release verification and packaged smoke tests
```

There is no `apps/runner`; the TypeScript runner was removed and `apps/runner-go`
is the only runner.

## Layers

```
Interface Layer      → API routes, React pages
Application Layer    → Services (CreatePrintJobService, ExecuteJobService, …)
Domain Layer         → Models, Ports, Domain Events (packages/domain)
Infrastructure Layer → Repositories, EventBus, Queue, Adapters, NATS
```

## Runtime shape (packaged desktop)

```
Tauri shell (Rust)
 ├── server.exe        – the API above, bound to 127.0.0.1:31415, serves the SPA
 │                       DB_MODE=sqlite, PRINTOPS_LOCAL_WORKER=true
 └── printops-runner.exe – Go, discovery + heartbeat only (jobs disabled)
```

The shell restarts either sidecar if it exits, contains them in a Windows job
object so nothing survives app exit, and generates per-installation secrets
(JWT signing key, runner bootstrap secret) on first run.

## Key Decisions

- **Persistence is SQLite via `sql.js`** (pure WASM, zero native dependencies),
  selected with `DB_MODE=sqlite` and always used by the packaged desktop. It has
  an exclusive process lock, atomic replace-on-save, versioned migrations, and a
  retention sweep that archives before pruning. In-memory repositories remain for
  tests and quick dev runs — the port interfaces keep the two modes honest.
- **The job queue is in-memory, the jobs are not.** `QUEUED` rows are persisted
  and re-enqueued at boot; jobs that were mid-flight are closed as `UNVERIFIED`
  rather than replayed. Redis/BullMQ are not used.
- **Ports pattern** – all infrastructure sits behind interfaces defined in
  `packages/domain`.
- **Adapter Registry** – printers carry a protocol string; the registry resolves
  it to a `PrinterAdapterPort` at runtime. The supported production executor is
  the Windows spooler adapter.
- **Event-driven internally** – significant state changes publish a DomainEvent
  on the in-memory EventBus. `PrintJobTerminal` is the one with a production
  subscriber: `ResultCallbackDispatcher`.
- **trace_id on everything** – every job carries `traceId` + `correlationId`
  from creation through the trace timeline into the result callback.
- **Device reality outranks screen state** – spooler acceptance is not success;
  see [job-lifecycle.md](job-lifecycle.md).

## Where to read next

| Question | Document |
|---|---|
| What states can a job be in, and what is safe to retry? | [job-lifecycle.md](job-lifecycle.md) |
| What does an integration program call, and what can it get back? | [external-print-api.md](external-print-api.md) |
| How are print results reported, retried, and secured? | [result-callbacks.md](result-callbacks.md) |
| How do printer protocols resolve? | [adapter-system.md](adapter-system.md) |
| What is actually true right now? | [../status/current-status.md](../status/current-status.md) |
| What is still unproven for production? | [../production/PROD-01-gap-table.md](../production/PROD-01-gap-table.md) |
