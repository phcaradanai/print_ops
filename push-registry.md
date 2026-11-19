# PrintOps App 0.1.55

Published for `linux/amd64` from `e4db5cb` (2026-11-19). Current app release; it
supersedes 0.1.54 (`sha256:2accdd94…`, the runner CUPS guard) and 0.1.53.

- **A runner can no longer report a print it never made**: the Go runner
  accepted `PRINTOPS_EXECUTOR_MODE=cups` although it has no CUPS executor and
  used the fake executor as its dispatcher fallback, so a `cups://` job was
  recorded SUCCESS with "fake print completed" while nothing printed. The
  fallback now refuses unknown protocols, and a job-executing runner configured
  with `cups` refuses to start with an explanatory message. Fake printing still
  works for printers declared with the `fake` protocol. A discovery-only runner
  (`PRINTOPS_JOBS_ENABLED=false`, the station's normal CUPS setup) still starts.
- **One runner card and one copy of each discovered printer**: registration
  matched on `name + hostname`, and a Docker runner's hostname is its container
  id, so every restart/redeploy created another runner record and another copy
  of every discovered printer. The runner name is now the logical identity
  (hostname is updated on re-registration), the runner list shows one card per
  name, and reconciliation deletes discovery rows held by a duplicate record of
  a name that has a newer record.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-app:0.1.55` | `sha256:1b388d08228fc8d8b318ccb0dec0b091431accfc60018235fc906035bf4dcd49` |
| `registry.pg.xenex.io/printops-app:0.1.54` (superseded) | `sha256:2accdd94d7de88c9698ef719f1770abae5be01cf1161ff458ad863227ef7d157` |

Verified:
- `node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.55` →
  PASS, and the same image's runner refuses `cups` + jobs enabled with exit 1
  ("PRINTOPS_EXECUTOR_MODE=cups has no runner implementation…").
- `npm run release:verify` → `version:consistency: 0.1.55 across
  root/API/web/desktop/Cargo/Tauri` (no desktop installer was built for 0.1.55;
  the run stops at `ota:secret` in this shell).
- Unit tests: API 779 passed / 1 skipped (runner identity, shadowed-record
  cleanup in both storage modes and in the SQL sweep), Go runner suites pass
  including the new `executor_guard_test.go`.
- Deployed to the station: `/api/health` reports `0.1.55`; `/api/runners` shows a
  single card for `printops-runner-vm1` with the recreated container hostname;
  `/api/v1/discovered-printers` shows 3 rows and 0 stale — the duplicate rows
  left by earlier restarts were pruned at boot.

# PrintOps App 0.1.53

Published for `linux/amd64` from `e37c5bd` (2026-11-19), with the `0.1.53` version
defaults in the accompanying release commit. 0.1.52 (`sha256:35d036d0…`, built
from `d6b7694`) was an intermediate build of the CUPS provisioning work that was
never deployed; treat 0.1.53 as the current app release.

- **Zero-command CUPS provisioning**: the Printers page discovers an IPP printer
  over IPPS, creates the CUPS queue with the driverless IPP Everywhere PPD,
  resumes and accepts it, and registers it as `cups://<queue>`. A CUPS
  administrator account is stored once (`data/cups-admin.json`, 0600, with
  `CUPS_ADMIN_USER`/`CUPS_ADMIN_PASSWORD` as fallback). New routes:
  `POST /api/printers/cups-scan`, `POST /api/printers/cups-queues`,
  `GET|PUT|DELETE /api/printers/cups-admin`.
- **CUPS verification no longer reports a completed print as UNVERIFIED**: device
  records are correlated by physical job, the output rule accepts
  `job-impressions-completed` or `job-media-sheets-completed`, and the polling
  window is honoured instead of returning after one read. The submission is
  never repeated.
- **NATS settings in the server build**: `GET|PUT /api/v1/print-flow/nats-settings`
  persist `data/nats-settings.json` and apply at runtime through
  `NatsConnectionManager.applyConfig()`; the Settings panel is available whenever
  the local API answers, not only inside the desktop shell. A saved file wins
  over `PRINTOPS_NATS_*` at boot so "disabled" survives a restart.
- **Discovery cleanup**: deleting a runner removes its discovered printers,
  boot and retention reconcile rows whose runner no longer exists
  (`discoveredPrintersDeleted`), and a re-registered runner collapses duplicates
  instead of adding a second copy of the same printer.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-app:0.1.53` | `sha256:b8d533619a5e27debac9e662cd4ba3ed623d430629e183d0d3ceb2ee5cffe6a9` |
| `registry.pg.xenex.io/printops-app:0.1.52` (superseded) | `sha256:35d036d03493a932a8bea24a739af8d4c6d4cd8558d6f9701dcffc3b6fe7479e` |

Verified:
- `node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.53` →
  PASS (health/version, SPA/assets/deep links, owner/login, SQLite persistence,
  runner binary, single API worker).
- `npm run release:verify` → `version:consistency: 0.1.53 across
  root/API/web/desktop/Cargo/Tauri` (the run stops at `ota:secret` because this
  shell has no `PRINTOPS_OTA_SECRET`; no desktop installer was built for 0.1.53).
- Unit tests: API 774 passed / 1 skipped, web 824, adapters 156, domain 10.
- Playwright: 152 passed against the dashboard bundle.
- Deployed to the station and re-checked live on 0.1.53: `GET
  /api/v1/print-flow/nats-settings` → `{enabled:false, source:"default"}`,
  `nats-status` → `DISABLED`, `GET /api/printers/cups-queues` →
  `[{name:"epsonL6580", registered:true, deviceUri:"ipp://192.168.10.11/ipp/print"}]`,
  and `/api/v1/discovered-printers` now holds 4 rows with 0 whose runner no
  longer exists.

Known gaps in this release:
- The Go runner has **no** CUPS executor: `PRINTOPS_EXECUTOR_MODE=cups` is
  accepted but resolves to the fake executor, which reports SUCCESS without
  printing (`apps/runner-go/cmd/printops-runner/main.go`,
  `internal/printer/multi/multi.go:107-114`). Keep `PRINTOPS_JOBS_ENABLED=false`
  on the runner for CUPS stations until that is implemented.
- Network-scan discovery rows (`TCP <ip>:9100`) carry no `computerName`, so the
  global-view dedupe falls back to the runner id for them; a station that is
  re-registered will show that scan row again until the next reconcile.
- The Epson keeps only the two most recent completed IPP jobs, so verification
  evidence must be read inside that window.

# PrintOps App 0.1.51

Published for `linux/amd64` from `2566162` (2026-11-18), with the `0.1.51` version
defaults in the accompanying release commit.

This is the app-side release for the work that landed since 0.1.50. The Job Queue
fixes and the CUPS/IPP work live in the **app** image (they are dashboard and
station features), which is why the control-plane tags 1.0.17-1.0.25 could not
show them.

- **Job Queue layout (reported)**: the key-filter row now insets `0.75rem 1rem`
  like the search row above it instead of sitting flush against the card edge, its
  fields and buttons share one line at 1440 and 1024 instead of the buttons
  dropping below when the four-column grid collapsed, and the freshness refresh
  button matches the page-action height so every header row reads as one line.
- **CUPS/IPP printers**: remote CUPS server setting (`PRINTOPS_CUPS_SERVER`), queue
  listing and remote queue submission with device delivery confirmation, wired
  into the Printers page with bilingual copy.
- **Confirmed outcomes**: the API stores `reviewed_outcome` (`PRINTED` /
  `NOT_PRINTED`) beside the review acknowledgement, exposed through
  `POST /control/devices/:id/jobs/:jobId/review`.
- **Search and list**: the Incoming Jobs list search explains which field matched,
  incoming keys match whole terms, up to eight incoming columns and eight cinema
  values, and the technical-details fields can be left out of the search.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-app:0.1.51` | `sha256:6ded41ea68c990dac61c076eab7380b3101fef543840ab7e41faf2e685dc3b9d` |

Verified:

- `node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.51` -
  health/version, SPA/assets/deep links, owner/login, SQLite persistence, runner
  binary, single API worker: **PASS**.
- real Linux label rendering inside the image (real Chromium, Thai text, 60x30 mm
  pages, manual/generated profile margins, no extra pages, one submission per job,
  UNVERIFIED): **PASS**.
  Run it the way CI does, with a byte-preserving redirect:
  `cmd /c "docker run --rm -i --entrypoint node <image> --input-type=module < scripts\smoke-cups-render.mjs"`.
  Piping the script through PowerShell mangles its Thai literal and produces a
  false failure.
- `docker compose -f infra/docker/docker-compose.app.yml config --quiet` with
  `PRINTOPS_APP_JWT_SECRET` set: **PASS**.
- image contents: `PRINTOPS_APP_VERSION=0.1.51`, `JobQueue-*.css` carries
  `job-queue-keyfilters`, `apps/api/dist` carries `reviewed_outcome` and
  `infra/cups-server-settings.js`, and both the API and the Printers bundle carry
  `printers/cups-queues`.

Deploy with `PRINTOPS_APP_VERSION=0.1.51` and
`PRINTOPS_CONTROL_PLANE_VERSION=1.0.25`.

Windows desktop installers, built with `npm run desktop:bundle` on a Windows x64
host; release verification (including resource freshness and the zero-byte scan of
81 files) passed and the OTA manifest is `artifacts/prod-01/ota-manifest.json`
(`applicationVersion 0.1.51`):

| Installer | Size | SHA-256 |
| --- | --- | --- |
| `PrintOps_0.1.51_x64_en-US.msi` | 48,660,480 B | `359048ffbc96df9fcbb964ef86da295e3189d9762896c4cf9ede36b592eb3807` |
| `PrintOps_0.1.51_x64-setup.exe` (NSIS) | 37,478,832 B | `2be7eae61771f58308d26680f81d9334f7af8f0c39f0c87f0906236d72e08f28` |

The first attempt failed preflight with
`version:consistency {"root":"0.1.51", ..., "cargo":"0.1.50"}`: the Rust crate
version in `apps/desktop/src-tauri/Cargo.toml` (and its `Cargo.lock` entry) has to
move with `package.json`, `tauri.conf.json` and the workspace packages. Fixed in
`5463941`; preflight now reports `version:consistency: 0.1.51 across
root/API/web/desktop/Cargo/Tauri`.

```powershell
docker buildx build --platform linux/amd64 --load `
  --file infra/docker/Dockerfile.app `
  --build-arg APP_VERSION=0.1.51 `
  --build-arg SOURCE_REVISION=$(git rev-parse --short HEAD) `
  --tag registry.pg.xenex.io/printops-app:0.1.51 .
node scripts/smoke-app-image.mjs registry.pg.xenex.io/printops-app:0.1.51
docker push registry.pg.xenex.io/printops-app:0.1.51
```

# Web Control 1.0.25

Published for `linux/amd64` from `c6cab54` (2026-11-18), with the `1.0.25` version
defaults in the accompanying release commit. This is the first tag that carries
both the confirmed-outcome work and the finished CUPS/IPP work.

- **Web Control**: an UNVERIFIED outcome can be confirmed as *it printed* / *it did
  not print* (`reviewed_outcome`, additive column). The row shows the move
  (`UNVERIFIED → it printed`) instead of relabelling the job, the "unconfirmed"
  warning stops once an outcome is recorded, and undo clears both. Two new
  filters: **Exact status** (any single server status) and **Confirmed outcome**,
  both applied to the base set and both removable as conditions.
- **Job Queue**: fixed the reported layout - the key-filter row now insets
  `0.75rem 1rem` like the search row above it (it was flush against the card edge),
  its fields and buttons share one line at 1440 and 1024 instead of the buttons
  dropping below when the four-column grid collapsed, and the freshness refresh
  button matches the page-action height so every header row reads as one line.
- **Printers / API**: the finished CUPS/IPP work - remote CUPS server setting
  (`PRINTOPS_CUPS_SERVER`), queue listing and remote queue submission with device
  delivery confirmation, wired into the Printers page with bilingual copy.
- **API**: `POST /control/devices/:id/jobs/:jobId/review` accepts an optional
  `outcome` (`PRINTED` / `NOT_PRINTED`), audits it, and reads it back in the fleet
  payload.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.25` | `sha256:efa0492b8c70ffefdb8277dea46ccc48ede7ec0f8f4b51df36d3baaa6e090995` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.25` | `sha256:d0c9ec02ecb7b209dd0eaa0af843b307f6c16a6427d9c7d9ee9acaf0b8d29ede` |

`docker buildx imagetools inspect` returns those digests. Checked from the inside:
the web entry bundle carries `1.0.25`, the queue stylesheet carries
`job-queue-keyfilters`, its 63 asset names match a local Control build with
`VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.25` exactly, and the API
image carries `reviewed_outcome` (registry service) and
`infra/cups-server-settings.js`.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.25`; the PrintOps app image stays
`0.1.50`. The control-plane mirrors a station's jobs, so the CUPS work only reaches
a station when the app image is rebuilt - it ships here because both halves are
built from the same source tree.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.25"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.24

Published for `linux/amd64` from `eae831a` (2026-11-18), with the `1.0.24` version
defaults in the accompanying release commit.

- **Web Control**: the fields the drawer keeps under "Technical details" (internal
  job id, source reference, error code and message, raw snapshot) can now be left
  out of the search. They stay searchable by default - that is how support finds a
  job from a log line - and a checkbox in the advanced panel, **Search technical
  details too**, turns them off for the session. While it is off it behaves like
  any other condition: a removable **Technical details excluded** chip, and Clear
  all restores it. The filter and the "Matched: ..." row explanation read the same
  tagged candidate list, so they drop those fields together.
- **API**: rebuilt for version parity; its source is unchanged since 1.0.18.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.24` | `sha256:6c1be1135446ff93a0162a8f821793e1d861055193f75de9a357ab27b7dcaa57` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.24` | `sha256:ad54f3b3dd449997a8113ebeff3bc67c12f3c6ff12db40c8eb3999ced1e9f4fc` |

`docker buildx imagetools inspect` returns those digests. The web image was checked
from the inside: the entry bundle carries `1.0.24` and the `Search technical
details too` copy, and its 63 asset names match a local Control build with
`VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.24` exactly.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.24`; the PrintOps app image stays
`0.1.50`. Search scope only - no station update, database migration, or
configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.24"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.23

Published for `linux/amd64` from `09ded34` (2026-11-18), with the `1.0.23` version
defaults in the accompanying release commit.

- **Web Control**: the caps that rationed screen space are gone. A cinema row
  carries up to **eight** incoming values (was three) and the list allows up to
  **eight** incoming columns (was three); each cinema value is its own span, so
  they share the row's width equally and truncate individually with the full value
  in the row title. "Show job reference" no longer depends on having chosen values,
  so the ID can be dropped on the cinema board as well as in the list (only Status
  and Actions are fixed there).
- **Layout fix found while testing it**: with four values the feed header's
  unbreakable key list pushed a 390px board sideways; `.cinema-card-meta` now
  shrinks and `.cinema-feed-fields` clips with an ellipsis.
- **API**: rebuilt for version parity; its source is unchanged since 1.0.18.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.23` | `sha256:323f4966231988054d2fcaf36916de4f3140e3214ee4bc801f12fbc4d4d11609` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.23` | `sha256:724480bd3d1c6bc52eaa494b48b765120456bdd1cf90936ee5d7feacea7e2400` |

`docker buildx imagetools inspect` returns those digests. The web image was checked
from the inside: the entry bundle carries `1.0.23`, the page chunk carries
`cinema-feed-value`, and its 63 asset names match a local Control build with
`VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.23` exactly.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.23`; the PrintOps app image stays
`0.1.50`. Presentation limits only - no station update, database migration, or
configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.23"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.22

Published for `linux/amd64` from `7116b3e` (2026-11-18), with the `1.0.22` version
defaults in the accompanying release commit.

- **Web Control fix (reported bug)**: searching a short word returned rows that
  appeared to have nothing to do with it. The filter was matching fields the table
  does not show - `ab` is inside the template code `PATIENT_LABEL`, and `do` was
  also matching payload keys such as `dob`. Two changes: an incoming key now has
  to match the whole term (`dob` finds those jobs, `do` does not), and any row
  whose match is not visible on it names the field that matched
  (`Matched: Template · PATIENT_LABEL`) with a one-line count above the list.
  Turning the relevant column on removes the explanation, because the row shows
  the value itself then.
- **API**: rebuilt for version parity; its source is unchanged since 1.0.18.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.22` | `sha256:07892809bc9b485a59e36f3cb11edaec1cc531dc0a7a2850c89fd4902dc3e699` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.22` | `sha256:1afc17b71f1f6978b8d9f6cc76b00a4b702bb1b943fe7a989881720751435ccd` |

`docker buildx imagetools inspect` returns those digests. The web image was checked
from the inside: the entry bundle carries `1.0.22` and the new `Matched: ` copy, and
its 63 asset names match a local Control build with
`VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.22` exactly.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.22`; the PrintOps app image stays
`0.1.50`. Search logic and one row hint only - no station update, database
migration, or configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.22"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.21

Published for `linux/amd64` from `5e243ea` (2026-11-18), with the `1.0.21` version
defaults in the accompanying release commit.

- **Web Control**: the Incoming Jobs page was split into `SelectionBar`,
  `JobDetailDrawer` and `JobTable` under `features/control-jobs/` (2,631 -> 2,117
  lines), with no behaviour change: the batch bar still measures itself, the drawer
  still owns its copy feedback, and the table still becomes record cards below
  768px. The three copies of `{name}` interpolation collapsed into
  `lib/formatMessage.ts`, and `copyTextToClipboard` into `lib/clipboard.ts`.
- **API**: image slimming only. The build stage now drops `dist/tests`, every
  `.d.ts` and every `.map`, so the image carries the JavaScript the server
  executes and nothing else. Runtime source is unchanged since 1.0.17.
- **Release tooling**: the publish workflow is `workflow_dispatch` only (it no
  longer republishes a default tag when its own file changes), takes the version
  with no default, and refuses to publish a tag that already exists.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.21` | `sha256:9b162390da254da46d7e9c45b94e31c9bcded3649a2fc0a6a138efe6aecbe962` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.21` | `sha256:d444caafb27f8d00abb1d64f5c6e3d2f1a46b09c1daf815601227d1371db2830` |

`docker buildx imagetools inspect` returns those digests. Checked from the inside:
the web entry bundle carries `1.0.21` and its 63 asset names match a local Control
build with `VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.21` exactly; the
API image's `apps/api/dist` holds only `.js` files - zero `.d.ts`, zero `.map`, no
`tests/`.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.21`; the PrintOps app image stays
`0.1.50`. No station update, database migration, or configuration change is
involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.21"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.20

Published for `linux/amd64` from `0b6f44d` (2026-11-18), with the `1.0.20` version
defaults in the accompanying release commit.

- **Web Control**: **Reviewed only** and **Needs review** are mutually exclusive.
  The two filters are disjoint by definition - a reviewed row is never waiting for
  a human - so having both on could only ever produce an empty list. Turning the
  reviewed view on now drops the triage filter, and picking Needs review leaves the
  reviewed view.
- **API**: rebuilt for version parity; its source is unchanged since 1.0.18.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.20` | `sha256:a9ed20234d52efed08c0be1a0967775b413362abff59f73ee4fee22ca864bf2d` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.20` | `sha256:dc514d5e15e0d141715cb9835a0c3afa0e14d72cf592e024da30f54851422ace` |

`docker buildx imagetools inspect` returns those digests. The web image was checked
from the inside: the entry bundle carries `1.0.20`, and its 62 asset names match a
local Control build with
`VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.20` exactly.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.20`; the PrintOps app image stays
`0.1.50`. Filter logic only - no station update, database migration, or
configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.20"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.19

Published for `linux/amd64` from `390b5d5` (2026-11-18), with the `1.0.19` version
defaults in the accompanying release commit.

- **Web Control**: one layout fix, on the screen where it hurt. The pinned
  selection bar carries up to four actions (clear, mark, undo, reprint); at 390px
  they wrap to four lines, so the bar measured 146px against a fixed 72px spacer
  and covered the pagination and the last rows. The spacer now takes the measured
  bar height (`ResizeObserver`, 4.5rem fallback for first paint), so the list ends
  where the bar begins on every width.
- **API**: rebuilt for version parity; its source is unchanged since 1.0.18 (which
  dropped the compiled tests from the image).

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.19` | `sha256:420f8c9593d745eca558cd529b33cf35f1cdc3d7325944cfef5bf218b8bfbb30` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.19` | `sha256:10c7eeb2f2157de725aad47f7d58bc8041de33aea417575baf59b39b7c80d4ea` |

`docker buildx imagetools inspect` returns those digests. The web image was checked
from the inside: the entry bundle carries `1.0.19`, the `Reviewed only` copy and
`wcj-selection-spacer`, and its 62 asset names match a local Control build with
`VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.19` exactly.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.19`; the PrintOps app image stays
`0.1.50`. CSS/layout only - no station update, database migration, or
configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.19"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.18

Published for `linux/amd64` from `343fad3` (2026-11-18), with the `1.0.18` version
defaults in the accompanying release commit.

- **Web Control**: the acknowledgement now works from both sides. The reviewed
  filter moved out of the "filter by status" toolbar - acknowledgements cut across
  the buckets - and sits with sort/search as **Reviewed only (N)**; the pinned
  selection bar offers **Undo review (N)** for selected rows that already carry the
  mark, so a mis-clicked batch no longer has to be repaired one drawer at a time;
  and the reviewed-only view clears itself when the scope has no acknowledgements
  left instead of filtering invisibly behind a hidden chip.
- **Cinema**: Tab, the arrow keys, Home/End/PageUp/PageDown and a bare
  Shift/Ctrl/Alt/Meta no longer close the board. They are the keys a screen reader
  uses to read the summary, and the board used to close on the first arrow press.
  Escape, any click and every other key still exit, so "press anything to get out"
  holds for a person at the wall.
- **API**: rebuilt for version parity with one image change - the build stage now
  drops `apps/api/dist/tests`, so no compiled test code ships to the server. Its
  runtime source is unchanged since 1.0.17.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.18` | `sha256:5c75edb4f89c46d2d5a37a500863e362341cbda6c4219ece48cffbe29c1c4050` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.18` | `sha256:0ac34edb937aa73c7bc28e31bbededf1d5cecd2832e7d789776404084bb0a776` |

`docker buildx imagetools inspect` returns those digests. The web image was also
checked from the inside: the entry bundle carries the `1.0.18` version and the
`Reviewed only` / `Undo review` copy, and its 62 asset names match a local Control
build with `VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.18` exactly. The
API image's `dist/tests` directory is absent and `dist/services/` is intact.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.18`; the PrintOps app image stays
`0.1.50`. Web Control UI changes only - no station update, database migration, or
configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.18"
node scripts/publish-control-plane-images.mjs
```

# Web Control 1.0.17

Published for `linux/amd64` from `9aa6b5f` (2026-11-18), with the `1.0.17` version
defaults in the accompanying release commit.

- **Web Control**: the Incoming Jobs page can now find what was acknowledged
  (a **Reviewed (N)** chip), clear a batch in one go (**Mark N as reviewed** in the
  pinned selection bar), and choose which panels the cinema board carries
  (throughput chart, station list, ticker - stored in the URL as `cinemaPanels`).
  A **Reset widths** button appears once a column has been dragged, and changing
  the sort order returns to page 1.
- **Cinema fix**: the board now honours the acknowledgement, so an outcome an
  operator already checked leaves the Needs review tile, the throughput stack, its
  station's review count and its row tone, exactly as the list does. Before this,
  the wall and the list disagreed about the same jobs.
- **API**: `POST /control/devices/:id/jobs/:jobId/review` now writes a
  `control/audit` record (`job.reviewed` / `job.unreviewed`) with the actor, the
  job id and the job's status. The acknowledgement columns (`reviewed_at`,
  `reviewed_by`) are additive and created with `ensureColumn`, so an existing
  control-plane database needs no migration and no configuration change.

| Image | Verified registry digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.17` | `sha256:8b3aaf548279215d0e0a6327fe49742526cee915fd87bf527c3bcdf6249eb311` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.17` | `sha256:5fca77bd2b433556987eedfe0362baddf6bf2553b90660bf5b894b8f5624738c` |

`docker buildx imagetools inspect` returns those digests. The web image was also
checked from the inside: the entry bundle carries the `1.0.17` version, the
`Mark {count} as reviewed` and `Throughput chart` copy, and the page chunk carries
`cinemaPanels`; the API image's
`dist/services/web-control-registry.service.js` carries `job.unreviewed`. Its 62
asset names match a local Control build with
`VITE_CONTROL_APP=true VITE_CONTROL_PLANE_VERSION=1.0.17` exactly, so the tag
contains the pushed source.

Deploy with `PRINTOPS_CONTROL_PLANE_VERSION=1.0.17`; the PrintOps app image stays
`0.1.50`. This is a Web Control UI release plus one API-side audit write - no
station update, database migration, or configuration change is involved.

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.17"
node scripts/publish-control-plane-images.mjs
```

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

PrintOps manages the CUPS queues of a station itself, the same way it manages
the Windows spooler on a Windows station, so a fresh Linux station needs no
host-side `lpadmin` step:

1. Start CUPS on the station. The app Compose files mount
   `/run/cups/cups.sock`; the server stack sets `CUPS_SERVER=cups:631` for its
   bundled `printops-cups` service.
2. Open **Printers → Add CUPS printer**. Keep the default socket (or enter the
   CUPS address), then save the CUPS administrator account once if CUPS
   demands one. `CUPS_ADMIN_USER`/`CUPS_ADMIN_PASSWORD` are an environment
   alternative; otherwise the account is stored in `data/cups-admin.json`
   (mode 0600) on the station only.
3. Use **Find a printer and add it to CUPS**: enter the printer IP, a range or
   a CIDR, press **Search**, then **Create queue**. PrintOps reads the device
   over IPP, creates the queue with the driverless IPP Everywhere PPD, resumes
   and accepts the destination, and registers the printer as
   `cups://<queue>`. A stopped queue or a missing `cups-filters` package is
   reported as a warning on the same dialog.

A printer with no IPP endpoint (raw 9100 only, or USB without a CUPS backend)
still needs a vendor PPD that PrintOps cannot choose for the operator; the
manual path below remains supported for those devices.

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
