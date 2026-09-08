# OTA Architecture Contracts

Date: 2026-09-08 · Phase: OTA-00 · Status: DRAFT FOR APPROVAL

This document defines the contracts, state machines, and interfaces for the PrintOps OTA system. Implementation may not proceed until the Lead approves these contracts.

---

## 1. Version Model

### 1.1 Application Version

Single release train version shared by Desktop/API/Web/Runner:

```
<major>.<minor>.<patch>[-<pre-release>]
```

Example: `0.1.28`, `1.0.0-rc.1`

- Desktop, API, Web: version in `package.json`, `tauri.conf.json`, `Cargo.toml` (must match)
- Runner: version injected via Go ldflags at build time (`-X main.Version=...`)
- Pre-release tags (`-rc.1`, `-beta`) are NOT auto-updated; only stable releases auto-update

### 1.2 Content Version

Content (Paper Profiles, Templates) versioned independently:

```
profiles-<N>
templates-<N>
```

Where `<N>` is a monotonically increasing integer per content type.

Content manifests reference application version compatibility:

```json
{
  "content_type": "profiles",
  "version": 18,
  "min_app_version": "0.1.25",
  "max_app_version": "1.0.0",
  "items": [...]
}
```

### 1.3 Compatibility Rules

- Application update: new app version must be >= current version (no downgrade)
- Content update: content manifest specifies `min_app_version` and `max_app_version`; reject if app version outside range
- Schema migration: app version specifies `schema_version`; content manifest may specify required `schema_version`; reject if incompatible

---

## 2. Manifest Schema

### 2.1 Release Manifest (Application OTA)

File: `manifest.json` in release artifact directory

```json
{
  "schema_version": 1,
  "release": {
    "version": "0.1.29",
    "channel": "stable",
    "release_date": "2026-09-08T10:00:00Z",
    "notes": "Bug fixes and performance improvements"
  },
  "artifacts": {
    "desktop": {
      "windows-x64": {
        "url": "desktop-0.1.29.exe",
        "sha256": "abc123...",
        "signature": "base64-ed25519-signature",
        "size": 123456789
      }
    },
    "runner": {
      "windows-x64": {
        "url": "runner-0.1.29.exe",
        "sha256": "def456...",
        "signature": "base64-ed25519-signature",
        "size": 23456789
      }
    },
    "api": {
      "node-bundle": {
        "url": "api-0.1.29.tar.gz",
        "sha256": "ghi789...",
        "signature": "base64-ed25519-signature",
        "size": 34567890
      }
    }
  },
  "compatibility": {
    "min_supported_version": "0.1.20",
    "schema_version": 6
  },
  "rollout": {
    "staged": false,
    "rollout_percentage": 100
  }
}
```

### 2.2 Content Manifest (Content OTA)

File: `profiles-manifest.json` or `templates-manifest.json`

```json
{
  "schema_version": 1,
  "content_type": "profiles",
  "version": 18,
  "release_date": "2026-09-08T10:00:00Z",
  "compatibility": {
    "min_app_version": "0.1.25",
    "max_app_version": "1.0.0",
    "required_schema_version": 6
  },
  "items": [
    {
      "id": "profile-001",
      "code": "A4_LABEL",
      "action": "upsert",
      "sha256": "jkl012...",
      "signature": "base64-ed25519-signature",
      "size": 1234
    }
  ],
  "rollout": {
    "staged": false,
    "rollout_percentage": 100
  }
}
```

Actions:
- `upsert`: insert or update (if exists and ownership is MANAGED)
- `delete`: remove (if ownership is MANAGED)
- `ignore`: skip (no change)

### 2.3 Manifest Verification

- All manifests signed with Ed25519 private key (release signing key)
- Signature covers entire manifest JSON (canonical form, sorted keys)
- Client verifies signature using embedded public key before processing
- SHA-256 checksums verify individual artifacts

---

## 3. Update State Machine (Application OTA)

### 3.1 States

```
IDLE
  ↓ (check for update)
CHECKING
  ↓ (update available)
UPDATE_AVAILABLE
  ↓ (user approves or auto-update)
DOWNLOADING
  ↓ (download complete)
DOWNLOADED
  ↓ (verify checksum + signature)
VERIFIED
  ↓ (wait for queue idle)
WAITING_FOR_IDLE
  ↓ (queue idle)
INSTALLING
  ↓ (install complete)
INSTALLING_COMPLETE
  ↓ (health check)
HEALTH_CHECK
  ↓ (health check passes)
COMPLETED
  ↓ (restart required)
RESTART_PENDING

Failure paths:
CHECKING → CHECK_FAILED
DOWNLOADING → DOWNLOAD_FAILED
VERIFIED → VERIFY_FAILED
INSTALLING → INSTALL_FAILED → ROLLING_BACK → ROLLED_BACK
HEALTH_CHECK → HEALTH_CHECK_FAILED → ROLLING_BACK → ROLLED_BACK
```

