import type {
  ControlSyncedJob,
  DeviceRecord,
  DeviceEnrollmentRequest,
  DeviceEnrollmentResponse,
  DeviceHeartbeatPayload,
  DeviceRegistryFilter,
  DeviceRegistryRepositoryPort,
  EnrollmentToken,
  CreateEnrollmentTokenInput,
  EnrollmentTokenRepositoryPort,
  ControlAuditRepositoryPort,
} from '@printerops/domain';
import { AppError, ConflictError, NotFoundError, ValidationError, generateId } from '@printerops/shared';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from '../infra/db/sqlite.js';
import { CURRENT_SCHEMA_VERSION } from '../infra/db/sqlite.schema.js';
import { DEFAULT_CONTROL_PLANE_STREAM } from '../infra/nats/control-plane-transport.js';
import { deriveJobMirrorCredential, hashDeviceToken, verifyControlMessage } from './control-message-auth.js';
export { hashDeviceToken } from './control-message-auth.js';
const AUTO_DISCOVERY_INTERVAL_MS = 30_000;
const SENSITIVE_PAYLOAD_KEY_PATTERN = /secret|token|password|api_?key/i;
/** How often the control plane refreshes every known station's job mirror. */
export const JOB_SYNC_INTERVAL_MS = 30_000;
/** Parallel station pulls, so a large fleet cannot saturate one tick. */
const JOB_SYNC_CONCURRENCY = 4;

/**
 * Stations the control plane should probe over HTTP, in addition to the ones it
 * already knows from enrollment heartbeats and from `PRINTOPS_CLIENT_URL`.
 *
 * `PRINTOPS_CONTROL_DISCOVERY_TARGETS` is a comma-separated list, because a control
 * plane serves many stations: each entry is one station origin, and an operator adds
 * or removes entries without touching the deployment shape. Entries may omit the
 * scheme and the port; `stationBaseUrl` fills in the defaults.
 */
export function defaultDiscoveryTargets(env: NodeJS.ProcessEnv = process.env): string[] {
  const listed = (env['PRINTOPS_CONTROL_DISCOVERY_TARGETS'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const legacySingle = (env['PRINTOPS_CLIENT_URL'] ?? '').trim();
  const candidates = [
    ...(legacySingle ? [legacySingle] : []),
    ...listed,
    // Stations co-located with the control plane, for a single-host install.
    'http://host.docker.internal:31415',
    'http://127.0.0.1:31415',
    'http://localhost:31415',
  ];
  return [...new Set(candidates)];
}

/** Keeps every station pull independent while bounding how many run at once. */
async function runWithLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<unknown>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item === undefined) return;
      try {
        await run(item);
      } catch {
        // One unreachable station must not stop the sweep.
      }
    }
  });
  await Promise.all(workers);
}

function sanitizeSyncedPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (SENSITIVE_PAYLOAD_KEY_PATTERN.test(key)) continue;
    if (value === undefined) continue;
    result[key] = value;
  }
  return result;
}

function normalizeSyncedJob(deviceId: string, raw: ControlSyncedJob): ControlSyncedJob | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id.trim()) {
    return null;
  }
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt
    ? raw.createdAt
    : new Date().toISOString();
  return {
    ...raw,
    id: raw.id.trim(),
    deviceId,
    printerId: typeof raw.printerId === 'string' ? raw.printerId : '',
    status: typeof raw.status === 'string' && raw.status ? raw.status : 'ACCEPTED',
    copies: typeof raw.copies === 'number' && Number.isFinite(raw.copies) ? raw.copies : 1,
    payload: sanitizeSyncedPayload(raw.payload),
    createdAt,
  };
}

