# PrintOps

PrintOps is a generic print gateway for sending print jobs from an external
integration program to printers on a local network.

It does not connect directly to HIS or any clinical/business system. The
external integration program is responsible for reading from that system,
building a print request, and calling the PrintOps API.

## What Is In This Repo

- `apps/api` - Fastify REST API for jobs, printers, runners, auth, audit logs, and exports.
- `apps/web` - Vite + React dashboard for operators.
- `apps/runner-go` - **Production Go runner.** Statically compiled binary that registers with the API, polls jobs, sends heartbeats, executes print jobs, and syncs printer discovery. Replaces the TypeScript runner for all default workflows.
- `apps/runner` - **Legacy reference.** TypeScript runner preserved for dev comparison and historical tests. Not started by `npm run dev` or built by `npm run build`.
- `apps/desktop` - Tauri shell that loads the web UI and launches the Go runner binary.
- `packages/domain` - Domain models, ports, and events.
- `packages/adapters` - Printer adapter implementations and helpers.
- `packages/shared` - Shared utilities.
- `docs` - Architecture, local development, and operational notes.
- `infra/migrations` - SQL schema for future database-backed storage.
- `infra/docker/docker-compose.yml` - Draft local Docker stack. The referenced Dockerfiles are not present in this repo yet, so treat this as TBD / ต้องยืนยัน before using it.

## Developer Usage

### Prerequisites

- Node.js `>=20.0.0`
- npm `>=10.0.0`
- Go `>=1.21.0` (required for the production runner)
- Optional for the desktop app: Rust and Tauri CLI
- Optional for future persistence work: Docker, PostgreSQL, and Redis
- Optional for printer discovery:
  - macOS/Linux: `lpstat`
  - Windows: PowerShell `Get-Printer`

The required Node and npm versions are declared in `package.json`. The Go runner module is at `apps/runner-go/go.mod`.

### Install And Setup

From the repo root:

```bash
npm install
```

This installs dependencies for all npm workspaces.

There is no committed `.env.example` file in the repo. The app reads environment
variables directly from the shell. For local development, defaults are already
provided for the API and runner.

### Environment And Config

API defaults from `apps/api/src/server.ts` and `apps/api/src/app.ts`:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3001` | API port |
| `HOST` | `0.0.0.0` | API bind host |
| `JWT_SECRET` | `dev-secret-change-in-production` | Development JWT secret |
| `PRINTOPS_DEV_API_KEY` | `printops-dev-apikey-2026` | Dev API key for `/api/v1` external endpoints |

Runner defaults (primary runner is `apps/runner-go`; see its README for the full config reference):

| Variable | Default | Notes |
| --- | --- | --- |
| `API_URL` | `http://localhost:3001` | API base URL used by the runner |
| `RUNNER_API_TOKEN` | empty | If empty, runner logs in with dev credentials |
| `RUNNER_NAME` | `runner-{HOSTNAME}` | Display name registered with API |
| `HOSTNAME` | `localhost` | Runner host metadata |
| `SUPPORTED_PROTOCOLS` | `fake,ipp,cups` | Protocols reported by the runner |
| `POLL_INTERVAL_MS` | `2000` | Job polling interval |
| `HEARTBEAT_INTERVAL_MS` | `10000` | Runner heartbeat interval |
| `DISCOVERY_INTERVAL_MS` | `60000` | Printer discovery interval |
| `DISCOVERY_ADAPTER` | `auto` | `auto`, `windows`, `macos`, or `fake` |
| `RUNNER_DEV_EMAIL` | `admin@printerops.local` | Used only when `RUNNER_API_TOKEN` is empty |
| `RUNNER_DEV_PASSWORD` | `dev-password` | Any password is accepted in the current MVP auth flow |

The Go runner uses `PRINTOPS_`-prefixed variables (e.g. `PRINTOPS_API_BASE_URL`, `PRINTOPS_RUNNER_TOKEN`). See `apps/runner-go/README.md` for the complete production config reference.

