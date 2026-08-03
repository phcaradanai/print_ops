# Local Development

## Prerequisites

- Node.js >= 20
- npm >= 10
- Docker (optional, for Postgres + Redis)

## Quick Start

```bash
# Install all workspace dependencies
npm install

# Run all three apps in parallel
npm run dev
```

| App | URL |
|-----|-----|
| Web UI | http://localhost:3000 |
| API | http://localhost:3001 |
| Runner | connects to API automatically |

## Individual Apps

```bash
npm run dev -w apps/api
npm run dev -w apps/web
cd apps/runner-go && go run ./cmd/printops-runner run   # the only runner
```

## Tests

```bash
# All workspaces
npm test

# Single workspace
npm test -w apps/api
```

## Build

```bash
npm run build
```

## Environment Variables

### apps/api
```
PORT=3001
HOST=0.0.0.0
JWT_SECRET=dev-secret-change-in-production
```

### apps/runner-go
```
PRINTOPS_API_BASE_URL=http://localhost:3001
PRINTOPS_RUNNER_TOKEN=<jwt from login>
PRINTOPS_RUNNER_NAME=runner-local
PRINTOPS_DISCOVERY_MODE=auto
PRINTOPS_POLL_INTERVAL_MS=750
PRINTOPS_HEARTBEAT_INTERVAL_MS=15000
```

## Default Admin Account (dev seed only)

Seeding is off unless `PRINTOPS_DEV_SEED=true`, and passwords are really
verified (salted scrypt) — the old "any password is accepted" behaviour is gone.

```
email:    admin@printerops.local
password: Dev-password1!
```

Other seeded accounts share that password: `sysadmin@` (OWNER), `admin@`
(ADMIN), `user@` (OPERATOR), `viewer@` (VIEWER).

A packaged install seeds nothing: the first run creates the OWNER account
through the bootstrap screen instead.