### 3.2 State Transitions

| From | To | Trigger | Guard |
|---|---|---|---|
| IDLE | CHECKING | manual check or scheduled check | — |
| CHECKING | UPDATE_AVAILABLE | manifest indicates newer version | version > current, version >= min_supported |
| CHECKING | IDLE | no update available | — |
| CHECKING | CHECK_FAILED | network error, invalid manifest | — |
| UPDATE_AVAILABLE | DOWNLOADING | user approval or auto-update policy | — |
| DOWNLOADING | DOWNLOADED | download complete | file size matches manifest |
| DOWNLOADING | DOWNLOAD_FAILED | network error, disk full | — |
| DOWNLOADED | VERIFIED | checksum + signature valid | sha256 matches, signature valid |
| DOWNLOADED | VERIFY_FAILED | checksum mismatch, invalid signature | — |
| VERIFIED | WAITING_FOR_IDLE | install initiated | — |
| WAITING_FOR_IDLE | INSTALLING | queue idle (size=0, inflight=0, scheduler.settled) | — |
| INSTALLING | INSTALLING_COMPLETE | files staged, process restarted | — |
| INSTALLING | INSTALL_FAILED | file write error, process restart error | — |
| INSTALLING_COMPLETE | HEALTH_CHECK | install complete | — |
| HEALTH_CHECK | COMPLETED | /health returns 200, /system/readiness READY | — |
| HEALTH_CHECK | HEALTH_CHECK_FAILED | health check timeout or failure | — |
| COMPLETED | RESTART_PENDING | user notification | — |
| INSTALL_FAILED | ROLLING_BACK | automatic | — |
| HEALTH_CHECK_FAILED | ROLLING_BACK | automatic | — |
| ROLLING_BACK | ROLLED_BACK | previous version restored | — |
| ROLLED_BACK | IDLE | rollback complete | — |

### 3.3 Persistence

State persisted to SQLite table `ota_update_state`:

```sql
CREATE TABLE ota_update_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL,
  target_version TEXT,
  started_at TEXT,
  updated_at TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0
);
```

---

## 4. Content Sync State Machine (Content OTA)

### 4.1 States

```
IDLE
  ↓ (check for content update)
CHECKING
  ↓ (update available)
UPDATE_AVAILABLE
  ↓ (sync initiated)
DOWNLOADING
  ↓ (download complete)
DOWNLOADED
  ↓ (verify checksum + signature)
VERIFIED
  ↓ (validate content)
VALIDATING
  ↓ (validation passes)
APPLYING
  ↓ (transactional apply)
APPLIED
  ↓ (activate new version)
ACTIVATED
```

### 4.2 Ownership Model

Each content item (profile, template) has an `ownership` column:

- `MANAGED`: centrally controlled, can be updated/deleted by OTA
- `LOCAL`: local-only, never overwritten by OTA
- `FORKED`: derived from managed content but locally modified; OTA creates new version with suffix (e.g., `A4_LABEL_v19`) instead of overwriting

Ownership determined by:
- Initial import via OTA: `MANAGED`
- User creates locally: `LOCAL`
- User edits MANAGED content: becomes `FORKED`

### 4.3 Sync Logic

For each item in content manifest:

1. If item does not exist locally: insert with `ownership = MANAGED`
2. If item exists and `ownership = MANAGED`: update
3. If item exists and `ownership = LOCAL`: skip (log warning)
4. If item exists and `ownership = FORKED`: create new item with suffix, leave forked version unchanged

All changes applied in a single transaction; rollback on any failure.

---

## 5. Distribution & Source Resolution

### 5.1 Source Priority

```
1. LAN Relay (if configured and reachable)
2. WAN CDN (if reachable)
3. Offline (use cached artifacts)
```

### 5.2 LAN Relay

Static file server hosting release artifacts. Configuration:

```env
PRINTOPS_OTA_LAN_RELAY_URL=http://192.168.1.100:8080/ota
```

Resolver:
1. Try LAN relay with 5s timeout
2. If unreachable or 404, try WAN
3. If WAN unreachable, use cached artifacts (if available)

### 5.3 Caching

Downloaded artifacts cached in app data directory:

```
<app-data>/ota/cache/<version>/<artifact>
```

Cache persists across restarts; used for offline operation and rollback.

---

## 6. Rollback Model

### 6.1 Application Rollback

