# Web Control 1.0.16

Published for `linux/amd64` from `8e1326e` (2026-11-18), with the `1.0.16` version
defaults in the accompanying release commit.

- **Web Control**: the Incoming Jobs column picker now also offers the incoming
  payload keys as list columns (up to three, in click order), and the two cinema
  controls sit in one framed group so they read as a set that does not change the
  page's own list. No API contract change.
- **API**: rebuilt for version parity; its source is unchanged since 1.0.13.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.16` | `sha256:3e092af538fa7d036d321eff6c87091923e4e28f01fd295206d415917bd1dae4` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.16` | `sha256:784ff231822615d9eb260c045dbbc285d333678500bc902291674553c61b112f` |

`docker buildx imagetools inspect` returns those digests. The web image was also
checked from the inside: the entry bundle carries the `1.0.16` version and the
`Incoming values` copy, the Web Control stylesheet carries `wcj-cinema-group`, and
the asset names (`index-BCLNwA8D.js`, `WebControlJobs-CpfsI10-.js`,
`WebControlJobs-dPj5RzKX.css`) match a local Control build with
`VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.16`. So the tag contains the
pushed source.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.16`; the PrintOps app image stays
`0.1.50`. These are Web Control UI features - no station update, database
migration, or configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.16"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.15

Published for `linux/amd64` from `8c67b34` (2026-11-18), with the `1.0.15` version
defaults in the accompanying release commit.

- **Web Control**: the Incoming Jobs page can now decide what its rows show.
  A **Columns** picker toggles Destination, Station, Received, Copies, Template,
  Source, Runner and Error code (Job, Status and Actions stay fixed; the choice is
  a workstation preference), and the cinema board's **Display data** picker puts
  up to three incoming payload values on each row instead of a bare job
  reference. No API contract change.
- **API**: rebuilt for version parity; its source is unchanged since 1.0.13.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.15` | `sha256:a5f3ce4844fcce2937aebffcafcdc54391030835b7653ffc3dfda1fe4f57ceab` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.15` | `sha256:76312e510726c33e89d21ec2994a5ab43924abc832e3d376674219d3e309669a` |

`docker buildx imagetools inspect` returns those digests. The web image was also
checked from the inside: the entry bundle carries the `1.0.15` version and the
`Data shown in cinema mode` copy, the Web Control stylesheet carries
`cinema-feed-label`, and the asset names (`index-DbhieNrJ.js`,
`WebControlJobs-CpCV3e4F.js`, `WebControlJobs-DCChtXJ7.css`) match a local Control
build with `VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.15`. So the tag
contains the pushed source.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.15`; the PrintOps app image stays
`0.1.50`. These are Web Control UI features - no station update, database
migration, or configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.15"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.14

Published for `linux/amd64` from `0167ea2` (2026-11-18), with the `1.0.14` version
defaults in the accompanying release commit.

- **Web Control**: Incoming Jobs gains **cinema mode** - a fullscreen wall board
  with live totals, a 30-minute inflow ladder, station health, the newest jobs and
  a ticker. Entry is the station-bar button or `?cinema=1`; exit is any key, a tap
  that did not drag, or leaving fullscreen. The board also ticks at the feed
  cadence instead of every second, and its timers pause while the tab is hidden.
  No API contract change.
- **API**: rebuilt for version parity; its source is unchanged since 1.0.13
  (retention and control routes are identical).

The tag was rebuilt once: the first publish was `65fa810`, then the board-tick
change landed immediately after and the same version was rebuilt from `0167ea2`
so the deployed tag matches the pushed source. No deployment had been recorded
against the earlier digest.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.14` | `sha256:5db22af3686c99e7934829ab4c001a454b5699620689f7fa97d381fbd74872e2` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.14` | `sha256:d81d6bc5e5adb2e2face6dee8aae0ae27b21e5eb60411f01fa3b4e2f76446ca8` |

