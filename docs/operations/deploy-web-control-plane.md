# Deploy Web Control Plane with Docker Compose

This stack runs the Web Control UI, its production API, and the JetStream NATS service used by connected PrintOps clients. Choose local disk or optional MinIO/S3 storage for release artifacts with `PRINTOPS_RELEASE_STORAGE_PROVIDER`. SQLite, device identity, release artifacts, and NATS data use persistent Docker volumes. It does not run a local print runner.

## Network and security requirements

- Give the server a stable private-network or VPN address reachable by every enrolled PrintOps client. Set `PRINTOPS_CONTROL_NATS_BIND_ADDRESS` to that address and set `PRINTOPS_CONTROL_PUBLIC_NATS_URL` to the matching `nats://<address>:<port>` URL.
- The included NATS service is not configured with TLS or authentication. **Do not expose TCP 4222 to the public Internet.** Restrict it at the host firewall to trusted client/VPN networks. Public-network NATS requires a separately secured NATS endpoint and corresponding client configuration.
- The web port binds to `127.0.0.1:8080` by default. Put it behind a TLS-enabled reverse proxy; do not expose the dashboard over plain HTTP on an untrusted network.
- The optional MinIO service starts only when the `minio` Compose profile is active. Its S3 and console ports are not published on the host; only containers on the private Compose network can reach it.
- `PRINTOPS_DEV_SEED=false` disables the default demo accounts. Use the first-owner setup flow when opening the UI for the first time.

## Configure and start

Run these commands from the repository root on a Linux server with Docker Compose v2:

```sh
cp infra/docker/control-plane.env.example infra/docker/control-plane.env
openssl rand -hex 32
```

Set the generated value in `PRINTOPS_CONTROL_JWT_SECRET`.

### Choose release artifact storage

`PRINTOPS_RELEASE_STORAGE_PROVIDER` defaults to `minio`, honoring the bundled object-storage deployment. Set it to `local` to store release files in the API volume instead:

- `minio`: the included MinIO service starts automatically from the matching Compose profile. Set `PRINTOPS_MINIO_SECRET_KEY` to a second, unique value generated with another `openssl rand -hex 32` call; never reuse the JWT secret. `PRINTOPS_MINIO_ACCESS_KEY` defaults to `printops-control`. The API uses endpoint `minio:9000` and bucket `printops-releases`; the bucket is created on first connection/upload.
- `local`: release files are written under `/data/releases` in the persistent `control_api_data` volume. No MinIO credentials or service are needed.

The environment selector controls which bundled Compose profile starts and seeds the API's storage settings on first startup. After settings are stored in SQLite, the provider saved through Web Control takes precedence; changing the env value alone will not change the API's provider.

For an existing local install moving to bundled MinIO, set `PRINTOPS_RELEASE_STORAGE_PROVIDER=minio` and the MinIO credentials, redeploy to start the profile, then select MinIO in Web Control with endpoint `minio`, port `9000`, bucket `printops-releases`, and matching credentials. Test the connection and save. To return to local, select and save `local` in Web Control first. If no existing release needs MinIO, set the env selector to `local` and run `docker compose --env-file infra/docker/control-plane.env --profile minio stop minio` (or stop the service in Portainer); this preserves the MinIO volume.

Changing providers does not move existing release files. Local files remain in `control_api_data`; MinIO objects remain in `control_minio_data`. Keep the original storage available for releases already stored there.

### Storage Settings fields

Web Control's **Storage Settings** dialog exposes these options:

| Setting | Options / input | Meaning |
| --- | --- | --- |
| Provider | `Local` or `MinIO / S3` | Chooses where new release files are stored. It does not migrate existing files. |
| Local path | Container filesystem path; default `/data/releases` | Used only for `Local`. The standard Docker stacks persist this path in `control_api_data`. |
| MinIO endpoint and port | Hostname and port; bundled service uses `minio:9000` | Use `minio` for the bundled Compose service, or the hostname/IP of an external MinIO/S3-compatible service. |
| Use SSL / HTTPS | On or off; bundled service uses off | Enable when the configured object-storage endpoint uses TLS. |
| Bucket | Bucket name; default `printops-releases` | The API creates a missing bucket when testing the connection or uploading the first artifact. |
| Key prefix | Optional path prefix inside the bucket | Empty stores objects at the bucket root. |
| Access key and secret key | Credentials for the configured object-storage service | Required when using MinIO/S3. For bundled MinIO, use the values from `PRINTOPS_MINIO_ACCESS_KEY` and `PRINTOPS_MINIO_SECRET_KEY`. |
| Public URL / CDN | Optional URL | Currently saved as a setting but not used by release uploads or downloads; leave blank. |