- Previous version kept in staging directory: `<app-data>/ota/staging/previous/`
- On install failure or health check failure: restore previous version from staging
- Rollback = swap files back + restart process
- Rollback itself can fail (disk error, file lock) → manual intervention required

### 6.2 Content Rollback

- Content history table tracks all applied versions:

```sql
CREATE TABLE content_history (
  id INTEGER PRIMARY KEY,
  content_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  manifest_json TEXT NOT NULL
);
```

- Rollback = re-apply previous manifest (reverse operations)
- Content rollback does not require app restart (hot reload where safe)

---

## 7. Interfaces & Contracts

### 7.1 Update Agent Service (API)

```typescript
interface OtaUpdateServicePort {
  checkForUpdate(): Promise<UpdateCheckResult>;
  downloadUpdate(version: string): Promise<void>;
  verifyUpdate(version: string): Promise<boolean>;
  installUpdate(version: string): Promise<void>;
  rollbackUpdate(): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
}

interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  channel: string;
}

interface UpdateState {
  state: UpdateStateEnum;
  targetVersion?: string;
  progress?: number;
  error?: string;
  startedAt?: string;
  updatedAt?: string;
}

enum UpdateStateEnum {
  IDLE = 'IDLE',
  CHECKING = 'CHECKING',
  UPDATE_AVAILABLE = 'UPDATE_AVAILABLE',
  DOWNLOADING = 'DOWNLOADING',
  DOWNLOADED = 'DOWNLOADED',
  VERIFIED = 'VERIFIED',
  WAITING_FOR_IDLE = 'WAITING_FOR_IDLE',
  INSTALLING = 'INSTALLING',
  INSTALLING_COMPLETE = 'INSTALLING_COMPLETE',
  HEALTH_CHECK = 'HEALTH_CHECK',
  COMPLETED = 'COMPLETED',
  RESTART_PENDING = 'RESTART_PENDING',
  CHECK_FAILED = 'CHECK_FAILED',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  VERIFY_FAILED = 'VERIFY_FAILED',
  INSTALL_FAILED = 'INSTALL_FAILED',
  ROLLING_BACK = 'ROLLING_BACK',
  ROLLED_BACK = 'ROLLED_BACK',
  HEALTH_CHECK_FAILED = 'HEALTH_CHECK_FAILED'
}
```

### 7.2 Content Sync Service (API)

```typescript
interface ContentSyncServicePort {
  checkForContentUpdates(): Promise<ContentUpdateCheckResult>;
  syncContent(contentType: 'profiles' | 'templates'): Promise<void>;
  rollbackContent(contentType: 'profiles' | 'templates', version: number): Promise<void>;
  getContentState(contentType: 'profiles' | 'templates'): Promise<ContentState>;
}

interface ContentUpdateCheckResult {
  profilesUpdateAvailable: boolean;
  templatesUpdateAvailable: boolean;
  currentProfilesVersion: number;
  latestProfilesVersion?: number;
  currentTemplatesVersion: number;
  latestTemplatesVersion?: number;
}

interface ContentState {
  profilesVersion: number;
  templatesVersion: number;
  lastSyncAt?: string;
}
```

### 7.3 Distribution Resolver

```typescript
interface DistributionResolverPort {
  resolveArtifact(artifactPath: string): Promise<string>;
  // Returns URL (LAN or WAN) or local cache path
}
```

### 7.4 API Routes

```
GET  /api/v1/ota/status                    → UpdateState
POST /api/v1/ota/check                     → UpdateCheckResult
POST /api/v1/ota/download                  → void
POST /api/v1/ota/install                   → void
POST /api/v1/ota/rollback                  → void

GET  /api/v1/ota/content/status            → ContentState
POST /api/v1/ota/content/check             → ContentUpdateCheckResult
POST /api/v1/ota/content/sync              → void
POST /api/v1/ota/content/rollback          → void

Permissions:
  ota:read    → GET routes (VIEWER+)
  ota:manage  → POST routes (ADMIN+)
```

### 7.5 Desktop Shell Commands (Tauri)

```rust
#[tauri::command]
async fn swap_child_binary(new_binary_path: String) -> Result<(), String>;
// Kills server.exe, replaces binary, restarts, waits for /health

#[tauri::command]
async fn request_self_update() -> Result<(), String>;
// Defers to NSIS installer when queue idle
```

---

## 8. Failure Scenarios & Mitigations