`docker buildx imagetools inspect` returns those digests. The web image was also
checked from the inside: `/usr/share/nginx/html` carries `Cinema board` in the
entry bundle and `cinema-kpi` in the Web Control stylesheet, and its asset names
(`index-DkVByf_t.js`, `WebControlJobs-DDqyaGaG.js`) match a local Control build of
`0167ea2` made with `VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.14`. So
the tag really does contain the pushed source.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.14`; the PrintOps app image stays
`0.1.50`. Cinema mode is a Web Control UI feature - no station update, database
migration, or configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.14"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.13 / PrintOps App 0.1.50

Published for `linux/amd64` from commit `6b000a1` (2026-11-18).

- **App**: the API carries Web Control retention for `control_device_jobs`
  (per-station cap), `control_audit_logs` retention and archive expiry; the
  normal operator web bundle is unchanged. The Incoming Jobs pagination and
  redesign are in the Web Control web bundle.
- **Web Control**: API retention + Web UI (pagination, four-question Incoming
  Jobs layout, bilingual copy).

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-app:0.1.50` | `sha256:9da005725de3ab45330f979fc0add1b4beef8ec3fe49a85dd3afd0241395d5b2` |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.13` | `sha256:935395686473587c76c8c4f259b3d6fa0539f5da11a68d1833dc5cb7a36488a9` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.13` | `sha256:356bc80b921363ab4ddf7f87bbbb0ebb1027f0928c189931d3181dc81d8ed09e` |

`node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.50`
passed: health/version, SPA/assets/deep links, owner/login, SQLite persistence,
runner binary, single API worker.

Windows desktop installers, built with `npm run desktop:bundle`; release
verification passed and the OTA manifest is
`artifacts/prod-01/ota-manifest.json`:

| Installer | Size | SHA-256 |
| --- | --- | --- |
| `PrintOps_0.1.50_x64_en-US.msi` | 48,615,424 B | `20379fee5ab1d02fa9a511136a5468f9111a7c2c7233e704bffa5d280e6c68d6` |
| `PrintOps_0.1.50_x64-setup.exe` (NSIS) | 37,435,965 B | `ccbba4bd32ae7efe25a98e1096783c862c15906890659e5d4548dcaf3838559b` |

Deploy with `PRINTOPS_APP_VERSION=0.1.50` and
`PRINTOPS_CONTROL_PLANE_VERSION=1.0.13`. Both images include the retention
changes; update stations if the station-local `control_device_jobs` mirror must
also be pruned.

# Web Control 1.0.12

Published for `linux/amd64` with `node scripts/publish-control-plane-images.mjs`
(`PRINTOPS_IMAGE_PREFIX=registry.pg.xenex.io/printops-control-plane`,
`PRINTOPS_CONTROL_PLANE_VERSION=1.0.12`, `VITE_CONTROL_PLANE_VERSION=1.0.12`).

Fixes permanent OTA schema version alignment:
- `POST /api/v1/control/releases/import` derives `schemaVersion` / `minSupportedVersion` from `signedManifest` when provided and defaults to `CURRENT_SCHEMA_VERSION` instead of `8`.
- `ReleaseCatalogService.isCompatible()` rejects releases whose `schemaVersion < device.schemaVersion` so incompatible releases cannot be targeted.
- `WebControlReleases.tsx` exposes `Schema Version` and optional `ota-manifest.json` import in Import App, plus `Schema Version` editing in Manage Release.
- `GET /api/v1/control/releases/defaults` supplies `CURRENT_SCHEMA_VERSION` to the UI.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.12` | `sha256:a09cacfa45c28147e495b5cc6d6fb72a50bd36d319414101e5049dfd4a877fe8` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.12` | `sha256:a328dad22cd783b698ad6c5559816302069dcda49e0f04f9e49ee4c14b49ff54` |

# Web App PrintOps 0.1.49