- Web UI runs on `http://localhost:3000`.
- Vite proxies `/api/*` to `http://localhost:3001`.

Seeded local development values:

| Item | Value |
| --- | --- |
| Dashboard login email | `admin@printerops.local` |
| Dashboard login password | Any password is accepted in the current MVP auth flow |
| Dev external API key | `printops-dev-apikey-2026` |
| Seeded fake printer | `LAB_LABEL_01` |
| Seeded fake printer | `OFFICE_LASER_01` |

### Run In Development

Run API, web, and Go runner together:

```bash
npm run dev
```

This starts the API (`apps/api`), web dashboard (`apps/web`), and the production Go runner (`apps/runner-go`) via `concurrently`.

Run individual services:

```bash
npm run dev -w apps/api
npm run dev -w apps/web
npm run dev:runner-go
```

To run the legacy TypeScript runner (reference only):

```bash
npm run dev:runner-ts
```

Local URLs:

| Service | URL |
| --- | --- |
| Web dashboard | `http://localhost:3000` |
| API | `http://localhost:3001` |
| Go runner | No browser UI. Connects to the API on `http://localhost:3001`. |

Desktop shell:

```bash
npm run tauri:dev -w apps/desktop
```

The desktop app expects the web dev server at `http://localhost:3000` and launches the Go runner binary automatically.

### Test, Typecheck, And Build

```bash
npm test
npm run build
```

Go runner-specific commands:

```bash
npm run build:runner-go    # Build the Go runner binary
npm run test:runner-go     # Run Go runner tests (go test ./...)
```

There is also a repo-level typecheck command:

```bash
npm run typecheck
```

At the time this README was written, `npm run typecheck` is present in
`package.json` but fails in `apps/web/src/pages/LocalDiagnostics.tsx` because
`apiFetch` is called with a second argument that its helper signature does not
accept. This is an application code issue, not a setup step.

Workspace-specific examples:

```bash
npm test -w apps/api
npm test -w apps/runner
npm run build -w apps/web
```

The legacy TypeScript runner tests are kept for reference:

```bash
npm test -w apps/runner
```

### Useful Development API Test

Start the API and runner first, then send a fake print job:

```bash
curl -X POST http://localhost:3001/api/v1/print-jobs \
  -H "X-Api-Key: printops-dev-apikey-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "REQ-TEST-001",
    "source_system": "integration-service",
    "printer_code": "LAB_LABEL_01",
    "payload": { "label": "test", "barcode": "ABC123" },
    "copies": 1,
    "priority": "normal"
  }'
```

Send the same `request_id` and `source_system` again to test idempotency. The
API should return the existing job instead of creating a second print.

### Common Troubleshooting

| Problem | What to check |
| --- | --- |
| `Register attempt 1 failed` from Go runner | Confirm the API is running on `http://localhost:3001` or set `PRINTOPS_API_BASE_URL`. |
| Web dashboard API calls fail | Confirm `npm run dev -w apps/api` is running. The web dev server proxies `/api` to port `3001`. |
| Go runner logs in unexpectedly | `PRINTOPS_RUNNER_TOKEN` is empty, so the runner uses the dev login flow. |
| No printers appear in discovery | Use `PRINTOPS_DISCOVERY_MODE=fake npm run dev:runner-go` for local fake discovery. On Windows, confirm Print Spooler and `Get-Printer`; on macOS/Linux, confirm `lpstat`. |
| Data disappears after restart | Current runtime repositories are in-memory. PostgreSQL persistence is documented but not wired as the active runtime path. |
| Real printer does not print | Real printer adapters are skeleton/incomplete in the current repo. Use the fake adapter path for verified local flow. |
| Docker Compose does not build | `infra/docker/docker-compose.yml` references Dockerfiles that are not present. This is TBD / ต้องยืนยัน. |

## Client/User Usage

### What PrintOps Does

PrintOps accepts print jobs through an HTTP API, validates them, queues them,
lets a local runner pick them up, and records trace/audit information for each
job.