| Scenario | Mitigation |
|---|---|
| WAN unavailable | Try LAN relay, then cached artifacts |
| LAN unavailable | Fall back to WAN |
| Corrupted artifact | SHA-256 verification fails, reject, retry download |
| Invalid signature | Signature verification fails, reject, alert admin |
| Interrupted download | Resume download (HTTP Range) or restart |
| Update while queue has jobs | Wait for queue idle (poll every 5s, timeout 1h) |
| Update while printing | Same as above; gate on queue metrics + scheduler.settled |
| App fails to start after update | Health check fails, automatic rollback |
| Rollback fails | Manual intervention; log error, alert admin |
| Incompatible content version | Reject manifest, log error |
| Invalid profile/template | Validation fails, reject manifest, log error |
| Local modification vs managed update | Ownership = FORKED, create new version with suffix |
| Restart during content sync | Transactional apply; if interrupted, rollback transaction |
| Repeated update request | Idempotent; if already at target version, return success |
| Already-current version | Return success, no download |
| Downgrade attempt | Reject (version < min_supported_version) |
| Schema migration incompatibility | Content manifest specifies required schema version; reject if app schema < required |

---

## 9. Acceptance Criteria

### 9.1 Application OTA

- [ ] WAN update works (download, verify, install, health check)
- [ ] LAN update works (LAN relay, fallback to WAN)
- [ ] Desktop update works (child binary swap, restart, health check)
- [ ] Runner update works (stop, replace, start, health check)
- [ ] Active printing is protected (queue idle gate)
- [ ] Rollback works (automatic on failure, manual on demand)
- [ ] Offline printing remains functional (cached artifacts)
- [ ] Security verification works (SHA-256, Ed25519 signature)

### 9.2 Content OTA

- [ ] Profile OTA works (manifest sync, validation, transactional apply)
- [ ] Template OTA works (manifest sync, validation, transactional apply)
- [ ] Content ownership works (MANAGED/LOCAL/FORKED)
- [ ] Rollback/history works (revert to previous version)
- [ ] Hot reload where safe (no app restart for content updates)

### 9.3 Failure Tests

- [ ] All 17 failure scenarios from mission document pass

### 9.4 Integration

- [ ] Automated tests pass (unit, integration)
- [ ] Existing print execution behavior unchanged
- [ ] No regressions in callback/NATS/API behavior

---

## 10. Migration Impact

### 10.1 Database Schema

New tables (schema version 7):

```sql
CREATE TABLE ota_update_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL,
  target_version TEXT,
  started_at TEXT,
  updated_at TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0
);

CREATE TABLE content_history (
  id INTEGER PRIMARY KEY,
  content_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  manifest_json TEXT NOT NULL
);

ALTER TABLE paper_profiles ADD COLUMN ownership TEXT DEFAULT 'LOCAL';
ALTER TABLE paper_profiles ADD COLUMN source_version INTEGER;
ALTER TABLE paper_profiles ADD COLUMN content_hash TEXT;

ALTER TABLE print_templates ADD COLUMN ownership TEXT DEFAULT 'LOCAL';
ALTER TABLE print_templates ADD COLUMN source_version INTEGER;
ALTER TABLE print_templates ADD COLUMN content_hash TEXT;
```

### 10.2 Configuration

New environment variables:

```env
PRINTOPS_OTA_ENABLED=true
PRINTOPS_OTA_CHANNEL=stable
PRINTOPS_OTA_LAN_RELAY_URL=
PRINTOPS_OTA_AUTO_CHECK=true
PRINTOPS_OTA_AUTO_CHECK_INTERVAL_HOURS=24
PRINTOPS_OTA_AUTO_UPDATE=false
```

### 10.3 Permissions

New RBAC permissions:

```typescript
'ota:read'    // VIEWER+
'ota:manage'  // ADMIN+
```

### 10.4 Build Pipeline

- `release-verify.mjs` emits `manifest.json` with checksums
- Signing step added (Ed25519 over manifest)
- Runner version injected via ldflags

---

## 11. Out of Scope

- Central Control Plane API (file-based manifests only for now)
- Staged rollout enforcement (manifest field present, but not enforced client-side)
- Update channels beyond `stable` (field present, but only `stable` implemented)
- Delta updates (full artifact replacement only)
- Multi-tenant update policies (single policy per installation)

---

## 12. Open Questions

1. Where does the WAN artifact store live? (GitHub Releases, S3, existing CDN?)
2. Signing key custody: who holds the release signing key? (single key, or HSM?)
3. LAN relay deployment: existing server, or new infrastructure?
4. Auto-update policy: opt-in or opt-out for desktop users?

These are non-blocking for implementation but must be resolved before production deployment.

---

## 13. Approval

Lead Engineer must approve these contracts before implementation proceeds.

Approved: ☐ YES ☐ NO

Date: ___________

Signature: ___________