Image: `registry.pg.xenex.io/printops-app:0.1.49` (`linux/amd64`).

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-app:0.1.49` | `sha256:77e004a666e2dcefaf1c6d7fead2f4d87902b561c28c62d2c8c86967e56c8c51` |

`node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.49` passed: health/version, SPA/assets/deep links, owner/login, SQLite persistence, runner binary, single API worker.

Windows desktop installers, built with `npm run desktop:bundle` (`apps/desktop/src-tauri/build.rs` reads `CURRENT_SCHEMA_VERSION=11` directly from `sqlite.schema.ts`; OTA manifest written to `artifacts/prod-01/ota-manifest.json` with `compatibility.schema_version: 11`):

| Installer | Size | SHA-256 |
| --- | --- | --- |
| `PrintOps_0.1.49_x64_en-US.msi` | 48,603,136 B | `7a516a64dbdfafb65373903791b9bb4ee8c65df876bae5ce1b0fc1cb5f47e9d7` |
| `PrintOps_0.1.49_x64-setup.exe` (NSIS) | 37,432,819 B | `4c4b7c9b1993361e960c7ccd727fafbe4815236731c7ae119b67d47163897aaa` |

# Web Control 1.0.11

Published for `linux/amd64` with local `docker buildx build --load` and
`docker push` from the working tree on top of `5ec1a57`. Both images contain the
incoming-jobs fix (job mirror sweep, per-station pull credential, `host:port`
discovery, `control_device_jobs` identity check) and the `apps/web/nginx.conf`
change that resolves the API upstream per request. The Web image is built with
`VITE_CONTROL_PLANE_VERSION=1.0.11`.

This release also fixes the empty Web Control shell (empty/legacy `allowedPages`,
missing catch-all route, `currentVersion` vs `appVersion`), hardens
`/control/local-jobs`, and adds runner terminate/delete with the "at least one
runner must remain" rule.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.11` | `sha256:d29c468094aef9550b46d2681bee8cf66249038ec4548defa532c1a4275dc8a8` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.11` | `sha256:46d8f1d3e9452e391ee94d0b23cf087a00b6da1496ae2634ae78d2907dc24b4a` |

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.11"
node scripts/publish-control-plane-images.mjs   # builds and pushes
```

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.11` and
`PRINTOPS_APP_VERSION=0.1.48` in the server env file; both sides must move together
because the station is what sends `recentJobs` and reports its job-mirror port.

# Web App PrintOps 0.1.48

Image: `registry.pg.xenex.io/printops-app:0.1.48` (`linux/amd64`).

Must be deployed together with Web Control 1.0.11: the station side is what attaches
`recentJobs` to its heartbeat (the only job-history path that crosses NAT), reports
`address:port` so the control plane pulls from the right port, and enforces the new
job-mirror credential.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-app:0.1.48` | `sha256:3fd20eb98588ed86e4dddf12bbdbdecafb4cf1c933488b1c4d3c7fa025bdf77c` |

`scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.48` passed: health/version,
SPA assets and deep links, owner setup/login, SQLite persistence across container
recreation, runner binary, single API worker.

Windows desktop installers, built with `npm run desktop:bundle` (release verification
passed; OTA manifest written to `artifacts/prod-01/ota-manifest.json`):

| Installer | Size | SHA-256 |
| --- | --- | --- |
| `PrintOps_0.1.48_x64_en-US.msi` | 48,603,136 B | `9dc12fbb6a3556da2203113664b72cfbd671708bbea44b55a9e0e5fe0b194dc6` |
| `PrintOps_0.1.48_x64-setup.exe` (NSIS) | 37,425,468 B | `37c425711d45b878b6a06353049e01d93eec2b95ed5fa1376b48fcea61495303` |

```sh
docker buildx build --platform linux/amd64 --load \
  -f infra/docker/Dockerfile.app \
  --build-arg APP_VERSION=0.1.48 \
  --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" \
  -t registry.pg.xenex.io/printops-app:0.1.48 .
node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.48
docker push registry.pg.xenex.io/printops-app:0.1.48
```

