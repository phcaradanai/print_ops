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
npm run dev -w apps/runner
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

### apps/runner
```
API_URL=http://localhost:3001
RUNNER_API_TOKEN=<jwt from login>
RUNNER_NAME=runner-local
SUPPORTED_PROTOCOLS=fake,ipp,cups
POLL_INTERVAL_MS=2000
HEARTBEAT_INTERVAL_MS=10000
```

## Default Admin Account (MVP seed)

```
email: admin@printerops.local
password: (any, no password check in MVP)
```
