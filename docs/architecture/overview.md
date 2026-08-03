# Architecture Overview

PrinterOps is a multi-app monorepo following Clean Architecture with DDD-inspired domain modeling.

## Monorepo Layout

```
apps/
  api/       – Fastify REST API (Node.js + TypeScript)
  web/       – Vite + React frontend
  runner/    – Job execution agent (registers with API, polls queue, executes via adapters)
packages/
  domain/    – Pure domain models, ports/interfaces, domain events (no dependencies)
  shared/    – Shared utilities: ID generation, errors, logger
  adapters/  – PrinterAdapterPort implementations + AdapterRegistry
docs/
infra/
  docker/    – docker-compose for local dev
```

## Layers

```
Interface Layer      → API routes, React pages
Application Layer    → Services (CreateJobService, ExecuteJobService, …)
Domain Layer         → Models, Ports, Domain Events (packages/domain)
Infrastructure Layer → In-memory repos, EventBus, Queue, Adapters
```

## Key Decisions

- **No real DB/queue to boot** – all infrastructure runs in-memory for MVP/tests. Postgres + Redis/BullMQ are wired via docker-compose for Day 2.
- **Ports pattern** – all infrastructure is behind interfaces defined in packages/domain. Swapping Redis for BullMQ requires only a new port implementation.
- **Adapter Registry** – printers are associated with a protocol string; the registry resolves to the correct PrinterAdapterPort at runtime.
- **Event-driven internally** – every significant state change publishes a DomainEvent. In-memory EventBus for MVP; can be replaced with Redis pub/sub or RabbitMQ.
- **trace_id on everything** – every job carries traceId + correlationId from creation through the trace timeline.