function objectField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !(key in value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function stringField(value: unknown, key: string): string | undefined {
  const field = objectField(value, key);
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const field = objectField(value, key);
  return typeof field === 'number' ? field : undefined;
}

function stringArrayField(value: unknown, key: string): string[] | undefined {
  const field = objectField(value, key);
  return Array.isArray(field) && field.every((item: unknown) => typeof item === 'string')
    ? field as string[]
    : undefined;
}

/**
 * Builds the base URL of a station from a stored address entry.
 *
 * Discovery stores `host:port` because the default station port is not the only
 * one in use: a Compose station listens on 3001 behind its own service name. Blindly
 * appending :31415 reached a *different* station's mirror and filed its jobs under
 * this device, so only a port-less entry gets the default.
 */
export function stationBaseUrl(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const hasPort = /:\d+$/.test(trimmed);
  return hasPort ? `http://${trimmed}` : `http://${trimmed}:31415`;
}

/**
 * Host part of a stored station address, lower-cased. Older discovery rows stored a
 * bare hostname while current rows store `host:port`, so deduplicating records that
 * describe the same station must ignore the port.
 */
export function addressHostName(address: string): string {
  return address
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase();
}

/**
 * True when a pulled job mirror really belongs to the device record that asked for
 * it. An unknown identity on either side is accepted, because older stations do not
 * report an installation id; a known disagreement is not.
 */
export function sameStationIdentity(
  recordInstallationId: string | undefined,
  reportedInstallationId: unknown,
): boolean {
  if (typeof reportedInstallationId !== 'string' || reportedInstallationId.trim().length === 0) return true;
  if (!recordInstallationId || recordInstallationId.trim().length === 0) return true;
  return recordInstallationId.trim() === reportedInstallationId.trim();
}

/**
 * Headers the control plane presents when it pulls one station's job mirror.
 *
 * The shared `PRINTOPS_CONTROL_PULL_TOKEN` wins when it is configured, because every
 * station accepts it — enrolled or not. Without it, the control plane falls back to the
 * credential both sides derive from the device token hash, which an enrolled station can
 * verify and which needs no configuration per customer. A station that never enrolled
 * accepts the pull outright when neither is in play.
 */
export function stationPullCredentialHeaders(
  device: Pick<DeviceRecord, 'deviceId' | 'deviceTokenHash'>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const shared = (env['PRINTOPS_CONTROL_PULL_TOKEN'] ?? '').trim();
  if (shared) return { 'x-control-pull-token': shared };
  try {
    return { 'x-control-pull-token': deriveJobMirrorCredential(device.deviceTokenHash, device.deviceId) };
  } catch {
    // A malformed stored hash cannot yield a credential.
    return {};
  }
}


export interface WebControlRegistryConfig {
  natsUrl?: string;
  natsStream?: string;
  staleThresholdMs?: number; // default 30s
  offlineThresholdMs?: number; // default 90s
}

export interface WebControlRegistryDeps {
  deviceRegistry: DeviceRegistryRepositoryPort;
  enrollmentTokens: EnrollmentTokenRepositoryPort;
  audit?: ControlAuditRepositoryPort;
  config?: WebControlRegistryConfig;
  useSqlite?: boolean;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export class WebControlRegistryService {
  private readonly deviceRegistry: DeviceRegistryRepositoryPort;
  private readonly enrollmentTokens: EnrollmentTokenRepositoryPort;
  private readonly audit?: ControlAuditRepositoryPort;
  private readonly config: Required<WebControlRegistryConfig>;
  private readonly useSqlite: boolean;
  private readonly logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly deviceJobs = new Map<string, Map<string, ControlSyncedJob>>();
  /**
   * Control-plane acknowledgement of an UNVERIFIED/timeout job. Kept beside the
   * mirror so a station sync never rewrites it; the station's job status and
   * payload are untouched.
   */
  private readonly reviewedJobs = new Map<string, { reviewedAt: string; reviewedBy: string }>();
  private lastAutoDiscoveryAt = 0;
  private automaticDiscoveryInFlight?: Promise<void>;
  private readonly lastJobSyncAt = new Map<string, number>();

  constructor(deps: WebControlRegistryDeps) {
    this.deviceRegistry = deps.deviceRegistry;
    this.enrollmentTokens = deps.enrollmentTokens;
    this.audit = deps.audit;
    this.useSqlite = Boolean(deps.useSqlite);
    this.logger = deps.logger;
    this.config = {
      natsUrl: deps.config?.natsUrl || process.env['PRINTOPS_CONTROL_NATS_URL'] || 'nats://127.0.0.1:4222',
      natsStream: deps.config?.natsStream || process.env['PRINTOPS_CONTROL_NATS_STREAM'] || DEFAULT_CONTROL_PLANE_STREAM,
      staleThresholdMs: deps.config?.staleThresholdMs ?? 30_000,
      offlineThresholdMs: deps.config?.offlineThresholdMs ?? 90_000,
    };
  }

  async createEnrollmentToken(input: CreateEnrollmentTokenInput): Promise<EnrollmentToken> {
    if (!input.siteId || input.siteId.trim().length === 0) {
      throw new ValidationError('siteId is required');
    }
    const token = await this.enrollmentTokens.create(input);
    if (this.audit) {
      await this.audit.record({
        actor: input.createdBy,
        deviceId: 'pending',
        action: 'device.enrollment_token_created',
        requestedAt: new Date(),
        metadata: { tokenPreview: `${token.token.slice(0, 10)}...`, siteId: token.siteId, expiresAt: token.expiresAt.toISOString() },
      });
    }
    return token;
  }

  async enrollDevice(request: DeviceEnrollmentRequest): Promise<DeviceEnrollmentResponse> {
    if (!request.enrollmentToken || request.enrollmentToken.trim().length === 0) {
      throw new ValidationError('enrollmentToken is required');
    }
    if (!request.installationId || request.installationId.trim().length === 0) {
      throw new ValidationError('installationId is required');
    }

    const tokenRecord = await this.enrollmentTokens.findByToken(request.enrollmentToken.trim());
    if (!tokenRecord) {
      throw new NotFoundError('EnrollmentToken', request.enrollmentToken);
    }

    if (tokenRecord.consumedAt !== null) {
      throw new ConflictError('Enrollment token has already been consumed');
    }

    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Enrollment token has expired', 410);
    }

    // Check if device with this installationId already exists
    const existing = await this.deviceRegistry.findByInstallationId(request.installationId.trim());
    const deviceId = existing?.deviceId || `dev_${generateId()}`;
    const deviceToken = `devtok_${randomBytes(32).toString('hex')}`;
    const deviceTokenHash = hashDeviceToken(deviceToken);
    const siteId = request.siteId || tokenRecord.siteId;

    // Consume token atomically
    const consumed = await this.enrollmentTokens.consume(tokenRecord.token, deviceId);
    if (!consumed) {
      throw new ConflictError('Enrollment token could not be consumed');
    }

    if (existing) {
      await this.deviceRegistry.update(existing.deviceId, {
        hostname: request.hostname,
        platform: request.platform,
        architecture: request.architecture,
        appVersion: request.appVersion,
        schemaVersion: request.schemaVersion,
        runnerVersion: request.runnerVersion,
        deviceTokenHash,
        displayName: request.displayName ?? existing.displayName,
        status: 'ACTIVE',
        connectionState: 'ONLINE',
        lastSeenAt: new Date(),
      });
    } else {
      await this.deviceRegistry.create({
        deviceId,
        installationId: request.installationId.trim(),
        siteId,
        hostname: request.hostname,
        platform: request.platform,
        architecture: request.architecture,
        appVersion: request.appVersion,
        schemaVersion: request.schemaVersion,
        runnerVersion: request.runnerVersion,
        deviceTokenHash,
        displayName: request.displayName,
      });
    }

    if (this.audit) {
      await this.audit.record({
        actor: `device:${deviceId}`,
        deviceId,
        action: 'device.enrolled',
        requestedAt: new Date(),
        metadata: {
          installationId: request.installationId,
          siteId,
          hostname: request.hostname,
          platform: request.platform,
        },
      });
    }

    return {
      deviceId,
      installationId: request.installationId.trim(),
      siteId,
      deviceToken,
      controlPlane: {
        natsUrl: this.config.natsUrl,
        stream: this.config.natsStream,
        commandSubject: `printops.control.command.${deviceId}`,
        eventSubject: `printops.control.event.${deviceId}`,
        heartbeatSubject: `printops.control.heartbeat.${deviceId}`,
      },
    };
  }

  async authenticateDevice(deviceId: string, deviceToken: string): Promise<DeviceRecord | null> {
    const device = await this.deviceRegistry.findById(deviceId);
    if (!device || device.status !== 'ACTIVE') {
      return null;
    }

    const providedHash = Buffer.from(hashDeviceToken(deviceToken), 'hex');
    const storedHash = Buffer.from(device.deviceTokenHash, 'hex');

    if (providedHash.length !== storedHash.length || !timingSafeEqual(providedHash, storedHash)) {
      return null;
    }

    return device;
  }

  async authenticateDeviceMessage(deviceId: string, payload: unknown, signature: string): Promise<DeviceRecord | null> {
    if (
      !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
      || !('deviceId' in payload)
      || payload.deviceId !== deviceId
    ) return null;
    const device = await this.deviceRegistry.findById(deviceId);
    if (!device || device.status !== 'ACTIVE') return null;
    return verifyControlMessage(device.deviceTokenHash, payload, signature) ? device : null;
  }

  async recordHeartbeat(payload: DeviceHeartbeatPayload): Promise<DeviceRecord> {
    const device = await this.deviceRegistry.findById(payload.deviceId);
    if (!device) {
      throw new NotFoundError('Device', payload.deviceId);
    }
    const updated = await this.deviceRegistry.recordHeartbeat(payload.deviceId, payload);
    if (Array.isArray(payload.recentJobs) && payload.recentJobs.length > 0) {
      await this.upsertDeviceJobs(payload.deviceId, payload.recentJobs);
    }
    return updated;
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | undefined> {
    const device = await this.deviceRegistry.findById(deviceId);
    if (!device) return undefined;
    return this.applyDynamicConnectionState(device);
  }

  async updateDevice(
    deviceId: string,
    patch: { displayName?: string; siteId?: string },
    actorId = 'system',
  ): Promise<DeviceRecord> {
    const existing = await this.deviceRegistry.findById(deviceId);
    if (!existing) {
      throw new NotFoundError('Device', deviceId);
    }

    const updatePatch: Partial<DeviceRecord> = {};
    if ('displayName' in patch && patch.displayName !== undefined) {
      if (typeof patch.displayName !== 'string') {
        throw new ValidationError('displayName must be a string');
      }
      const trimmed = patch.displayName.trim();
      if (trimmed.length > 128) {
        throw new ValidationError('displayName must be 128 characters or fewer');
      }
      updatePatch.displayName = trimmed.length > 0 ? trimmed : existing.hostname;
    }

    if ('siteId' in patch && patch.siteId !== undefined) {
      if (typeof patch.siteId !== 'string') {
        throw new ValidationError('siteId must be a string');
      }
      const trimmed = patch.siteId.trim();
      if (!trimmed || trimmed.length > 128) {
        throw new ValidationError('siteId must be 1 to 128 characters');
      }
      updatePatch.siteId = trimmed;
    }

    const updated = await this.deviceRegistry.update(deviceId, updatePatch);
    if (this.audit) {
      await this.audit.record({
        actor: actorId,
        deviceId,
        action: 'device.updated',
        requestedAt: new Date(),
        metadata: {
          previousDisplayName: existing.displayName,
          displayName: updated.displayName,
          previousSiteId: existing.siteId,
          siteId: updated.siteId,
        },
      });
    }
    return this.applyDynamicConnectionState(updated);
  }

  async upsertDeviceJobs(deviceId: string, jobs: ControlSyncedJob[]): Promise<void> {
    if (!Array.isArray(jobs) || jobs.length === 0) return;

    let bucket = this.deviceJobs.get(deviceId);
    if (!bucket) {
      bucket = new Map<string, ControlSyncedJob>();
      this.deviceJobs.set(deviceId, bucket);
    }

    const normalizedList: ControlSyncedJob[] = [];
    for (const rawJob of jobs) {
      const normalized = normalizeSyncedJob(deviceId, rawJob);
      if (!normalized) continue;
      bucket.set(normalized.id, normalized);
      normalizedList.push(normalized);
    }

    // Keep the in-memory ring bounded per station
    if (bucket.size > 1000) {
      const ordered = Array.from(bucket.values())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 1000);
      bucket = new Map(ordered.map((job) => [job.id, job]));
      this.deviceJobs.set(deviceId, bucket);
    }

    if (this.useSqlite && normalizedList.length > 0) {
      const db = getDb();
      for (const job of normalizedList) {
        // ON CONFLICT instead of INSERT OR REPLACE: a re-sync must refresh the
        // job body without deleting the operator's review acknowledgement.
        db.run(
          `INSERT INTO control_device_jobs (
            device_id, job_id, status, created_at, updated_at, job_json
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id, job_id) DO UPDATE SET
            status = excluded.status,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            job_json = excluded.job_json`,
          [
            deviceId,
            job.id,
            job.status,
            job.createdAt,
            job.updatedAt ?? job.completedAt ?? job.createdAt,
            JSON.stringify(job),
          ],
        );
      }
    }
  }

  private reviewKey(deviceId: string, jobId: string): string {
    return `${deviceId}\u0000${jobId}`;
  }

  /**
   * Acknowledge (or un-acknowledge) one mirrored job. Returns false when the
   * job is not in the mirror, so the route can answer 404 instead of pretending
   * the acknowledgement landed.
   *
   * The acknowledgement is a triage decision an operator made about physical
   * output, so it is audited like every other mutation here: when someone asks
   * later who cleared an UNVERIFIED job and when, `control/audit` has the answer
   * instead of only the current `reviewed_by` column.
   */
  async setJobReviewed(
    deviceId: string,
    jobId: string,
    reviewed: boolean,
    reviewedBy: string,
  ): Promise<boolean> {
    const key = this.reviewKey(deviceId, jobId);
    const job = this.deviceJobs.get(deviceId)?.get(jobId);
    let found = job != null;

    if (this.useSqlite) {
      const db = getDb();
      if (reviewed) {
        db.run(
          'UPDATE control_device_jobs SET reviewed_at = ?, reviewed_by = ? WHERE device_id = ? AND job_id = ?',
          [new Date().toISOString(), reviewedBy, deviceId, jobId],
        );
      } else {
        db.run(
          'UPDATE control_device_jobs SET reviewed_at = NULL, reviewed_by = NULL WHERE device_id = ? AND job_id = ?',
          [deviceId, jobId],
        );
      }
      found = found || db.getRowsModified() > 0;
    }

    if (!found) return false;

    if (reviewed) this.reviewedJobs.set(key, { reviewedAt: new Date().toISOString(), reviewedBy });
    else this.reviewedJobs.delete(key);

    if (this.audit) {
      await this.audit.record({
        actor: reviewedBy,
        deviceId,
        action: reviewed ? 'job.reviewed' : 'job.unreviewed',
        requestedAt: new Date(),
        metadata: { jobId, status: this.auditStatusFor(deviceId, jobId, job) },
      });
    }
    return true;
  }

  /**
   * The status the audited job carried, for the audit metadata. The in-memory
   * mirror is authoritative while the process is warm; after a restart it is
   * empty until something reads the mirror, so fall back to the row itself
   * rather than writing `null` into a record someone may have to explain.
   */
  private auditStatusFor(
    deviceId: string,
    jobId: string,
    inMemory: ControlSyncedJob | undefined,
  ): string | null {
    if (inMemory) return inMemory.status;
    if (!this.useSqlite) return null;
    const stmt = getDb().prepare(
      'SELECT job_json FROM control_device_jobs WHERE device_id = ? AND job_id = ?',
    );
    stmt.bind([deviceId, jobId]);
    try {
      if (!stmt.step()) return null;
      const rawJson = stmt.getAsObject()['job_json'];
      if (typeof rawJson !== 'string') return null;
      const parsed = JSON.parse(rawJson) as { status?: unknown };
      return typeof parsed.status === 'string' ? parsed.status : null;
    } catch {
      return null;
    } finally {
      stmt.free();
    }
  }

  private withReview(deviceId: string, job: ControlSyncedJob): ControlSyncedJob {
    const review = this.reviewedJobs.get(this.reviewKey(deviceId, job.id));
    if (!review) return job;
    return { ...job, reviewedAt: review.reviewedAt, reviewedBy: review.reviewedBy };
  }

  async getDeviceJobs(deviceId: string): Promise<ControlSyncedJob[]> {
    if (this.useSqlite) {
      const db = getDb();
      const stmt = db.prepare(
        'SELECT job_json, reviewed_at, reviewed_by FROM control_device_jobs WHERE device_id = ? ORDER BY created_at DESC LIMIT 1000',
      );
      stmt.bind([deviceId]);
      const rows: ControlSyncedJob[] = [];
      try {
        while (stmt.step()) {
          const row = stmt.getAsObject();
          const rawJson = row['job_json'];
          if (typeof rawJson === 'string') {
            try {
              const parsed = JSON.parse(rawJson) as ControlSyncedJob;
              const normalized = normalizeSyncedJob(deviceId, parsed);
              if (normalized) {
                const reviewedAt = typeof row['reviewed_at'] === 'string' ? row['reviewed_at'] : undefined;
                const reviewedBy = typeof row['reviewed_by'] === 'string' ? row['reviewed_by'] : undefined;
                rows.push(
                  reviewedAt
                    ? { ...normalized, reviewedAt, ...(reviewedBy ? { reviewedBy } : {}) }
                    : normalized,
                );
              }
            } catch {
              // ignore malformed row
            }
          }
        }
      } finally {
        stmt.free();
      }
      if (rows.length > 0) {
        return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      }
    }

    const bucket = this.deviceJobs.get(deviceId);
    if (!bucket) return [];
    return Array.from(bucket.values())
      .map((job) => this.withReview(deviceId, job))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async syncJobsFromReachableDevice(device: DeviceRecord): Promise<ControlSyncedJob[]> {
    const hosts = (device.ipAddresses ?? []).map((ip) => ip.trim()).filter(Boolean);
    const headers = stationPullCredentialHeaders(device);
    for (const host of hosts) {
      const baseUrl = stationBaseUrl(host);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      try {
        const res = await fetch(`${baseUrl}/api/v1/control/local-jobs`, {
          signal: controller.signal,
          headers,
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          installationId?: string;
          jobs?: ControlSyncedJob[];
        };
        if (!Array.isArray(data?.jobs)) continue;
        // A stored address can reach a different station than the one this record
        // describes (a re-imaged workstation, a reused address). Storing that
        // response would show another station's jobs under this device name, so
        // skip it while the two identities disagree.
        if (!sameStationIdentity(device.installationId, data.installationId)) {
          this.logger?.warn(
            `Skipping job sync for ${device.deviceId}: ${baseUrl} reports installation `
            + `"${data.installationId}" but this device is "${device.installationId}"`,
          );
          continue;
        }
        await this.upsertDeviceJobs(device.deviceId, data.jobs);
        break;
      } catch {
        // unreachable or timeout; try next address
      } finally {
        clearTimeout(timeout);
      }
    }
    return this.getDeviceJobs(device.deviceId);
  }

  /**
   * Refreshes the job mirror of every station this control plane knows about,
   * whatever the source of that knowledge: enrollment heartbeat, `announce`, a
   * discovery sweep, or a manual Discover. Nothing has to be configured per
   * customer — a station that appears once is pulled from on the next tick.
   */
  async syncAllDeviceJobs(
    options: { force?: boolean; intervalMs?: number } = {},
  ): Promise<{ attempted: number; pulled: number }> {
    const devices = await this.listDevices();
    const now = Date.now();
    const minInterval = options.intervalMs ?? JOB_SYNC_INTERVAL_MS;
    const due = devices.filter((device) => {
      if ((device.ipAddresses ?? []).length === 0) return false;
      if (options.force) return true;
      return now - (this.lastJobSyncAt.get(device.deviceId) ?? 0) >= minInterval;
    });
    for (const device of due) this.lastJobSyncAt.set(device.deviceId, now);
    let pulled = 0;
    await runWithLimit(due, JOB_SYNC_CONCURRENCY, async (device) => {
      const jobs = await this.syncJobsFromReachableDevice(device);
      if (jobs.length > 0) pulled += 1;
    });
    return { attempted: due.length, pulled };
  }

  /**
   * Starts the background sweep that populates the job mirror. The fleet read stays a
   * read: without this, the only ways to ingest were a manual Sync press or a
   * discovery tick, which is why the Jobs page could sit empty on a station the
   * control plane had already found.
   */
  startJobSyncLoop(intervalMs: number = JOB_SYNC_INTERVAL_MS): () => void {
    const sweep = () => {
      void this.syncAllDeviceJobs({ intervalMs })
        .catch((error: unknown) => this.logger?.warn('Station job sweep failed', error));
    };
    const timer = setInterval(sweep, intervalMs);
    timer.unref?.();
    sweep();
    return () => clearInterval(timer);
  }

  async autoRegisterDevice(input: {
    installationId: string;
    hostname: string;
    platform: string;
    architecture: string;
    appVersion: string;
    schemaVersion?: number;
    runnerVersion?: string;
    siteId?: string;
    displayName?: string;
    ipAddresses?: string[];
    capabilities?: string[];
    preserveDisplayName?: boolean;
  }): Promise<DeviceRecord> {
    const existing = await this.deviceRegistry.findByInstallationId(input.installationId.trim());
    const deviceId = existing?.deviceId || `dev_${input.installationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}`;
    const deviceToken = `devtok_${randomBytes(24).toString('hex')}`;
    const deviceTokenHash = hashDeviceToken(deviceToken);
    const siteId = input.siteId || existing?.siteId || 'default-site';

    if (existing) {
      const hasCustomDisplayName = Boolean(
        existing.displayName && !existing.displayName.endsWith(' (Auto-Discovered)'),
      );
      const nextDisplayName = input.preserveDisplayName && hasCustomDisplayName
        ? existing.displayName
        : input.displayName ?? existing.displayName;
      return this.deviceRegistry.update(existing.deviceId, {
        hostname: input.hostname,
        platform: input.platform,
        architecture: input.architecture,
        appVersion: input.appVersion,
        schemaVersion: input.schemaVersion ?? existing.schemaVersion,
        runnerVersion: input.runnerVersion ?? existing.runnerVersion,
        displayName: nextDisplayName,
        status: existing.status,
        connectionState: 'ONLINE',
        lastSeenAt: new Date(),
        capabilities: input.capabilities ?? existing.capabilities ?? ['content-sync-v1', 'ota-v1'],
        ipAddresses: input.ipAddresses ?? existing.ipAddresses,
      });
    }

    return this.deviceRegistry.create({
      deviceId,
      installationId: input.installationId.trim(),
      siteId,
      hostname: input.hostname,
      platform: input.platform,
      architecture: input.architecture,
      appVersion: input.appVersion,
      schemaVersion: input.schemaVersion ?? CURRENT_SCHEMA_VERSION,
      runnerVersion: input.runnerVersion ?? '0.1.28',
      deviceTokenHash,
      displayName: input.displayName ?? input.hostname,
      capabilities: input.capabilities ?? ['content-sync-v1', 'ota-v1'],
      ipAddresses: input.ipAddresses,
    });
  }

  async discoverDevices(targets?: string[]): Promise<DeviceRecord[]> {
    const candidateTargets = (targets && targets.length > 0)
      ? targets
      : defaultDiscoveryTargets();

    const discovered: DeviceRecord[] = [];

    await Promise.all(
      candidateTargets.map(async (targetUrl) => {
        try {
          const normalized = targetUrl.replace(/\/+$/, '');
          const url = normalized.startsWith('http') ? normalized : `http://${normalized}:31415`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2000);
          let healthData: unknown;
          try {
            const healthRes = await fetch(`${url}/health`, { signal: controller.signal });
            if (!healthRes.ok) return;
            healthData = await healthRes.json();
          } finally {
            clearTimeout(timeout);
          }
          if (stringField(healthData, 'status') !== 'ok') return;

          let infoData: unknown = {};
          const infoCtrl = new AbortController();
          const infoTimeout = setTimeout(() => infoCtrl.abort(), 1500);
          try {
            const infoRes = await fetch(`${url}/api/v1/control/device-info`, { signal: infoCtrl.signal });
            if (infoRes.ok) {
              infoData = await infoRes.json();
            }
          } catch {
            // Discovery can still use host and version from /health.
          } finally {
            clearTimeout(infoTimeout);
          }

          const parsedUrl = new URL(url);
          const stationData = objectField(healthData, 'station');
          const hostname = stringField(infoData, 'hostname')
            || stringField(stationData, 'hostname')
            || parsedUrl.hostname;
          const installationId = stringField(infoData, 'installationId')
            || stringField(stationData, 'installationId')
            || `discovered_${hostname}_31415`;
          const appVersion = stringField(infoData, 'appVersion')
            || stringField(healthData, 'version')
            || '0.1.32';
          const platform = stringField(infoData, 'platform')
            || stringField(stationData, 'platform')
            || 'windows-x64';
          const architecture = stringField(infoData, 'architecture') || 'x64';

          const record = await this.autoRegisterDevice({
            installationId,
            hostname,
            platform,
            architecture,
            appVersion,
            schemaVersion: numberField(infoData, 'schemaVersion') ?? 8,
            capabilities: stringArrayField(infoData, 'capabilities') ?? ['content-sync-v1', 'ota-v1'],
            // `host` keeps the discovered port; `hostname` would drop it and make a
            // later pull reach whatever else listens on the default port.
            ipAddresses: [parsedUrl.host],
            displayName: `${hostname} (Auto-Discovered)`,
            preserveDisplayName: true,
          });

          const jobsCtrl = new AbortController();
          const jobsTimeout = setTimeout(() => jobsCtrl.abort(), 1500);
          try {
            const jobsRes = await fetch(`${url}/api/v1/control/local-jobs`, {
              signal: jobsCtrl.signal,
              headers: stationPullCredentialHeaders(record),
            });
            if (jobsRes.ok) {
              const jobsPayload = (await jobsRes.json()) as {
                installationId?: string;
                jobs?: ControlSyncedJob[];
              };
              if (
                Array.isArray(jobsPayload?.jobs)
                && sameStationIdentity(record.installationId, jobsPayload.installationId)
              ) {
                await this.upsertDeviceJobs(record.deviceId, jobsPayload.jobs);
              }
            }
          } catch {
            // Remote station may not expose local-jobs yet
          } finally {
            clearTimeout(jobsTimeout);
          }

          discovered.push(record);
        } catch {
          // unreachable target, ignore
        }
      }),
    );

    return discovered;
  }

  async listDevices(filter?: DeviceRegistryFilter): Promise<DeviceRecord[]> {
    const repoFilter = filter ? { ...filter, connectionState: undefined } : undefined;
    await this.refreshFromNetworkIfDue();
    const allDevices = await this.deviceRegistry.findAll();
    const devices = repoFilter
      ? await this.deviceRegistry.findAll(repoFilter)
      : allDevices;

    // Older discovery records without an installation identity can describe
    // the same station as a later identity-aware probe of the same endpoint.
    // Compare by host, because a stored address may or may not carry the station
    // port (`host` from older rows, `host:port` from current discovery).
    const identifiedAddresses = new Set(
      allDevices
        .filter((device) => !device.installationId.startsWith('discovered_'))
        .flatMap((device) => device.ipAddresses ?? [])
        .map(addressHostName),
    );
    const visibleDevices = devices.filter((device) => {
      if (!device.installationId.startsWith('discovered_')) return true;
      return !(device.ipAddresses ?? []).some((address) => identifiedAddresses.has(addressHostName(address)));
    });
    const enriched = visibleDevices.map((device) => this.applyDynamicConnectionState(device));
    if (filter?.connectionState) {
      return enriched.filter((device) => device.connectionState === filter.connectionState);
    }
    return enriched;
  }

  private async refreshFromNetworkIfDue(): Promise<void> {
    if (this.automaticDiscoveryInFlight) {
      await this.automaticDiscoveryInFlight;
      return;
    }
    if (Date.now() - this.lastAutoDiscoveryAt < AUTO_DISCOVERY_INTERVAL_MS) return;

    this.lastAutoDiscoveryAt = Date.now();
    const discovery = this.discoverDevices().then(() => undefined);
    this.automaticDiscoveryInFlight = discovery;
    try {
      await discovery;
    } finally {
      if (this.automaticDiscoveryInFlight === discovery) {
        this.automaticDiscoveryInFlight = undefined;
      }
    }
  }

  private applyDynamicConnectionState(device: DeviceRecord): DeviceRecord {
    if (!device.lastSeenAt) {
      return { ...device, connectionState: 'OFFLINE' };
    }
    const elapsed = Date.now() - new Date(device.lastSeenAt).getTime();
    let state: DeviceRecord['connectionState'] = 'ONLINE';
    if (elapsed > this.config.offlineThresholdMs) {
      state = 'OFFLINE';
    } else if (elapsed > this.config.staleThresholdMs) {
      state = 'STALE';
    }
    return { ...device, connectionState: state };
  }
}