The intended production shape is:

```text
External system or HIS
  -> external integration program
  -> PrintOps API
  -> local runner on the printer network
  -> printer
```

In the current repo, the verified local print path uses fake printers. Real
printer adapters for raw TCP 9100, Windows spooler, CUPS, and IPP exist as
adapter files, but the status docs mark them as skeletons or not production-ready.

### How A Client Or Operator Starts

For local MVP testing:

1. Start the API, web UI, and runner.
2. Open `http://localhost:3000`.
3. Log in as `admin@printerops.local` with any password.
4. Check **Printers** for seeded fake printers.
5. Check **Runners** to confirm the runner is online.
6. Send print jobs through the external API using the dev API key.
7. Monitor jobs in **Dashboard**, **Job Queue**, **Job Detail**, **Audit Logs**, and **Export**.

For a real client deployment, confirm these items first:

- Real printer adapter path: TBD / ต้องยืนยัน.
- Durable PostgreSQL storage: TBD / ต้องยืนยัน.
- Real authentication and password policy: TBD / ต้องยืนยัน.
- Production API keys and service account setup: TBD / ต้องยืนยัน.
- Network placement of API, runner, and printers: TBD / ต้องยืนยัน.
- Whether runner execution should happen locally on the runner machine rather than through the API: TBD / ต้องยืนยัน.

### Main Workflow

1. An external integration program creates a print request.
2. It calls `POST /api/v1/print-jobs` with `X-Api-Key`.
3. PrintOps checks the API key, `request_id`, `source_system`, printer code, template code, payload size, and copies.
4. PrintOps creates a job and queues it.
5. A runner registers, sends heartbeats, polls for queued jobs, and executes the job path.
6. PrintOps records status changes, timing trace, and audit events.
7. Operators review status in the dashboard or query the API.
8. Operators can export jobs, audit logs, and printer status from the export endpoints/UI.

Current job statuses include:

```text
ACCEPTED -> VALIDATED -> QUEUED -> DISPATCHED -> PRINTING -> SUCCESS
```

Other terminal or alternate statuses include `FAILED`, `TIMEOUT`, `CANCELLED`,
and `DUPLICATE_RETURNED`.

### Expected Inputs

External print API request:

```json
{
  "request_id": "REQ-20260707-0001",
  "source_system": "integration-service",
  "source_reference": "ORDER-123456",
  "printer_code": "LAB_LABEL_01",
  "template_code": "default-label",
  "payload": {
    "patient_name": "Example",
    "barcode": "ABC123"
  },
  "copies": 1,
  "priority": "normal",
  "metadata": {}
}
```

Required fields confirmed from the route code:

- `request_id`
- `printer_code`
- `payload` should be an object
- `X-Api-Key` header

`source_system` defaults to the service account source system when omitted.

### Expected Outputs

New job response:

```json
{
  "print_job_id": "uuid",
  "request_id": "REQ-20260707-0001",
  "status": "QUEUED",
  "trace_id": "trace_uuid",
  "accepted_at": "2026-07-07T10:00:00Z",
  "duplicate": false
}
```

Duplicate request response:

```json
{
  "print_job_id": "original-uuid",
  "request_id": "REQ-20260707-0001",
  "status": "DUPLICATE_RETURNED",
  "duplicate": true,
  "existing_job_id": "original-uuid"
}
```

Operators can also retrieve:

- Job detail: `GET /api/v1/print-jobs/:id`
- Job by original request ID: `GET /api/v1/print-jobs/by-request-id/:requestId?source_system=...`
- Job trace: `GET /api/v1/print-jobs/:id/trace`
- Printer list: `GET /api/v1/printers`
- Printer status: `GET /api/v1/printers/:id/status`
- Exports: `GET /api/v1/exports/jobs.csv`, `jobs.json`, and `audit.csv`

### Limitations And Things To Confirm

