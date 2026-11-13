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
