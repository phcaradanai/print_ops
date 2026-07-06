# PrintOps — Day 2 Plan: Backend Core

**Phase:** Day 2 — Persistence + Auth hardening + Permission guards  
**Prerequisite:** Day 1 foundation on branch `printerops-foundation` is complete and passing.  
**Target:** Replace all in-memory infrastructure with real PostgreSQL persistence; harden auth; wire RBAC into routes.

---

## Overview

Day 1 proved the architecture with in-memory stubs. Day 2 makes it durable:

```
Day 1 (done)   →   in-memory repos + fake adapter + JWT skeleton
Day 2 (this)   →   PostgreSQL repos + real auth + permission guards
Day 3           →   BullMQ queue + real printer adapters (IPP/CUPS)
Day 4           →   Frontend integration + E2E tests
```

---

## Task list

### 1. PostgreSQL schema

**File:** `packages/domain/src/infra/schema.sql` (or managed via migration tool)

Tables to create:
- `printers` — id, name, protocol, host, port, status, capabilities (jsonb), metadata, created_at, updated_at
- `jobs` — id, printer_id, created_by, status, priority, mime_type, copies, duplex, color_mode, document_url, document_base64, trace_id, correlation_id, queued_at, started_at, finished_at, error_code, error_message, retry_count, metadata, created_at
- `job_traces` — id, job_id, trace_id, runner_id, adapter_name, status, steps (jsonb), started_at, finished_at, duration_ms, error_code, error_message, created_at
- `audit_logs` — id, trace_id, action, resource_type, resource_id, actor_id, before (jsonb), after (jsonb), metadata (jsonb), occurred_at
- `runners` — id, name, status, last_heartbeat_at, metadata, registered_at, updated_at
- `users` — id, email, name, password_hash, role, is_active, created_at, updated_at

Indexes: `jobs(status)`, `jobs(printer_id)`, `jobs(created_by)`, `audit_logs(resource_id)`, `job_traces(job_id)`

### 2. PostgreSQL repository implementations

**Directory:** `apps/api/src/infra/repos/postgres/`

Files to create (one per repo, implementing the port interface from `packages/domain`):

- `postgres-printer.repo.ts` — implements `PrinterRepositoryPort`
- `postgres-job.repo.ts` — implements `JobRepositoryPort`
- `postgres-trace.repo.ts` — implements `TraceRepositoryPort`
- `postgres-audit.repo.ts` — implements `AuditRepositoryPort`
- `postgres-runner.repo.ts` — implements `RunnerRepositoryPort`
- `postgres-user.repo.ts` — implements `UserRepositoryPort`

Use `pg` (node-postgres) or `postgres` (postgres.js) — prefer `postgres` for ergonomics with TypeScript.

Each repo follows this pattern:
```typescript
export class PostgresJobRepository implements JobRepositoryPort {
  constructor(private sql: Sql) {}
  async findById(id: string): Promise<Job | null> { ... }
  async create(input: CreateJobInput): Promise<Job> { ... }
  async update(id: string, patch: Partial<Job>): Promise<Job> { ... }
  async findAll(filter: JobFilter): Promise<Job[]> { ... }
}
```

### 3. Database connection module

**File:** `apps/api/src/infra/db/postgres.ts`

```typescript
import postgres from 'postgres';
export function createDb(url: string) {
  return postgres(url, { max: 10, idle_timeout: 20 });
}
```

Read `DATABASE_URL` from environment. Never log the URL.

### 4. Real password hashing

**File:** `apps/api/src/infra/auth/password.ts`

- Hash with `bcrypt` (rounds=12) or `argon2id`
- `hashPassword(plain: string): Promise<string>`
- `verifyPassword(plain: string, hash: string): Promise<boolean>`

Update `auth.routes.ts` to call `verifyPassword` instead of accepting any password.

Update user seed in `app.ts` to store a real hash.

### 5. Permission guards in routes

**File:** `apps/api/src/middleware/require-permission.ts`

Create a Fastify preHandler factory:
```typescript
export function requirePermission(
  checkPermission: CheckPermissionService,
  permission: Permission
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { sub, role } = req.user as { sub: string; role: Role };
    checkPermission.assertCan({ userId: sub, role }, permission);
  };
}
```

Wire into routes:
- `POST /printers` → requires `printer:create`
- `POST /jobs` → requires `job:create`
- `DELETE /jobs/:id` → requires `job:cancel`
- `GET /audit` → requires `audit:read`
- `GET /export` → requires `export:read`

JWT payload must include `role` — update `auth.routes.ts` to embed role in token.

### 6. Environment configuration

**File:** `.env.example`

```env
DATABASE_URL=postgres://printerops:printerops@localhost:5432/printerops
JWT_SECRET=change-me-in-production
PORT=3001
```

**File:** `apps/api/src/config.ts`

```typescript
export const config = {
  databaseUrl: process.env['DATABASE_URL'] ?? '',
  jwtSecret: process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production',
  port: Number(process.env['PORT'] ?? 3001),
};
```

### 7. Docker Compose for local dev

**File:** `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: printerops
      POSTGRES_USER: printerops
      POSTGRES_PASSWORD: printerops
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
volumes:
  postgres_data:
```

### 8. Repository integration tests

**File:** `apps/api/src/tests/postgres-job.repo.test.ts`

- Requires `TEST_DATABASE_URL` env
- Creates/drops schema per test run
- Tests: create job, findById, update status, findAll with filter
- Use `vitest` with real Postgres (no mocks)

### 9. Fake print job end-to-end test (HTTP layer)

**File:** `apps/api/src/tests/fake-print-e2e.test.ts`

Full HTTP flow via `app.inject()` (Fastify test helper, no network needed):
1. `POST /auth/login` → token
2. `POST /printers` → printer
3. `POST /jobs` → job (status: PENDING)
4. `POST /jobs/:id/execute` → job (status: SUCCESS)
5. `GET /jobs/:id/trace` → trace with ≥2 steps
6. `GET /audit?resourceId=:id` → audit entries including `job.succeeded`

---

## Definition of Done for Day 2

- [ ] All 6 Postgres repos implemented and satisfying their port interfaces
- [ ] `npm test` passes with `TEST_DATABASE_URL` pointing to real Postgres
- [ ] `POST /auth/login` rejects wrong password
- [ ] Permission-denied routes return 403 for VIEWER
- [ ] Fake print job E2E test passes via `app.inject()`
- [ ] `.env.example` committed, no real credentials committed
- [ ] `docker-compose up` starts Postgres and API boots cleanly

---

## Suggested Day 2 prompt

```
Day 2 작업 시작합니다. Branch: printerops-foundation

목표:
1. packages/adapters에 postgres.js 설치, apps/api에 DATABASE_URL 설정
2. apps/api/src/infra/repos/postgres/ 하위에 6개 PostgresRepository 구현
3. apps/api/src/infra/db/postgres.ts 연결 모듈 작성
4. apps/api/src/infra/auth/password.ts — argon2 해싱
5. auth.routes.ts에서 verifyPassword 호출
6. requirePermission() 미들웨어 작성 후 POST /printers, POST /jobs, GET /audit에 적용
7. .env.example 작성
8. docker-compose.yml 작성
9. apps/api/src/tests/fake-print-e2e.test.ts 작성 (app.inject 사용)
10. npm test 전체 통과 확인

docs/status/next-steps.md 참고. 기존 in-memory repos는 삭제하지 말고 유지할 것.
```