The Windows desktop installers are built from the same source with
`npm run desktop:bundle` and carry the same fixes.

# Web Control 1.0.8

Published for `linux/amd64` with local `docker build` and `docker push`.
The API and Web images use the source from commit `4d9aca0`, with
`VITE_CONTROL_PLANE_VERSION=1.0.8` for the Web image.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.8` | `sha256:3008aea81311bdf3960e6d28208b7ff2a66b05eb485ebe26df37e334c907edca` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.8` | `sha256:431b91737f714a27bcaa3281cb2d72634204f4374841245cee58e1c21519ce8e` |

# Web Control 1.0.6

Published for `linux/amd64` from app release `0.1.45`, commit
`35ede634860ede45030cbffed1964ff0e56049be`.

[Successful GitHub Actions publish](https://github.com/phcaradanai/print_ops/actions/runs/43359859445)

| Image | Published digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.6` | `sha256:4f9c610efa415c3c495fe9b1007e6bf71ce1710be6be4cded862341040c45659` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.6` | `sha256:d129f2dbdf1e75bab30433f024db5377850b5220d8c678ab38fd84bdbf3270a1` |

Previous: 1.0.5 (app `0.1.39`, commit `128d744`), api
`sha256:a1273c0ec0ea9240b323916c9f3cf3fb5ce101ea9822115bf2918e372feb5034`, web
`sha256:959cf03281105e98e88ec9129bbb0d78c724e9fe42e53ba2192ada8d990df273`.

Manual publish from a Docker build host:

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.6"
node scripts/publish-control-plane-images.mjs
```


# Web App PrintOps 0.1.45

Image: `registry.pg.xenex.io/printops-app:0.1.45` (`linux/amd64`).

Status: published. Registry digest
`sha256:c8056eecce1f55cf2de3ff607cdc08b43d5dda66228b2030a47f5e678be40bf8`.

Build source: `35ede634860ede45030cbffed1964ff0e56049be` on `main`. Built and
pushed from a local Docker Desktop host (not the GitHub workflow).

Verification: `scripts/smoke-app-image.mjs` passed (health/version, SPA
assets/deep links, owner setup/login, SQLite persistence after recreation,
runner binary, single API worker). The workflow-only checks (full test suite,
Compose validation, Chromium Thai-label rendering via `smoke-cups-render.mjs`)
were not run for this publish.

This image packages the normal PrintOps operator application (not Web Control),
the API, and an optional Linux Go runner. App versions are synchronized at
`0.1.45`; Web Control is `1.0.6`. The Windows desktop installers for `0.1.45`
were built from the same commit and passed `release:verify`.

## Linux printing flow

The normal operator UI and API run on Linux. The API is the sole print worker:
`template + paper profile -> existing HTML renderer -> Chromium PDF -> CUPS queue
+ Linux printer driver -> network printer`. Native ZPL/TSPL/EPL/DPL/PCL payloads
can be submitted explicitly as raw jobs through a configured CUPS queue.

- Template/profile geometry, rotation, flips and calibration use the existing
  rendering helpers. The HTML PDF uses the label face size, excluding feed gap.
- Chromium, Thai-capable Noto fonts, and CUPS client tools are included.
- Configure printer drivers and queues once on the Linux server; clients use the
  browser and need no PrintOps executable or printer driver.
- `PRINTOPS_LOCAL_WORKER=true`; the Go runner is included but is not started and
  its job loop defaults to disabled. Do not start a second worker for this queue.
- A CUPS job receipt is **UNVERIFIED**, not physical delivery proof. Submission
  errors after an attempt are also UNVERIFIED; no automatic submission retry.
- This is a general driver-based integration, **not a guarantee that every
  printer supports driverless PDF**. Each queue needs a compatible Linux driver
  or a compatible native command language. A Windows driver cannot run here.
- First physical acceptance target: POSTEK G2000 with the existing sticker
  template/profile. The vendor manual documents PPLE/PPLZ; do not assume TSPL.
  A compatible Linux CUPS driver/configuration and a physical output check are
  still required. No G2000 hardware was available in the build environment.

## Deploy the application UI/API

Install and start CUPS on the Linux host, then install the compatible printer
driver and create its network queue (for example `POSTEK_G2000`). Verify that
`lpstat -p POSTEK_G2000` sees it and `/run/cups/cups.sock` exists. The Compose file
mounts that socket into the app and refuses to create a directory in its place.
CUPS drivers/filters are installed on the host, not in the application image.
Do not create a raw queue for HTML/PDF and expect the printer to interpret PDF.
Use a dedicated printer queue (not a class with automatic failover), and disable
CUPS job replay on backend errors during host setup:

```sh
sudo lpadmin -p POSTEK_G2000 -o printer-error-policy=abort-job
```

The application does not retry submissions; this host policy also prevents CUPS
from being configured to retry a partially delivered job. See the
[OpenPrinting error-policy reference](https://openprinting.github.io/cups/doc/admin.html).
Never manually restart a submitted job until its physical outcome is checked.

Register the configured queue via authenticated `POST /api/printers`, for example:

```json
{
  "code": "POSTEK_G2000",
  "name": "Postek G2000",
  "protocol": "cups",
  "connectionUri": "cups://POSTEK_G2000",
  "metadata": {},
  "isActive": true
}
```

Import/reuse the existing templates and profiles, then bind them to this printer.
Existing Windows `spooler://...` bindings must be changed to the new CUPS printer;
copying a Windows database alone does not migrate its driver or bindings.
During cutover, stop the old client executors before switching intake or
restoring a copy of their queue on the server.

Use the registry-only stack file `infra/docker/docker-compose.app.stack.yml`
(Docker Compose v2 or Portainer Standalone; not `docker stack deploy`/Swarm).
It pulls `registry.pg.xenex.io/printops-app:0.1.45`, binds the CUPS socket,
keeps data in the named volume `app_data`, and adds a healthcheck and log
rotation.

Copy the stack file and `infra/docker/app.env.example` to the Linux server, save
the env file as `/etc/printops/printops-app.env` (`chmod 600`), and set
`PRINTOPS_APP_JWT_SECRET` to the output of `openssl rand -hex 32`. Then:

```sh
docker compose --env-file /etc/printops/printops-app.env -f docker-compose.app.stack.yml config --quiet
docker compose --env-file /etc/printops/printops-app.env -f docker-compose.app.stack.yml pull
docker compose --env-file /etc/printops/printops-app.env -f docker-compose.app.stack.yml up -d
curl -fsS http://127.0.0.1:8081/api/health   # expect "version":"0.1.45"
```

In Portainer, create a Standalone stack from the file and enter the same
variables. To upgrade later, change `PRINTOPS_APP_VERSION` and run `pull` and
`up -d` again. Never use `down -v`; it deletes `app_data`.

Put the loopback listener behind the existing HTTPS reverse proxy. On first
access, complete owner setup. Retain and back up the `app_data` volume across
upgrades. It is separate from Web Control storage.
`infra/docker/docker-compose.app.yml` remains equivalent for plain Compose use.

## Build and publish

The `Publish PrintOps App image` GitHub Actions workflow tests the Go runner,
builds the Linux image, smoke-tests health/version, SPA assets and deep links,
owner setup/login and SQLite persistence across container recreation, validates
Compose and real Chromium rendering of a 60×30 mm Thai label, then pushes the
verified version tag. No physical printer is contacted.

Manual equivalent on a Docker build host, from the repository root:

```sh
docker buildx build --platform linux/amd64 --load \
  -f infra/docker/Dockerfile.app \
  --build-arg APP_VERSION=0.1.45 \
  --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" \
  -t registry.pg.xenex.io/printops-app:0.1.45 .
node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.45
docker push registry.pg.xenex.io/printops-app:0.1.45
docker buildx imagetools inspect registry.pg.xenex.io/printops-app:0.1.45
```