- Runtime storage is in-memory, so local data is lost on restart.
- The SQL migration exists, but active PostgreSQL repositories are TBD / ต้องยืนยัน.
- Queueing is in-memory, not Redis/BullMQ.
- Current dashboard auth accepts any password for the seeded admin user.
- API key auth exists for external `/api/v1` endpoints, with a seeded dev key.
- Real printer adapters are not confirmed production-ready.
- Current runner execution uses local Go runner adapter execution. The Go runner resolves the printer protocol at runtime and dispatches to the matching executor.
- Docker Compose references Dockerfiles that are not present in this repo.
- Production service account creation, key rotation, and deployment steps are TBD / ต้องยืนยัน.

## คู่มือภาษาไทย

PrintOps คือระบบกลางสำหรับรับคำสั่งพิมพ์จากโปรแกรม integration ภายนอก แล้วส่งต่อไปยัง printer ผ่าน API และ local runner

ระบบนี้ไม่ได้เชื่อม HIS หรือระบบธุรกิจโดยตรง โปรแกรม integration ภายนอกต้องเป็นตัวอ่านข้อมูลจากระบบต้นทาง สร้างคำสั่งพิมพ์ แล้วเรียก PrintOps API

### สำหรับนักพัฒนา

#### สิ่งที่ต้องมี

- Node.js `>=20.0.0`
- npm `>=10.0.0`
- Go `>=1.21.0` (จำเป็นสำหรับ production runner)
- ถ้าจะรัน desktop app: ต้องมี Rust และ Tauri CLI
- ถ้าจะทดสอบ printer discovery:
  - macOS/Linux ใช้ `lpstat`
  - Windows ใช้ PowerShell `Get-Printer`
- Docker, PostgreSQL, Redis เป็นงานอนาคต/ต้องยืนยันก่อนใช้จริง

#### ติดตั้ง

รันจาก root ของ repo:

```bash
npm install
```

repo นี้ยังไม่มีไฟล์ `.env.example` ที่ commit ไว้ ค่า config หลักอ่านจาก environment variable และมีค่า default สำหรับ local development อยู่แล้ว

#### ค่า config สำคัญ

API:

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `PORT` | `3001` | port ของ API |
| `HOST` | `0.0.0.0` | host ที่ API bind |
| `JWT_SECRET` | `dev-secret-change-in-production` | secret สำหรับ dev JWT |
| `PRINTOPS_DEV_API_KEY` | `printops-dev-apikey-2026` | API key สำหรับ external API ใน dev |

Runner (runner หลักคือ `apps/runner-go`; ดู config ทั้งหมดใน README ของ Go runner):

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `API_URL` | `http://localhost:3001` | URL ของ API ที่ runner จะเชื่อม |
| `RUNNER_API_TOKEN` | ว่าง | ถ้าว่าง runner จะ login ด้วย dev account |
| `RUNNER_NAME` | `runner-{HOSTNAME}` | ชื่อ runner ที่แสดงใน dashboard |
| `SUPPORTED_PROTOCOLS` | `fake,ipp,cups` | protocol ที่ runner รายงานว่ารองรับ |
| `POLL_INTERVAL_MS` | `2000` | รอบเวลาที่ runner poll งาน |
| `HEARTBEAT_INTERVAL_MS` | `10000` | รอบเวลาส่ง heartbeat |
| `DISCOVERY_INTERVAL_MS` | `60000` | รอบเวลาค้นหา printer |
| `DISCOVERY_ADAPTER` | `auto` | `auto`, `windows`, `macos`, หรือ `fake` |

ค่า dev ที่ seed มาให้:

| รายการ | ค่า |
| --- | --- |
| email สำหรับ dashboard | `admin@printerops.local` |
| password สำหรับ dashboard | ใส่อะไรก็ได้ใน MVP ปัจจุบัน |
| dev API key | `printops-dev-apikey-2026` |
| fake printer | `LAB_LABEL_01` |
| fake printer | `OFFICE_LASER_01` |

#### รันระบบตอนพัฒนา

รัน API, web, และ Go runner พร้อมกัน:

```bash
npm run dev
```

หรือแยกรันคนละ terminal:

```bash
npm run dev -w apps/api
npm run dev -w apps/web
npm run dev:runner-go
```

ถ้าต้องการรัน TypeScript runner แบบ legacy (อ้างอิงเท่านั้น):

```bash
npm run dev:runner-ts
```

URL หลัก:

| Service | URL |
| --- | --- |
| Dashboard | `http://localhost:3000` |
| API | `http://localhost:3001` |
| Runner | ไม่มีหน้าเว็บ เชื่อม API โดยตรง |

รัน desktop shell:

```bash
npm run tauri:dev -w apps/desktop
```

ต้องเปิด web dev server ที่ `http://localhost:3000` ก่อน

#### ทดสอบและ build

```bash
npm test
npm run build
```

มีคำสั่ง typecheck ด้วย:

```bash
npm run typecheck
```

แต่ตอนเขียน README นี้ `npm run typecheck` ยัง fail ที่ `apps/web/src/pages/LocalDiagnostics.tsx` เพราะเรียก `apiFetch` ด้วย argument ตัวที่สอง ทั้งที่ helper รับ argument เดียว นี่เป็น issue ใน application code ไม่ใช่ขั้นตอน setup

#### ตัวอย่างส่งงานพิมพ์สำหรับ dev

ต้องเปิด API และ runner ก่อน:

```bash
curl -X POST http://localhost:3001/api/v1/print-jobs \
  -H "X-Api-Key: printops-dev-apikey-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "REQ-TEST-001",
    "source_system": "integration-service",
    "printer_code": "LAB_LABEL_01",
    "payload": { "label": "test", "barcode": "ABC123" },
    "copies": 1,
    "priority": "normal"
  }'
```

ถ้าส่ง `request_id` และ `source_system` ซ้ำ ระบบควรคืน job เดิม ไม่สร้างงานพิมพ์ซ้ำ

#### Troubleshooting ที่พบบ่อย

| ปัญหา | ตรวจอะไร |
| --- | --- |
| runner ขึ้น `Register attempt 1 failed` | ตรวจว่า API เปิดที่ `http://localhost:3001` หรือ set `PRINTOPS_API_BASE_URL` ถูกต้อง |
| dashboard เรียก API ไม่ได้ | ตรวจว่า `npm run dev -w apps/api` เปิดอยู่ |
| runner login เอง | `PRINTOPS_RUNNER_TOKEN` ว่าง จึงใช้ dev login flow |
| ไม่เจอ printer discovery | ลอง `PRINTOPS_DISCOVERY_MODE=fake npm run dev:runner-go` |
| restart แล้วข้อมูลหาย | runtime ปัจจุบันใช้ in-memory storage |
| printer จริงไม่พิมพ์ | real printer adapters ยังไม่ยืนยันว่า production-ready |
| Docker Compose build ไม่ได้ | `infra/docker/docker-compose.yml` อ้างถึง Dockerfile ที่ยังไม่มี ต้องยืนยัน |

### สำหรับลูกค้า/ผู้ใช้งาน

#### ระบบนี้ทำอะไร

PrintOps รับคำสั่งพิมพ์ผ่าน HTTP API, ตรวจสอบสิทธิ์และข้อมูล, queue งาน, ให้ runner รับงานไปดำเนินการ, และเก็บ trace/audit สำหรับตรวจสอบย้อนหลัง

ภาพรวมการใช้งานที่ตั้งใจไว้:

```text
ระบบต้นทางหรือ HIS
  -> โปรแกรม integration ภายนอก
  -> PrintOps API
  -> local runner ใน network ที่เห็น printer
  -> printer
```

ใน repo ปัจจุบัน path ที่ verify ได้คือ fake printer สำหรับ local MVP ส่วน printer จริง เช่น raw TCP 9100, Windows spooler, CUPS, IPP ยังต้องยืนยันก่อนใช้งานจริง

