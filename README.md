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
- Go `>=1.21.0` (required for the production runner, and to build the Go runner binary bundled into the desktop installer)
- Optional, only for building the desktop installer (see [Build The Desktop Installer](#build-the-desktop-installer)):
  - Rust via [rustup](https://rustup.rs/), plus the MSVC C++ build tools (Visual Studio Build Tools — "Desktop development with C++" workload) on Windows
  - The Tauri CLI itself does **not** need a separate install — it's `apps/desktop`'s `@tauri-apps/cli` devDependency, pulled in by `npm install`
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

### Build The Desktop Installer

The desktop installer (`.msi` and `.exe`) bundles everything into one package: the
React web UI, the API as a standalone `server.exe` (via `pkg`), and the Go runner
as `printops-runner.exe`. It does **not** need the dev servers running — it's a
from-scratch production build.

Prerequisites beyond Node and Go: Rust (via [rustup](https://rustup.rs/)) and, on
Windows, the MSVC C++ build tools (Visual Studio Build Tools with the "Desktop
development with C++" workload). The WiX (`.msi`) and NSIS (`.exe`) bundlers
themselves are downloaded automatically by Tauri on first build — no separate
install needed, but the first build does need internet access for that download.

#### Step 1: Update Version

Update the version in all package files before building. The version appears in:
- Root `package.json`
- `apps/desktop/src-tauri/tauri.conf.json` (controls MSI/NSIS filename: `PrinterOps_X.Y.Z_...`)
- `apps/api/package.json`
- `apps/web/package.json`

**PowerShell script** (save as `scripts/bump-version.ps1`):

```powershell
$VERSION = "0.2.0"  # Change this to desired version

@(
    "package.json",
    "apps/api/package.json",
    "apps/web/package.json"
) | ForEach-Object {
    (Get-Content $_) | ConvertFrom-Json | ForEach-Object { $_.version = $VERSION } | ConvertTo-Json | Set-Content $_
}

$tauri = (Get-Content "apps/desktop/src-tauri/tauri.conf.json") | ConvertFrom-Json
$tauri.version = $VERSION
$tauri.productVersion = $VERSION
$tauri | ConvertTo-Json | Set-Content "apps/desktop/src-tauri/tauri.conf.json"

Write-Host "✓ Version updated to $VERSION"
```

Run:
```powershell
.\scripts\bump-version.ps1
```

Or **Bash script** (save as `scripts/bump-version.sh`):

```bash
#!/bin/bash
VERSION="0.2.0"  # Change this

jq --arg v "$VERSION" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json

jq --arg v "$VERSION" '.version = $v' apps/api/package.json > package.json.tmp && mv package.json.tmp apps/api/package.json

jq --arg v "$VERSION" '.version = $v' apps/web/package.json > package.json.tmp && mv package.json.tmp apps/web/package.json

jq --arg v "$VERSION" '.version = $v | .productVersion = $v' apps/desktop/src-tauri/tauri.conf.json > tauri.conf.json.tmp && mv tauri.conf.json.tmp apps/desktop/src-tauri/tauri.conf.json

echo "✓ Version updated to $VERSION"
```

Run:
```bash
chmod +x scripts/bump-version.sh
./scripts/bump-version.sh
```

#### Step 2: Build Desktop Installer

From the repo root:

```bash
npm install
cd apps/desktop
npm run tauri:build
```

This runs `tauri build`, which first runs `beforeBuildCommand`
(`node src-tauri/scripts/build-all.js`) and then produces the installers.
`build-all.js` does, in order:

1. Builds `packages/domain`, `packages/shared`, `packages/adapters`.
2. Builds `apps/web` (`vite build`).
3. Builds and `pkg`-bundles `apps/api` into `apps/api/dist/server.exe`.
4. Runs `go build` in `apps/runner-go` to produce `printops-runner.exe`. If Go
   is not found, this step is skipped with a warning and the installer is
   still produced, but printer discovery/printing will be disabled at runtime.
5. Copies all of the above into `apps/desktop/src-tauri/resources/`.

The finished installers land at:

```text
apps/desktop/src-tauri/target/release/bundle/msi/PrinterOps_<version>_x64_en-US.msi
apps/desktop/src-tauri/target/release/bundle/nsis/PrinterOps_<version>_x64-setup.exe
```

To build without producing an installer (e.g. to sanity-check that everything
compiles and the resources get assembled), run the resource step alone:

```bash
node apps/desktop/src-tauri/scripts/build-all.js
```

**Known build-cache trap:** if `tauri:build` fails partway with esbuild unable to
resolve `dist/server.js` (or `dist/app.js`) even though the preceding `tsc` step
reported no errors, delete `apps/api/tsconfig.tsbuildinfo` and rebuild. TypeScript's
incremental-build cache can desync when `tsc --noEmit` (typecheck) and `tsc -p
tsconfig.json` (emit) are run against the same cache file — `tsc` then believes the
`.js` output is already current and silently skips writing it.

### Test, Typecheck, And Build

```bash
npm test
npm run typecheck
npm run build
```

Both `npm test` and `npm run typecheck` include the Go runner checks:

- `npm test` runs all Node workspace tests, then `npm run test:runner-go` (Go tests via `go test ./...`).
- `npm run typecheck` runs all TypeScript workspace type checks, then `npm run typecheck:runner-go`. The Go runner typecheck reuses `go test ./...` because Go compilation is validated through tests; there is no separate `go build` typecheck command in the default pipeline.

The legacy TypeScript runner tests are kept for reference and still run as part of `npm test` (through `--workspaces --if-present`). The runner itself is not started by `npm run dev` or built by `npm run build`:

```bash
npm test -w apps/runner
```

Stand-alone Go runner commands:

```bash
npm run build:runner-go     # Build the Go runner binary
npm run test:runner-go      # Run Go runner tests (go test ./...)
npm run typecheck:runner-go # Run Go runner typecheck (go test ./...)
```

Workspace-specific examples:

```bash
npm test -w apps/api
npm run build -w apps/web
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
| `tauri:build` fails on `Could not resolve "dist/server.js"` | Stale `apps/api/tsconfig.tsbuildinfo`. Delete it and rebuild — see [Build The Desktop Installer](#build-the-desktop-installer). |
| `tauri:build` fails / hangs while running the installer | The desktop app may already be running and holding the old `resources/*.exe` files locked. Stop `printerops-desktop.exe`, `server.exe`, and `printops-runner.exe` first. |

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
- Packaged Windows execution is owned by the bundled API local worker through the TypeScript `WindowsSpoolerAdapter`. The Go runner performs discovery and heartbeat only.
- Docker Compose references Dockerfiles that are not present in this repo.
- Production service account creation, key rotation, and deployment steps are TBD / ต้องยืนยัน.

## คู่มือภาษาไทย

PrintOps คือระบบกลางสำหรับรับคำสั่งพิมพ์จากโปรแกรม integration ภายนอก แล้วส่งต่อไปยัง printer ผ่าน API และ local runner

ระบบนี้ไม่ได้เชื่อม HIS หรือระบบธุรกิจโดยตรง โปรแกรม integration ภายนอกต้องเป็นตัวอ่านข้อมูลจากระบบต้นทาง สร้างคำสั่งพิมพ์ แล้วเรียก PrintOps API

### สำหรับนักพัฒนา

#### สิ่งที่ต้องมี

- Node.js `>=20.0.0`
- npm `>=10.0.0`
- Go `>=1.21.0` (จำเป็นสำหรับ production runner และสำหรับ build ตัว Go runner ที่ bundle เข้า desktop installer)
- ถ้าจะ build desktop installer เอง (ดู [Build ตัวติดตั้ง Desktop](#build-ตัวติดตั้ง-desktop)):
  - ต้องมี Rust ผ่าน [rustup](https://rustup.rs/) และบน Windows ต้องมี MSVC C++ build tools (Visual Studio Build Tools เลือก workload "Desktop development with C++")
  - Tauri CLI ไม่ต้องติดตั้งแยก — เป็น devDependency (`@tauri-apps/cli`) ของ `apps/desktop` อยู่แล้ว ติดมากับ `npm install`
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

#### Build ตัวติดตั้ง Desktop

ตัวติดตั้ง desktop (`.msi` และ `.exe`) รวมทุกอย่างไว้ในไฟล์เดียว: web UI (React),
API ที่ build เป็น `server.exe` แบบ standalone (ผ่าน `pkg`), และ Go runner เป็น
`printops-runner.exe` ไม่ต้องเปิด dev server ใด ๆ ไว้ก่อน — เป็นการ build จากศูนย์เพื่อ production

สิ่งที่ต้องมีเพิ่มจาก Node และ Go: Rust (ผ่าน [rustup](https://rustup.rs/)) และบน
Windows ต้องมี MSVC C++ build tools (Visual Studio Build Tools workload "Desktop
development with C++") ตัว bundler WiX (`.msi`) และ NSIS (`.exe`) เอง Tauri จะ
ดาวน์โหลดให้อัตโนมัติตอน build ครั้งแรก ไม่ต้องติดตั้งเอง แต่ build ครั้งแรกต้องมีอินเทอร์เน็ต

##### ขั้นตอนที่ 1: อัพเดต Version

อัพเดต version ในไฟล์ package ทั้งหมดก่อน build ตัวติดตั้ง version ปรากฏในไฟล์:
- Root `package.json`
- `apps/desktop/src-tauri/tauri.conf.json` (ควบคุม MSI/NSIS filename: `PrinterOps_X.Y.Z_...`)
- `apps/api/package.json`
- `apps/web/package.json`

**PowerShell script** (บันทึกเป็น `scripts/bump-version.ps1`):

```powershell
$VERSION = "0.2.0"  # เปลี่ยนเป็น version ที่ต้องการ

@(
    "package.json",
    "apps/api/package.json",
    "apps/web/package.json"
) | ForEach-Object {
    (Get-Content $_) | ConvertFrom-Json | ForEach-Object { $_.version = $VERSION } | ConvertTo-Json | Set-Content $_
}

$tauri = (Get-Content "apps/desktop/src-tauri/tauri.conf.json") | ConvertFrom-Json
$tauri.version = $VERSION
$tauri.productVersion = $VERSION
$tauri | ConvertTo-Json | Set-Content "apps/desktop/src-tauri/tauri.conf.json"

Write-Host "✓ Version updated to $VERSION"
```

รัน:
```powershell
.\scripts\bump-version.ps1
```

หรือ **Bash script** (บันทึกเป็น `scripts/bump-version.sh`):

```bash
#!/bin/bash
VERSION="0.2.0"  # เปลี่ยนเป็น version ที่ต้องการ

jq --arg v "$VERSION" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json

jq --arg v "$VERSION" '.version = $v' apps/api/package.json > package.json.tmp && mv package.json.tmp apps/api/package.json

jq --arg v "$VERSION" '.version = $v' apps/web/package.json > package.json.tmp && mv package.json.tmp apps/web/package.json

jq --arg v "$VERSION" '.version = $v | .productVersion = $v' apps/desktop/src-tauri/tauri.conf.json > tauri.conf.json.tmp && mv tauri.conf.json.tmp apps/desktop/src-tauri/tauri.conf.json

echo "✓ Version updated to $VERSION"
```

รัน:
```bash
chmod +x scripts/bump-version.sh
./scripts/bump-version.sh
```

##### ขั้นตอนที่ 2: Build Desktop Installer

รันจาก root ของ repo:

```bash
npm install
cd apps/desktop
npm run tauri:build
```

คำสั่งนี้รัน `tauri build` ซึ่งจะรัน `beforeBuildCommand`
(`node src-tauri/scripts/build-all.js`) ก่อน แล้วค่อยสร้างตัวติดตั้ง
`build-all.js` ทำตามลำดับนี้:

1. build `packages/domain`, `packages/shared`, `packages/adapters`
2. build `apps/web` (`vite build`)
3. build และ bundle `apps/api` ด้วย `pkg` ออกมาเป็น `apps/api/dist/server.exe`
4. รัน `go build` ใน `apps/runner-go` เพื่อสร้าง `printops-runner.exe` ถ้าไม่เจอ Go
   ขั้นตอนนี้จะข้ามพร้อม warning แต่ตัวติดตั้งยังสร้างได้ เพียงแต่ printer
   discovery/printing จะใช้งานไม่ได้ตอนรันจริง
5. copy ทุกอย่างด้านบนเข้า `apps/desktop/src-tauri/resources/`

ตัวติดตั้งที่ได้จะอยู่ที่:

```text
apps/desktop/src-tauri/target/release/bundle/msi/PrinterOps_<version>_x64_en-US.msi
apps/desktop/src-tauri/target/release/bundle/nsis/PrinterOps_<version>_x64-setup.exe
```

ถ้าต้องการแค่ build เพื่อเช็คว่าคอมไพล์ผ่านและ resource ครบ โดยไม่ต้องสร้างตัวติดตั้งจริง:

```bash
node apps/desktop/src-tauri/scripts/build-all.js
```

**กับดัก build-cache ที่เคยเจอ:** ถ้า `tauri:build` fail กลางทางที่ esbuild หา
`dist/server.js` (หรือ `dist/app.js`) ไม่เจอ ทั้งที่ `tsc` ก่อนหน้าไม่ error เลย ให้ลบ
`apps/api/tsconfig.tsbuildinfo` แล้ว build ใหม่ สาเหตุคือ cache แบบ incremental
build ของ TypeScript desync ได้ เมื่อรัน `tsc --noEmit` (typecheck) กับ `tsc -p
tsconfig.json` (emit จริง) ด้วย cache ไฟล์เดียวกัน — `tsc` จะเข้าใจผิดว่าไฟล์ `.js`
เป็นของปัจจุบันอยู่แล้ว แล้วเงียบ ๆ ไม่ยอม emit

#### ทดสอบและ build

```bash
npm test
npm run typecheck
npm run build
```

`npm test` และ `npm run typecheck` รวม Go runner checks ไว้แล้ว:

- `npm test` รัน Node workspace test ทั้งหมด แล้วรัน `npm run test:runner-go` (Go test ผ่าน `go test ./...`)
- `npm run typecheck` รัน TypeScript workspace typecheck ทั้งหมด แล้วรัน `npm run typecheck:runner-go` Go runner ใช้ `go test ./...` เพราะ Go compilation ถูก validate ผ่าน tests อยู่แล้ว ไม่มีคำสั่ง `go build` แยกใน default pipeline

test ของ TypeScript runner ยังเก็บไว้เป็น reference และยังรันเป็นส่วนหนึ่งของ `npm test` (ผ่าน `--workspaces --if-present`) แต่ตัว runner เองไม่ได้ถูก start โดย `npm run dev` หรือ build โดย `npm run build`:

```bash
npm test -w apps/runner
```

คำสั่ง Go runner แบบแยก:

```bash
npm run build:runner-go     # build Go runner binary
npm run test:runner-go      # รัน Go runner tests (go test ./...)
npm run typecheck:runner-go # รัน Go runner typecheck (go test ./...)
```

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
| `tauri:build` fail ที่ `Could not resolve "dist/server.js"` | `apps/api/tsconfig.tsbuildinfo` ค้าง ลบแล้ว build ใหม่ — ดู [Build ตัวติดตั้ง Desktop](#build-ตัวติดตั้ง-desktop) |
| `tauri:build` fail หรือค้างตอนสร้างตัวติดตั้ง | แอป desktop อาจรันอยู่และล็อกไฟล์ `resources/*.exe` เก่าไว้ ให้ปิด `printerops-desktop.exe`, `server.exe`, `printops-runner.exe` ก่อน |

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
- ในแพ็กเกจ Windows ตัวทำงาน API ภายในเครื่องเป็นผู้ดำเนินงานพิมพ์ผ่าน TypeScript `WindowsSpoolerAdapter` ส่วน Go runner ใช้ค้นหาเครื่องพิมพ์และส่ง heartbeat เท่านั้น
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