### Configure the client network

Set the private/VPN address and port in `PRINTOPS_CONTROL_NATS_BIND_ADDRESS` and `PRINTOPS_CONTROL_PUBLIC_NATS_URL`; for example, for a server at `10.20.0.5`:

```dotenv
PRINTOPS_CONTROL_PUBLIC_NATS_URL=nats://10.20.0.5:4222
PRINTOPS_CONTROL_NATS_BIND_ADDRESS=10.20.0.5
```

Ensure the address is assigned to the server. Permit TCP 4222 only from the trusted client/VPN subnet, and configure the reverse proxy to forward to `http://127.0.0.1:8080`.

### Connect a PrintOps station

A station does not need any control-plane setting on the machine: it learns the
broker address and stream from the control plane during enrollment.

1. Install and start the PrintOps desktop app once, so it creates an unenrolled
   local identity.
2. In Web Control, open **Devices**, choose **Generate One-Time Enrollment
   Token**, and copy the token. The dialog also shows the control plane address
   to enter on the station.
3. On the station, open **Settings → Web Control Connection**, enter that
   control plane address and the token, then choose **Connect**. The desktop app
   exchanges the token for per-device credentials, records the `natsUrl` and
   JetStream `stream` the control plane issued in its local
   `device-identity.json`, and restarts its bundled API server so the control
   agent starts from that identity. The app refuses to enroll again while it
   already holds device credentials; generate a new token to move a station.
4. The connection indicator turns green once the control plane receives the
   first heartbeat. Allow up to a minute while the local server restarts.

No machine-wide `PRINTOPS_CONTROL_*` variable is required on client
workstations. An explicit `PRINTOPS_CONTROL_NATS_URL`/`PRINTOPS_CONTROL_NATS_STREAM`
pair overrides the enrolled endpoints; a half-set pair is refused rather than
completed with a broker from another control plane.

Clients must be able to reach the address advertised by
`PRINTOPS_CONTROL_PUBLIC_NATS_URL`: enrollment hands clients that exact URL, so
a Docker-internal hostname is not reachable from a workstation.

### Deployment environment reference

| Variable | Values / default | Purpose |
| --- | --- | --- |
| `PRINTOPS_CONTROL_JWT_SECRET` | Required; unique random value | Signs Web Control authentication tokens. |
| `PRINTOPS_RELEASE_STORAGE_PROVIDER` | `minio` or `local`; default `minio` | Selects the initial release-file provider and bundled Compose profile. |
| `COMPOSE_PROFILES` | `minio` or `local` | Derived from the provider in the copied env file; set to the same value in Portainer. |
| `PRINTOPS_MINIO_ACCESS_KEY` | `printops-control` by default; MinIO only | MinIO root access key. |
| `PRINTOPS_MINIO_SECRET_KEY` | Required for MinIO | MinIO root secret; generate a unique value separate from the JWT secret. |
| `PRINTOPS_CONTROL_PUBLIC_NATS_URL` | Required; `nats://<private-address>:<port>` | URL clients use to reach NATS. |
| `PRINTOPS_CONTROL_NATS_STREAM` | `PRINTOPS_CONTROL` | JetStream stream issued to clients at enrollment; must match the stream the control agent uses. |
| `PRINTOPS_CONTROL_NATS_BIND_ADDRESS` | Required; private/VPN server address | Host interface for the NATS port binding. |
| `PRINTOPS_CONTROL_NATS_PORT` | `4222` | Published NATS port. |
| `PRINTOPS_WEB_BIND_ADDRESS` | `127.0.0.1` | Host interface for the web port; keep loopback behind a reverse proxy. |
| `PRINTOPS_WEB_PORT` | `8080` | Published web port. |
| `PRINTOPS_CONTROL_PLANE_VERSION` | `1.0.0` | Control Plane image tag/version; independent of the PrintOps app version. |
| `PRINTOPS_IMAGE_PREFIX` | Optional for source builds; required by registry stack | Registry/repository prefix for API and Web images. |
| `PRINTOPS_API_UPSTREAM` | `api:3001` | API service DNS name and port reachable by the web container; override when its Docker network alias differs. |
| `PRINTOPS_RELEASE_IMPORT_MAX_MIB` | Positive whole number; default `128` | Maximum Base64 JSON import request size in MiB, shared by API and Web. |

