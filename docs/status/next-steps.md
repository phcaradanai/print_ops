# PrintOps — Next Steps

**Phase:** MVP Nippon → Day 3: Real Printer Adapters + Persistence
**Prerequisite:** MVP Nippon on branch `mvp_nippon` complete and passing (23/23 tests, clean build).

---

## Priority 1: PostgreSQL Persistence

Replace in-memory repos with real Postgres (idempotency must survive restart):

```
apps/api/src/infra/db/postgres.ts          — connection pool (postgres.js)
apps/api/src/infra/repos/postgres/         — 7 Postgres repo implementations:
  postgres-job.repo.ts
  postgres-printer.repo.ts
  postgres-trace.repo.ts
  postgres-audit.repo.ts
  postgres-runner.repo.ts
  postgres-user.repo.ts
  postgres-service-account.repo.ts
```

Use `infra/migrations/001_initial_schema.sql` as the schema source.
Swap repos in `app.ts` when `DATABASE_URL` env is set; fall back to in-memory.

## Priority 2: Real Printer Adapters

### RawTcp9100Adapter (Zebra / POSTEK / label printers)
File: `packages/adapters/src/raw-tcp-9100/raw-tcp-9100.adapter.ts`
- Use Node.js `net.Socket` to open TCP connection to `<host>:9100`
- Send raw ZPL or TSPL bytes
- Close connection
- Use `ZplBuilder` or `TsplBuilder` helper from `packages/adapters/src/zpl/` and `tspl/`
- Target: < 200ms for a single label over 100Mbps LAN

### WindowsSpoolerAdapter
File: `packages/adapters/src/windows/windows-spooler.adapter.ts`
- Call Windows `winspool.drv` via `child_process.exec` or native addon
- Or use `pdfToPrinter` / `rawPrint` npm packages as a first step
- Must work via named printer (`\\server\printer` or local name)

### CupsPrinterAdapter
File: `packages/adapters/src/cups/cups-printer.adapter.ts`
- Use `lp` or `lpr` CLI commands via `child_process.exec`
- Or use `node-cups` package

## Priority 3: Auth Hardening

```
apps/api/src/infra/auth/password.ts   — argon2id hashing
apps/api/src/middleware/require-permission.ts — Fastify preHandler
```

- `POST /auth/login` — verify real password hash
- Wire `requirePermission()` to internal routes (job:create, printer:create, audit:read, export:read)
- Embed `role` in JWT payload; runner uses service-specific JWT

## Priority 4: BullMQ Queue

File: `apps/api/src/infra/queue/bullmq-job.queue.ts`
- Implements `JobQueuePort`
- Uses Redis via `ioredis`
- Per-printer queues (queue name = `printer:<printerId>`)
- Priority support (BullMQ native)
- Dead-letter queue for FAILED jobs
- Runner subscribes as BullMQ Worker instead of polling

## Priority 5: Docker Compose

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_DB: printerops, POSTGRES_USER: printerops, POSTGRES_PASSWORD: printerops }
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  api:
    build: ./apps/api
    env_file: .env
    ports: ["3001:3001"]
    depends_on: [postgres, redis]
  runner:
    build: ./apps/runner
    env_file: .env.runner
    depends_on: [api]
```

## Priority 6: Runner — Local Execution Model

Currently the runner delegates execution to the API. For real printers, move adapter execution INTO the runner:

```
Old:  Runner polls → API executes adapter → result
New:  Runner polls → Runner executes adapter locally → reports result to API
```

New runner endpoints:
- `POST /api/v1/runners/:id/jobs/:jobId/claim`   → DISPATCHED
- `POST /api/v1/runners/:id/jobs/:jobId/result`  → SUCCESS/FAILED + full timing

This allows a Zebra printer connected to PC-A to print, even though the API server is on PC-B.

## Priority 7: E2E / Integration Tests

```
apps/api/src/tests/external-api-e2e.test.ts   — full HTTP flow via app.inject()
apps/api/src/tests/idempotency-e2e.test.ts    — idempotency across restarts (requires Postgres)
```

---

## Suggested Next Prompt

```
Day 3 작업 시작합니다. Branch: mvp_nippon 기준으로 새 branch 만들어 진행.

목표:
1. RawTcp9100Adapter 구현 (Node.js net.Socket, ZPL/TSPL bytes 전송)
2. WindowsSpoolerAdapter 구현 (child_process + lp/winspool)
3. PostgreSQL repo 구현 (infra/migrations/001 기반, postgres.js 사용)
4. Runner 로컬 실행 모델 전환 (runner가 adapter 직접 실행 → API에 result 리포트)
5. docker-compose.yml 작성
6. argon2 password hash 적용
7. npm test + npm run build 통과

PrintOps는 Generic Print Gateway. HIS와 직접 연결 없음.
Local Runner가 printer에 직접 접근. Idempotency 유지 필수.
```
