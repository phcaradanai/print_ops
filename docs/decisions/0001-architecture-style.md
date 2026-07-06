# ADR 0001: Architecture Style

## Status
Accepted

## Context
PrinterOps needs to support multiple printer protocols, be testable without real hardware, scale from MVP to production, and be understandable by new contributors.

## Decision
Use **Clean Architecture** with **pragmatic DDD**:

1. **packages/domain** contains only pure models, ports (interfaces), and domain events — zero dependencies.
2. All infrastructure (DB, queue, adapters) implements ports defined in domain. Business logic never imports infrastructure directly.
3. **Event-driven internally**: every state change publishes a DomainEvent via EventBusPort. In-memory bus for MVP, replaceable with Redis pub/sub or AMQP.
4. **Adapter/Port pattern** for printers: protocol-specific code lives in packages/adapters, never in services.
5. **RBAC** via PermissionPolicyPort: roles and permissions defined in domain, enforcement in services.

## Consequences

- ✅ Services are testable with in-memory fakes — no Docker required for unit tests
- ✅ Adding a new printer protocol = implement PrinterAdapterPort + register
- ✅ Swapping PostgreSQL for another DB = implement repository ports
- ⚠️ More files and indirection than a simple Express CRUD app
- ⚠️ Dependency injection is manual (no IoC container) — acceptable at MVP scale

## Tech Stack
- **Backend**: Fastify (chosen over NestJS for lighter footprint + hand-rolled DI)
- **Test runner**: Vitest
- **Queue**: In-memory for MVP; BullMQ/Redis for production (Day 2)
- **DB**: In-memory for MVP; PostgreSQL for production (Day 2)