Validate and start the stack:

```sh
docker compose --env-file infra/docker/control-plane.env \
  -f infra/docker/docker-compose.control-plane.yml config --quiet

docker compose --env-file infra/docker/control-plane.env \
  -f infra/docker/docker-compose.control-plane.yml up -d --build
```

The dashboard is available through the reverse proxy. The API health endpoint, reachable through the web proxy, is `http://127.0.0.1:8080/api/health`.

### Release installer import size

`POST /api/v1/control/releases/import` reads `PRINTOPS_RELEASE_IMPORT_MAX_MIB`
at container startup in both the Web Nginx proxy and API. The default is `128`
MiB for the entire JSON request, not the original installer file. Set a positive
whole number without a unit suffix; zero (unlimited) is not supported.

For example, configure this stack variable in Portainer or the env file:

```dotenv
PRINTOPS_RELEASE_IMPORT_MAX_MIB=256
```

Both bundled stacks pass the same value to API and Web. If managing the services
separately, set it on **both** containers. Redeploy/recreate both services after
changing the value; no image rebuild is needed for subsequent size changes.

Base64 adds about one third to the file size. With a `256` MiB request limit,
keep the installer below 192 MiB to leave room for JSON metadata (below 96 MiB
with the default `128`). Other API routes retain their existing size limits.

If an external reverse proxy fronts the Web container, allow at least the same
request size on this import endpoint there too (for the `256` example, Nginx:
`client_max_body_size 256m;`). A proxy with a smaller limit can still return 413
before the request reaches the API. Raising this limit also increases potential
memory use because the API decodes the Base64 installer in memory.

For the initial rollout of env-configurable limits, rebuild and publish **both
API and Web images**, then redeploy with the new image tag. Existing images with
fixed limits do not gain this behavior by changing environment variables alone.

## Build and push images

Run from the repository root on a machine with Docker Buildx. Authenticate to the registry first:

```sh
docker login ghcr.io
PRINTOPS_IMAGE_PREFIX=ghcr.io/my-org/printops-control-plane \
PRINTOPS_CONTROL_PLANE_VERSION=1.0.0 \
node scripts/publish-control-plane-images.mjs
```

The version comes from `PRINTOPS_CONTROL_PLANE_VERSION` and is used for both image tags and the Web Control UI version badge; it is independent of PrintOps desktop/app versioning. The platform defaults to `linux/amd64`; set `PRINTOPS_BUILD_PLATFORMS=linux/arm64` when targeting an ARM64 server.

For a registry deployment, set `PRINTOPS_IMAGE_PREFIX` and `PRINTOPS_CONTROL_PLANE_VERSION` in `infra/docker/control-plane.env`. Configure credentials for the registry on the server; Portainer needs the registry credentials saved in its registry settings.

`infra/docker/docker-compose.control-plane.stack.yml` is registry-only: it has no build contexts and targets Docker Compose v2 or Portainer Standalone. In Portainer, create a Standalone stack from this file. Set `PRINTOPS_IMAGE_PREFIX` and `PRINTOPS_CONTROL_PLANE_VERSION`, then set `PRINTOPS_RELEASE_STORAGE_PROVIDER` and `COMPOSE_PROFILES` to matching values (`local` or `minio`). Enter the MinIO credentials only for `minio`. This file is not intended for `docker stack deploy` (Swarm).

For CLI deployment:

```sh
docker compose --env-file infra/docker/control-plane.env \
  -f infra/docker/docker-compose.control-plane.stack.yml config --quiet
docker compose --env-file infra/docker/control-plane.env \
  -f infra/docker/docker-compose.control-plane.stack.yml pull
docker compose --env-file infra/docker/control-plane.env \
  -f infra/docker/docker-compose.control-plane.stack.yml up -d
```

Use `docker-compose.control-plane.yml` for local source builds. `docker-compose.control-plane.stack.yml` uses registry images only and has no build contexts.

## Update and persistence

- For a registry update, set `PRINTOPS_CONTROL_PLANE_VERSION` to the new Control Plane release version, then run `pull` and `up -d` with `docker-compose.control-plane.stack.yml` and the same environment file. For a source build, pull the desired source revision and run `up -d --build` with `docker-compose.control-plane.yml`.
- `control_api_data` stores SQLite, device identity, and local release files; `control_minio_data` stores MinIO release objects; `control_nats_data` stores JetStream data. Back up all three volumes. `docker compose down` preserves them; **do not use `down -v` unless intentionally deleting all control-plane data**.
