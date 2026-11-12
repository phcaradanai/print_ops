# Web Control 1.0.5

Published for `linux/amd64` from app release `0.1.39`, commit
`128d74461e4d6aa3f3c4995c63d9cd64267451ea`.

[Successful GitHub Actions publish](https://github.com/phcaradanai/print_ops/actions/runs/42981313244)

| Image | Published digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.5` | `sha256:a1273c0ec0ea9240b323916c9f3cf3fb5ce101ea9822115bf2918e372feb5034` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.5` | `sha256:959cf03281105e98e88ec9129bbb0d78c724e9fe42e53ba2192ada8d990df273` |

Manual publish from a Docker build host:

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.5"
node scripts/publish-control-plane-images.mjs
```


# Web App PrintOps 0.1.44

Target: `registry.pg.xenex.io/printops-app:0.1.44` (`linux/amd64`).

Status: build/publish verification pending. Digest and Actions run will be
recorded after the registry confirms the push.

This image packages the normal PrintOps operator application (not Web Control),
the API, and an optional Linux Go runner. App versions are synchronized at
`0.1.44`; Web Control remains `1.0.5`.

## Scope and printing acceptance

- The default container runs the API and serves the built operator SPA on port
  `3001`; no client `.exe` is needed to open the UI.
- SQLite, releases, and device identity persist under `/data`.
- Demo seeding and the Windows API local worker are disabled.
- The Go runner binary is included as `/usr/local/bin/printops-runner`, but is
  **not started** by the supplied Compose deployment. Job execution defaults to
  disabled. This release packages the Linux application; it does not certify a
  new Linux printing backend.
- Physical Linux printing acceptance is pending the printer model and document
  format. CUPS/IPP adapters remain unimplemented; Windows spooler/WebView2 jobs
  cannot be printed by this Linux image. The existing Go raw TCP backend is a
  candidate for compatible native label commands, not general HTML/PDF printing.
- The existing runner has fake fallback/discovery behavior and reports TCP write
  completion as success without physical confirmation. Do not enable it for a
  production print queue before those behaviors and real-printer acceptance are
  addressed. There is no claim of physical printing verification in this release.

## Deploy the application UI/API

Copy `infra/docker/docker-compose.app.yml` to the Linux server. Generate a unique
JWT secret with `openssl rand -hex 32`, save it in a protected env file:

```dotenv
PRINTOPS_APP_VERSION=0.1.44
PRINTOPS_APP_JWT_SECRET=<generated secret>
PRINTOPS_APP_BIND_ADDRESS=127.0.0.1
PRINTOPS_APP_PORT=8081
```

```sh
docker compose --env-file /path/to/printops-app.env -f infra/docker/docker-compose.app.yml pull
docker compose --env-file /path/to/printops-app.env -f infra/docker/docker-compose.app.yml up -d
```

Put the loopback listener behind the existing HTTPS reverse proxy. On first
access, complete owner setup. The Compose stack uses a named volume `app_data`;
retain and back it up across upgrades. It is separate from Web Control storage.

## Build and publish

The `Publish PrintOps App image` GitHub Actions workflow tests the Go runner,
builds the Linux image, smoke-tests health/version, SPA assets and deep links,
owner setup/login and SQLite persistence across container recreation, validates
Compose, then pushes the verified version tag. No physical printer is contacted.

Manual equivalent on a Docker build host, from the repository root:

```sh
docker buildx build --platform linux/amd64 --load \
  -f infra/docker/Dockerfile.app \
  --build-arg APP_VERSION=0.1.44 \
  --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" \
  -t registry.pg.xenex.io/printops-app:0.1.44 .
node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.44
docker push registry.pg.xenex.io/printops-app:0.1.44
docker buildx imagetools inspect registry.pg.xenex.io/printops-app:0.1.44
```