#### เริ่มใช้งานแบบ local MVP

1. เปิด API, web UI, และ runner
2. เข้า `http://localhost:3000`
3. login ด้วย `admin@printerops.local` และ password อะไรก็ได้
4. ดูหน้า **Printers** ว่ามี fake printer ที่ seed มา
5. ดูหน้า **Runners** ว่า runner online
6. ให้โปรแกรม integration หรือ curl ส่ง print job เข้า external API
7. ติดตามงานที่ **Dashboard**, **Job Queue**, **Job Detail**, **Audit Logs**, และ **Export**

#### Workflow หลัก

1. โปรแกรม integration ภายนอกสร้าง print request
2. เรียก `POST /api/v1/print-jobs` พร้อม header `X-Api-Key`
3. PrintOps ตรวจ API key, `request_id`, `source_system`, printer code, template code, payload size, และจำนวน copies
4. PrintOps สร้าง job และนำเข้า queue
5. runner register, ส่ง heartbeat, poll งาน, และ execute job path
6. PrintOps บันทึก status, timing trace, และ audit event
7. operator ดูสถานะผ่าน dashboard หรือ API
8. operator export ข้อมูล jobs, audit logs, และ printer status ได้

สถานะงานหลัก:

```text
ACCEPTED -> VALIDATED -> QUEUED -> DISPATCHED -> PRINTING -> SUCCESS
```

สถานะอื่นที่เป็นไปได้ ได้แก่ `FAILED`, `TIMEOUT`, `CANCELLED`, และ `DUPLICATE_RETURNED`

#### Input ที่คาดหวัง

ตัวอย่าง request:

```json
{
  "request_id": "REQ-20260707-0001",
  "source_system": "integration-service",
  "source_reference": "ORDER-123456",
  "printer_code": "LAB_LABEL_01",
  "template_code": "default-label",
  "payload": {
    "patient_name": "Example",
    "barcode": "ABC123"
  },
  "copies": 1,
  "priority": "normal",
  "metadata": {}
}
```

field ที่ยืนยันจาก route code ว่าจำเป็น:

- `request_id`
- `printer_code`
- `payload` ควรเป็น object
- header `X-Api-Key`

ถ้าไม่ส่ง `source_system` ระบบจะใช้ค่าจาก service account

#### Output ที่คาดหวัง

งานใหม่:

```json
{
  "print_job_id": "uuid",
  "request_id": "REQ-20260707-0001",
  "status": "QUEUED",
  "trace_id": "trace_uuid",
  "accepted_at": "2026-07-07T10:00:00Z",
  "duplicate": false
}
```

งานซ้ำ:

```json
{
  "print_job_id": "original-uuid",
  "request_id": "REQ-20260707-0001",
  "status": "DUPLICATE_RETURNED",
  "duplicate": true,
  "existing_job_id": "original-uuid"
}
```

#### ข้อจำกัดและสิ่งที่ต้องยืนยัน

- ข้อมูล runtime เป็น in-memory และหายเมื่อ restart
- PostgreSQL persistence ยังต้องยืนยัน
- queue ยังเป็น in-memory ไม่ใช่ Redis/BullMQ
- auth ปัจจุบันยังรับ password อะไรก็ได้สำหรับ admin dev user
- external API มี API key auth และมี dev key ที่ seed มา
- real printer adapters ยังไม่ยืนยันว่าใช้งาน production ได้
- runner execution ใช้ Go runner เป็นหลัก โดย resolve printer protocol และ dispatch ไป executor ที่ตรงกัน
- production service account, key rotation, network setup, และ deployment steps ยัง TBD / ต้องยืนยัน

## More Documentation

- `docs/operations/local-dev.md`
- `docs/status/current-status.md`
- `docs/status/next-steps.md`
- `docs/architecture/overview.md`
- `docs/architecture/external-print-api.md`
- `docs/architecture/mvp-nippon-flow.md`
- `docs/guides/local-macos-dev.md`
- `docs/guides/local-windows-runner.md`
