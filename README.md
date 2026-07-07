# PrintOps

PrintOps is a generic print gateway for sending print jobs from an external
integration program to printers on a local network.

It does not connect directly to HIS or any clinical/business system. The
external integration program is responsible for reading from that system,
building a print request, and calling the PrintOps API.

## What Is In This Repo

- `apps/api` - Fastify REST API for jobs, printers, runners, auth, audit logs, and exports.
- `apps/web` - Vite + React dashboard for operators.
- `apps/runner` - Local runner process that registers with the API, polls jobs, sends heartbeats, and syncs printer discovery.
- `apps/desktop` - Tauri shell that loads the web UI.
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
- Optional for the desktop app: Rust and Tauri CLI
- Optional for future persistence work: Docker, PostgreSQL, and Redis
- Optional for printer discovery:
  - macOS/Linux: `lpstat`
  - Windows: PowerShell `Get-Printer`

The required Node and npm versions are declared in `package.json`.

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

Runner defaults from `apps/runner/src/config.ts`:

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

Web development config from `apps/web/vite.config.ts`:

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

Run API, web, and runner together:

```bash
npm run dev
```

Or run each app in a separate terminal:

```bash
npm run dev -w apps/api
npm run dev -w apps/web
npm run dev -w apps/runner
```

Local URLs:

| Service | URL |
| --- | --- |
| Web dashboard | `http://localhost:3000` |
| API | `http://localhost:3001` |
| Runner | No browser UI. It connects to the API. |

Desktop shell:

```bash
npm run tauri:dev -w apps/desktop
```

The desktop app expects the web dev server to be running at
`http://localhost:3000`.

### Test, Typecheck, And Build

```bash
npm test
npm run build
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
| `Register attempt 1 failed` from runner | Confirm the API is running on `http://localhost:3001` or set `API_URL`. |
| Web dashboard API calls fail | Confirm `npm run dev -w apps/api` is running. The web dev server proxies `/api` to port `3001`. |
| Runner logs in unexpectedly | `RUNNER_API_TOKEN` is empty, so the runner uses the dev login flow. |
| No printers appear in discovery | Use `DISCOVERY_ADAPTER=fake npm run dev -w apps/runner` for local fake discovery. On Windows, confirm Print Spooler and `Get-Printer`; on macOS/Linux, confirm `lpstat`. |
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
- Current runner execution delegates job execution through API code; local runner-side adapter execution is listed as future work in `docs/status/next-steps.md`.
- Docker Compose references Dockerfiles that are not present in this repo.
- Production service account creation, key rotation, and deployment steps are TBD / ต้องยืนยัน.

## More Documentation

- `docs/operations/local-dev.md`
- `docs/status/current-status.md`
- `docs/status/next-steps.md`
- `docs/architecture/overview.md`
- `docs/architecture/external-print-api.md`
- `docs/architecture/mvp-nippon-flow.md`
- `docs/guides/local-macos-dev.md`
- `docs/guides/local-windows-runner.md`
