import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ControlAuditRepositoryPort,
  ControlCommandType,
  ControlContentKind,
  ControlSyncedJob,
  CreateReleaseCatalogInput,
  DeviceEnrollmentRequest,
  DeviceRecord,
  JobRepositoryPort,
  ReleaseCatalogRecord,
  ReleaseRecordStatus,
} from '@printerops/domain';
import type { WebControlRegistryService } from '../../services/web-control-registry.service.js';
import { stationBaseUrl, stationPullCredentialHeaders } from '../../services/web-control-registry.service.js';
import { deriveJobMirrorCredentialFromToken } from '../../services/control-message-auth.js';
import type { ControlCommandService } from '../../services/control-command.service.js';
import type { ReleaseCatalogService } from '../../services/release-catalog.service.js';
import type { ControlContentSyncService } from '../../services/control-content-sync.service.js';
import type { ReleaseStorageService, MinioStorageConfig } from '../../services/release-storage.service.js';
import type { ReprintJobService, ReprintJobInput } from '../../services/reprint-job.service.js';
import { AppError, ValidationError, generateId } from '@printerops/shared';
import { requirePermission, requirePermissionOrInternal, actor } from './permission-guard.js';
import { jobToControlSyncedJob } from '../job-redaction.js';
import { CURRENT_SCHEMA_VERSION } from '../../infra/db/sqlite.schema.js';
import { LOCAL_CONTROL_CAPABILITIES } from '../../services/control-device-info.service.js';
import os from 'node:os';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseReleaseManifestEnvelope } from '../../services/ota-update.service.js';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export interface ControlRoutesDeps {
  registry: WebControlRegistryService;
  commands: ControlCommandService;
  releases: ReleaseCatalogService;
  audit?: ControlAuditRepositoryPort;
  content?: ControlContentSyncService;
  storage?: ReleaseStorageService;
  jobs?: JobRepositoryPort;
  reprintJob?: ReprintJobService;
  localDeviceId?: () => string;
  localInstallationId?: () => string;
  /** This station's enrollment token, when enrolled — used to accept job-mirror pulls. */
  localDeviceToken?: () => string | undefined;
  /** Loopback updater token, so the bundled control agent can read the job mirror. */
  internalToken?: string;
}

/**
 * Guards the station-side job mirror (`/control/local-jobs`).
 *
 * An enrolled station needs no configuration: the control plane derives a credential
 * from the device token hash it already stores, and the station derives the same value
 * from the token it already holds. That is what lets one Web Control pull from every
 * customer it knows about without a per-station secret.
 *
 * A station that has never enrolled cannot derive one, so pulls from it also accept the
 * optional shared `PRINTOPS_CONTROL_PULL_TOKEN`; with neither available the historical
 * open behaviour is kept rather than breaking an existing deployment blind, and
 * registration warns about it.
 */
export function stationJobMirrorGuard(options: {
  permission: 'control:read' | 'job:retry';
  internalToken?: string;
  deviceId?: () => string | undefined;
  deviceToken?: () => string | undefined;
}) {
  const permissionGuard = requirePermissionOrInternal(options.permission, options.internalToken);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const supplied = req.headers['x-control-pull-token'];
    const deviceId = options.deviceId?.()?.trim();
    const deviceToken = options.deviceToken?.()?.trim();
    if (typeof supplied === 'string' && supplied && deviceId && deviceToken) {
      try {
        if (constantTimeEquals(supplied, deriveJobMirrorCredentialFromToken(deviceToken, deviceId))) return;
      } catch {
        // Fall through to the remaining options.
      }
    }
    const shared = (process.env['PRINTOPS_CONTROL_PULL_TOKEN'] ?? '').trim();
    if (shared && typeof supplied === 'string' && constantTimeEquals(supplied, shared)) return;
    if (!deviceToken && !shared) return;
    await permissionGuard(req, reply);
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function controlRoutes(
  app: FastifyInstance,
  deps: { prefix?: string } & ControlRoutesDeps,
): Promise<void> {
  const importLimitSetting = process.env['PRINTOPS_RELEASE_IMPORT_MAX_MIB'] ?? '128';
  const importBodyLimit = Number(importLimitSetting) * 1024 * 1024;
  if (!/^[0-9]+$/.test(importLimitSetting) || !Number.isSafeInteger(importBodyLimit) || importBodyLimit <= 0) {
    throw new Error('PRINTOPS_RELEASE_IMPORT_MAX_MIB must be a positive whole number of MiB');
  }

  const stationEnrolled = Boolean(deps.localDeviceToken?.()?.trim());
  if (!stationEnrolled && !process.env['PRINTOPS_CONTROL_PULL_TOKEN']?.trim()) {
    app.log.warn(
      'This station is not enrolled with a control plane and PRINTOPS_CONTROL_PULL_TOKEN is not set: '
      + '/control/local-jobs accepts pulls without a credential, which exposes this station\'s job payloads '
      + 'and its reprint trigger to anything that can reach the station port. Enrolling this station, or setting '
      + 'the same token on the station and on the control plane, closes that.',
    );
  }

  // ─── Enrollment Tokens & Bootstrap ──────────────────────────────────────────

  app.post(
    '/control/enrollment-tokens',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = (req.body ?? {}) as { siteId?: string; expiresInSeconds?: number };
      const token = await deps.registry.createEnrollmentToken({
        siteId: body.siteId ?? 'default-site',
        expiresInSeconds: body.expiresInSeconds,
        createdBy: actor(req),
      });
      return reply.status(201).send(token);
    },
  );

  // Device bootstrap: public endpoint using one-time token, returns per-device credentials
  app.post(
    '/control/enroll',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as DeviceEnrollmentRequest;
      const response = await deps.registry.enrollDevice(body);
      return reply.status(201).send(response);
    },
  );

  // Zero-token announcement: any reachable or booted PrintOps station can announce directly
  app.post(
    '/control/announce',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = (req.body ?? {}) as {
        installationId?: string;
        hostname?: string;
        platform?: string;
        architecture?: string;
        appVersion?: string;
        schemaVersion?: number;
        runnerVersion?: string;
        siteId?: string;
        displayName?: string;
        capabilities?: string[];
      };
      if (!body.installationId || !body.hostname) {
        return reply.status(400).send({ error: 'installationId and hostname are required' });
      }
      const device = await deps.registry.autoRegisterDevice({
        installationId: body.installationId,
        hostname: body.hostname,
        platform: body.platform || 'windows-x64',
        architecture: body.architecture || 'x64',
        appVersion: body.appVersion || '0.1.32',
        schemaVersion: body.schemaVersion ?? 8,
        runnerVersion: body.runnerVersion,
        siteId: body.siteId || 'default-site',
        displayName: body.displayName,
        capabilities: body.capabilities ?? ['content-sync-v1', 'ota-v1'],
      });
      return reply.status(200).send({
        deviceId: device.deviceId,
        status: 'ONLINE',
        message: 'Station announced successfully',
      });
    },
  );

  // Network discovery: probes configured or provided IP/host targets for PrintOps stations
  app.post(
    '/control/devices/discover',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = (req.body ?? {}) as { targets?: string[]; ip?: string };
      const targets = body.ip ? [body.ip] : body.targets;
      const discovered = await deps.registry.discoverDevices(targets);
      return reply.send({
        discoveredCount: discovered.length,
        devices: discovered,
      });
    },
  );

  // ─── Device Registry ────────────────────────────────────────────────────────

  app.get(
    '/control/devices',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = (req.query ?? {}) as { siteId?: string; status?: string; connectionState?: string; otaState?: string };
      const devices = await deps.registry.listDevices(query);

      // Annotate each device with latest compatible release
      const enriched = await Promise.all(
        devices.map(async (device) => {
          const latestRelease = await deps.releases.findLatestCompatibleRelease(device);
          return {
            ...device,
            latestCompatibleVersion: latestRelease?.version ?? null,
            hasUpdateAvailable: latestRelease !== null,
          };
        }),
      );

      return reply.send(enriched);
    },
  );

  app.get(
    '/control/devices/:id',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const device = await deps.registry.getDevice(id);
      if (!device) {
        return reply.status(404).send({ error: `Device not found: ${id}` });
      }

      const compatibleReleases = await deps.releases.findCompatibleReleases(device);
      const latestRelease = compatibleReleases[0] ?? null;
      return reply.send({
        ...device,
        latestCompatibleVersion: latestRelease?.version ?? null,
        latestCompatibleRelease: latestRelease ?? null,
        compatibleReleases: compatibleReleases.map((release) => ({
          id: release.id,
          version: release.version,
          channel: release.channel,
          schemaVersion: release.schemaVersion,
          platform: release.platform,
          artifactRef: release.artifactRef,
          sha256: release.sha256,
          releaseNotes: release.releaseNotes,
        })),
        hasUpdateAvailable: latestRelease !== null,
      });
    },
  );

  app.patch(
    '/control/devices/:id',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { displayName?: string; siteId?: string };
      try {
        const updated = await deps.registry.updateDevice(id, body, actor(req));
        const latestRelease = await deps.releases.findLatestCompatibleRelease(updated);
        return reply.send({
          ...updated,
          latestCompatibleVersion: latestRelease?.version ?? null,
          hasUpdateAvailable: latestRelease !== null,
        });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // ─── Station Jobs Sync & Fleet Jobs Hub ─────────────────────────────────────

  const stationMirrorGuardOptions = {
    internalToken: deps.internalToken,
    deviceId: deps.localDeviceId,
    deviceToken: deps.localDeviceToken,
  } as const;

  app.get(
    '/control/local-jobs',
    { onRequest: [stationJobMirrorGuard({ permission: 'control:read', ...stationMirrorGuardOptions })] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const localId = deps.localDeviceId?.() ?? 'local-printops';
      const localInstallationId = deps.localInstallationId?.();
      // deviceId alone cannot identify the station across installs: the control
      // plane assigns its own id, so the puller also compares installationId before
      // storing these jobs under a device. Returning both keeps that check honest.
      const jobs = deps.jobs ? await deps.jobs.findAll({ limit: 500 }) : [];
      return reply.send({
        deviceId: localId,
        ...(localInstallationId ? { installationId: localInstallationId } : {}),
        jobs: jobs.map((job) => jobToControlSyncedJob(job, localId)),
      });
    },
  );

  app.post('/control/local-jobs/:jobId/reprint', { onRequest: [stationJobMirrorGuard({ permission: 'job:retry', ...stationMirrorGuardOptions })] }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!deps.jobs || !deps.reprintJob) {
      return reply.status(503).send({ error: 'Local reprint service is unavailable' });
    }
    const { jobId } = req.params as { jobId: string };
    const body = (req.body ?? {}) as Partial<ReprintJobInput> & { requestedBy?: string };
    const existing = await deps.jobs.findById(jobId);
    if (!existing) {
      return reply.status(404).send({ error: `Job not found: ${jobId}` });
    }
    try {
      const created = await deps.reprintJob.execute(
        jobId,
        {
          printerId: body.printerId || existing.printerId,
          copies: body.copies ?? (existing.copies || 1),
          reason: body.reason ?? '',
          confirmedDuplicateRisk: body.confirmedDuplicateRisk === true,
          confirmedDestinationChange: true,
        },
        body.requestedBy || 'control-plane',
      );
      const localId = deps.localDeviceId?.() ?? 'local-printops';
      return reply.status(201).send(jobToControlSyncedJob(created, localId));
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post('/control/devices/:id/jobs', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const deviceToken = req.headers['x-device-token'];
    if (typeof deviceToken === 'string' && deviceToken.trim().length > 0) {
      const authenticated = await deps.registry.authenticateDevice(id, deviceToken.trim());
      if (!authenticated) {
        return reply.status(401).send({ error: 'Invalid device credentials' });
      }
    } else {
      await requirePermission('control:manage')(req, reply);
      if (reply.sent) return;
    }

    const device = await deps.registry.getDevice(id);
    if (!device) {
      return reply.status(404).send({ error: `Device not found: ${id}` });
    }
    const body = (req.body ?? {}) as { jobs?: ControlSyncedJob[] };
    if (!Array.isArray(body.jobs)) {
      return reply.status(400).send({ error: 'jobs array is required' });
    }
    await deps.registry.upsertDeviceJobs(id, body.jobs);
    return reply.send({ syncedCount: body.jobs.length });
  });

  app.get(
    '/control/jobs',
    { onRequest: [requirePermission('control:read')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const payload = await buildFleetControlJobsPayload(deps);
      return reply.send(payload);
    },
  );

  app.post(
    '/control/jobs/sync',
    { onRequest: [requirePermission('control:read')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      await deps.registry.discoverDevices();
      // Force-refresh every station this control plane knows about, not just the
      // discovery targets: a customer found by enrollment or by a previous sweep is
      // pulled from here as well.
      await deps.registry.syncAllDeviceJobs({ force: true });
      const payload = await buildFleetControlJobsPayload(deps);
      return reply.send(payload);
    },
  );

  app.post(
    '/control/devices/:id/jobs/:jobId/reprint',
    { onRequest: [requirePermission('job:retry')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id, jobId } = req.params as { id: string; jobId: string };
      const body = (req.body ?? {}) as {
        printerId?: string;
        copies?: number;
        reason?: string;
        confirmedDuplicateRisk?: boolean;
      };

      if (body.confirmedDuplicateRisk !== true) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Duplicate-print risk acknowledgement is required',
        });
      }
      if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'A reprint reason is required',
        });
      }
      if (body.copies !== undefined && (!Number.isInteger(body.copies) || body.copies < 1)) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Reprint copies must be a whole number of at least 1',
        });
      }

      const device = await deps.registry.getDevice(id);
      if (!device) {
        return reply.status(404).send({ error: `Device not found: ${id}` });
      }

      const actorId = actor(req);
      const trimmedReason = body.reason.trim();

      // 1. Local PrintOps job execution when the job exists in this instance's repo
      const localOriginal = deps.jobs ? await deps.jobs.findById(jobId) : undefined;
      if (localOriginal && deps.reprintJob) {
        try {
          const created = await deps.reprintJob.execute(
            jobId,
            {
              printerId: body.printerId || localOriginal.printerId,
              copies: body.copies ?? (localOriginal.copies || 1),
              reason: trimmedReason,
              confirmedDuplicateRisk: true,
              confirmedDestinationChange: true,
            },
            actorId,
          );
          const synced = jobToControlSyncedJob(created, id);
          await deps.registry.upsertDeviceJobs(id, [synced]);
          if (deps.audit) {
            await deps.audit.record({
              actor: actorId,
              deviceId: id,
              action: 'job.remote_reprint',
              requestedAt: new Date(),
              terminalState: synced.status,
              metadata: {
                originalJobId: jobId,
                reprintJobId: synced.id,
                copies: synced.copies,
                reason: trimmedReason,
                mode: 'local',
              },
            });
          }
          return reply.status(201).send(synced);
        } catch (err) {
          if (err instanceof AppError) {
            return reply.status(err.statusCode).send({ error: err.code, message: err.message });
          }
          throw err;
        }
      }

      // 2. Forward to reachable remote PrintOps station over HTTP if it has IP addresses
      const hosts = (device.ipAddresses ?? []).map((ip) => ip.trim()).filter(Boolean);
      const stationHeaders = stationPullCredentialHeaders(device);
      for (const host of hosts) {
        const baseUrl = stationBaseUrl(host);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const res = await fetch(
            `${baseUrl}/api/v1/control/local-jobs/${encodeURIComponent(jobId)}/reprint`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...stationHeaders,
              },
              body: JSON.stringify({
                printerId: body.printerId,
                copies: body.copies,
                reason: trimmedReason,
                confirmedDuplicateRisk: true,
                requestedBy: actorId,
              }),
              signal: controller.signal,
            },
          );
          if (res.ok) {
            const remoteCreated = (await res.json()) as ControlSyncedJob;
            const synced: ControlSyncedJob = { ...remoteCreated, deviceId: id };
            await deps.registry.upsertDeviceJobs(id, [synced]);
            if (deps.audit) {
              await deps.audit.record({
                actor: actorId,
                deviceId: id,
                action: 'job.remote_reprint',
                requestedAt: new Date(),
                terminalState: synced.status,
                metadata: {
                  originalJobId: jobId,
                  reprintJobId: synced.id,
                  copies: synced.copies,
                  reason: trimmedReason,
                  mode: 'remote-http',
                },
              });
            }
            return reply.status(201).send(synced);
          }
        } catch {
          // Try next host or fall back to synced snapshot
        } finally {
          clearTimeout(timeout);
        }
      }

      // 3. Fall back to synced job snapshot stored in Web Control
      const syncedJobs = await deps.registry.getDeviceJobs(id);
      const original = syncedJobs.find((job) => job.id === jobId);
      if (!original) {
        return reply.status(404).send({ error: `Job not found on device ${id}: ${jobId}` });
      }

      const nowIso = new Date().toISOString();
      const created: ControlSyncedJob = {
        ...original,
        id: `job_reprint_${generateId()}`,
        deviceId: id,
        requestId: `reprint-${generateId()}`,
        printerId: body.printerId || original.printerId,
        status: 'QUEUED',
        copies: body.copies ?? (original.copies || 1),
        errorCode: undefined,
        errorMessage: undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
        completedAt: undefined,
        finishedAt: undefined,
        latencyMs: undefined,
        reprintOfJobId: original.id,
        reprintOfRequestId: original.requestId,
        reprintReason: trimmedReason,
      };
      await deps.registry.upsertDeviceJobs(id, [created]);
      if (deps.audit) {
        await deps.audit.record({
          actor: actorId,
          deviceId: id,
          action: 'job.remote_reprint',
          requestedAt: new Date(),
          terminalState: created.status,
          metadata: {
            originalJobId: jobId,
            reprintJobId: created.id,
            copies: created.copies,
            reason: trimmedReason,
            mode: 'synced-queue',
          },
        });
      }
      return reply.status(201).send(created);
    },
  );

  // ─── Command Plane ──────────────────────────────────────────────────────────

  app.post(
    '/control/devices/:id/commands',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as {
        type: ControlCommandType;
        targetVersion?: string;
        manifestUrl?: string;
        idempotencyKey?: string;
        expiresInSeconds?: number;
        contentType?: ControlContentKind;
        contentKey?: string;
      };

      const idempotencyKey = body.idempotencyKey || `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let manifestUrl = body.manifestUrl;
      let targetVersion = body.targetVersion;

      if (body.type === 'OTA_CHECK' || body.type === 'OTA_INSTALL' || body.type === 'OTA_DOWNLOAD') {
        const device = await deps.registry.getDevice(id);
        if (!device) return reply.status(404).send({ error: `Device not found: ${id}` });
        const platform = device.platform === 'win32' || device.platform === 'windows'
          ? 'windows-x64'
          : device.platform as 'windows-x64' | 'node-bundle';
        const release = body.type === 'OTA_CHECK'
          ? (await deps.releases.findLatestCompatibleRelease(device))
            ?? (await deps.releases.listReleases({ status: 'AVAILABLE', platform }))
              .find((item) => item.version === device.appVersion && item.schemaVersion === device.schemaVersion)
          : (await deps.releases.listReleases({ status: 'AVAILABLE', platform }))
            .find((item) => item.version === body.targetVersion);
        if (!release) {
          return reply.status(409).send({ error: body.type === 'OTA_CHECK'
            ? 'No available compatible release is registered for this device'
            : 'Target release is unavailable or revoked' });
        }
        const compatibility = deps.releases.isCompatible(release, {
          appVersion: device.appVersion,
          schemaVersion: device.schemaVersion,
          platform,
        });
        const installedReleaseCheck = body.type === 'OTA_CHECK'
          && release.version === device.appVersion
          && release.schemaVersion === device.schemaVersion;
        if (!compatibility.compatible && !installedReleaseCheck) {
          return reply.status(409).send({ error: compatibility.reason });
        }
        manifestUrl = resolveControlManifestUrl(release.manifestRef, req, release.platform);
        if (body.type === 'OTA_CHECK') targetVersion = release.version;
      }

      if (body.type === 'CONTENT_LIST' || body.type === 'CONTENT_PULL') {
        const device = await deps.registry.getDevice(id);
        if (!device) return reply.status(404).send({ error: `Device not found: ${id}` });
        if (!device.capabilities?.includes('content-pull-v1')) {
          return reply.status(409).send({ error: 'CLIENT_UPDATE_REQUIRED', message: 'PrintOps client needs content-pull-v1 support' });
        }
        if (body.type === 'CONTENT_PULL') {
          if (body.contentType !== 'paper-profile' && body.contentType !== 'template') {
            return reply.status(400).send({ error: 'contentType must be paper-profile or template' });
          }
          if (typeof body.contentKey !== 'string' || !body.contentKey.trim() || body.contentKey.trim().length > 128) {
            return reply.status(400).send({ error: 'contentKey must be a non-empty code up to 128 characters' });
          }
        } else if (body.contentType !== undefined || body.contentKey !== undefined) {
          return reply.status(400).send({ error: 'contentType and contentKey are only valid for CONTENT_PULL' });
        }
      }

      const command = await deps.commands.issueCommand({
        deviceId: id,
        type: body.type,
        targetVersion,
        manifestUrl,
        idempotencyKey,
        expiresInSeconds: body.expiresInSeconds,
        requestedBy: actor(req),
        ...(body.type === 'CONTENT_PULL' && body.contentType && body.contentKey
          ? { contentType: body.contentType, contentKey: body.contentKey.trim() }
          : {}),
      });

      return reply.status(202).send(command);
    },
  );

  app.get(
    '/control/devices/:id/commands',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const query = (req.query ?? {}) as { limit?: string };
      const limit = query.limit ? Number(query.limit) : 50;
      const history = await deps.commands.listDeviceCommands(id, limit);
      return reply.send(history.map((command) => {
        const safeCommand = { ...command };
        delete safeCommand.contentPayload;
        delete safeCommand.resultPayload;
        return safeCommand;
      }));
    },
  );

  app.get(
    '/control/devices/:id/commands/:commandId',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id, commandId } = req.params as { id: string; commandId: string };
      const command = await deps.commands.getCommand(commandId);
      if (!command || command.deviceId !== id) return reply.status(404).send({ error: 'Command not found' });
      const safeCommand = { ...command };
      delete safeCommand.contentPayload;
      return reply.send(safeCommand);
    },
  );

  app.post(
    '/control/devices/:id/content-import',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { commandId?: string; code?: string };
      if (!deps.content) return reply.status(503).send({ error: 'Content sync is not configured' });
      if (!body.commandId?.trim()) return reply.status(400).send({ error: 'commandId is required' });
      const command = await deps.commands.getCommand(body.commandId.trim());
      if (!command || command.deviceId !== id || command.type !== 'CONTENT_PULL') {
        return reply.status(404).send({ error: 'Completed content pull command not found' });
      }
      if (command.status !== 'COMPLETED' || !command.resultPayload?.bundle) {
        return reply.status(409).send({ error: 'Content pull has not completed successfully' });
      }
      const device = await deps.registry.getDevice(id);
      if (!device) return reply.status(404).send({ error: `Device not found: ${id}` });
      const result = await deps.content.importClientBundle(command.resultPayload.bundle, {
        importedBy: actor(req),
        ...(body.code?.trim() ? { code: body.code.trim() } : {}),
      });
      if (deps.audit) {
        await deps.audit.record({
          actor: actor(req),
          deviceId: id,
          commandId: command.commandId,
          action: 'content.imported_from_client',
          sourceVersion: device.appVersion,
          requestedAt: new Date(),
          terminalState: 'COMPLETED',
          metadata: {
            kind: result.kind,
            sourceCode: result.sourceCode,
            importedCode: result.importedCode,
            profile: result.profile,
            template: result.template,
          },
        });
      }
      return reply.status(201).send(result);
    },
  );

  // ─── Release Catalog ────────────────────────────────────────────────────────

  app.post(
    '/control/content/publish',
    { onRequest: [requirePermission('control:manage')] },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        kind?: ControlContentKind;
        itemId?: string;
        deviceIds?: string[];
        overwriteExisting?: boolean;
        deploymentId?: string;
      };
      if (body.kind !== 'paper-profile' && body.kind !== 'template') {
        return reply.status(400).send({ error: 'kind must be paper-profile or template' });
      }
      if (!deps.content) return reply.status(503).send({ error: 'Content sync is not configured' });
      if (!body.itemId?.trim()) return reply.status(400).send({ error: 'itemId is required' });
      if (!Array.isArray(body.deviceIds) || body.deviceIds.length === 0 || body.deviceIds.length > 100
        || body.deviceIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
        return reply.status(400).send({ error: 'deviceIds must contain 1 to 100 device identifiers' });
      }
      const deviceIds = [...new Set(body.deviceIds.map((id) => id.trim()))];
      const deploymentId = body.deploymentId?.trim() || `deploy_${randomUUID()}`;
      if (deploymentId.length > 128) return reply.status(400).send({ error: 'deploymentId is too long' });

      const bundle = await deps.content.createBundle({
        kind: body.kind,
        itemId: body.itemId.trim(),
        overwriteExisting: body.overwriteExisting === true,
        publishedBy: actor(req),
      });

      const deployments = await Promise.all(deviceIds.map(async (deviceId) => {
        const device = await deps.registry.getDevice(deviceId);
        if (!device) return { deviceId, status: 'REJECTED', errorCode: 'DEVICE_NOT_FOUND', errorMessage: 'Device is not enrolled' };
        if (!device.capabilities?.includes('content-sync-v1')) {
          return { deviceId, status: 'REJECTED', errorCode: 'CLIENT_UPDATE_REQUIRED', errorMessage: 'PrintOps client needs the content sync update' };
        }
        try {
          const command = await deps.commands.issueCommand({
            deviceId,
            type: 'CONTENT_SYNC',
            targetVersion: bundle.key,
            expiresInSeconds: 900,
            requestedBy: actor(req),
            idempotencyKey: `${deploymentId}:${deviceId}`,
            contentType: bundle.kind,
            contentKey: bundle.key,
            contentPayload: bundle,
          });
          return { deviceId, commandId: command.commandId, status: command.status, contentKey: bundle.key };
        } catch (error) {
          return {
            deviceId,
            status: 'REJECTED',
            errorCode: (error as { code?: string }).code ?? 'COMMAND_REJECTED',
            errorMessage: error instanceof Error ? error.message : String(error),
          };
        }
      }));

      return reply.send({ deploymentId, contentKey: bundle.key, deployments });
    },
  );

  app.get(
    '/control/releases',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = (req.query ?? {}) as { platform?: string; channel?: string; status?: string };
      const releases = await deps.releases.listReleases(query);
      return reply.send(releases);
    },
  );
  app.get(
    '/control/releases/latest',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = (req.query ?? {}) as { platform?: string; channel?: string };
      const release = await deps.releases.findLatestRelease(query);
      if (!release) return reply.status(404).send({ error: 'No available release found' });
      return reply.send(release);
    },
  );

  app.get(
    '/control/releases/latest/download',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = (req.query ?? {}) as { platform?: string; channel?: string; stream?: string; version?: string };
      let release: ReleaseCatalogRecord | null | undefined;
      if (query.version) {
        release = await deps.releases.findReleaseByVersion(query.version, query.platform);
        if (release && release.status === 'REVOKED') {
          return reply.status(403).send({ error: 'Release has been revoked and cannot be downloaded' });
        }
      } else {
        release = await deps.releases.findLatestRelease({
          platform: query.platform,
          channel: query.channel,
        });
      }
      if (!release) return reply.status(404).send({ error: 'No available release found' });
      return serveReleaseArtifact(release, req, reply, deps.audit, deps.storage);
    },
  );

  app.get(
    '/control/releases/download',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = (req.query ?? {}) as { platform?: string; channel?: string; stream?: string; version?: string };
      let release: ReleaseCatalogRecord | null | undefined;
      if (query.version) {
        release = await deps.releases.findReleaseByVersion(query.version, query.platform);
        if (release && release.status === 'REVOKED') {
          return reply.status(403).send({ error: 'Release has been revoked and cannot be downloaded' });
        }
      } else {
        release = await deps.releases.findLatestRelease({
          platform: query.platform,
          channel: query.channel,
        });
      }
      if (!release) return reply.status(404).send({ error: 'No available release found' });
      return serveReleaseArtifact(release, req, reply, deps.audit, deps.storage);
    },
  );

  app.get(
    '/control/releases/:id/download',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const release = await deps.releases.getRelease(id);
      if (!release) return reply.status(404).send({ error: 'Release not found' });
      if (release.status === 'REVOKED') {
        return reply.status(403).send({ error: 'Release has been revoked and cannot be downloaded' });
      }
      return serveReleaseArtifact(release, req, reply, deps.audit, deps.storage);
    },
  );
  app.post(
    '/control/releases',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as CreateReleaseCatalogInput;
      const created = await deps.releases.registerRelease(body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/control/releases/lts',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = (req.query ?? {}) as { platform?: string };
      const release = await deps.releases.findLtsRelease(query.platform);
      if (!release) return reply.status(404).send({ error: 'No LTS release found' });
      return reply.send(release);
    },
  );

  app.patch(
    '/control/releases/:id',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as {
        status?: ReleaseRecordStatus;
        channel?: 'stable' | 'beta' | 'rc' | 'lts';
        releaseNotes?: string;
        isLts?: boolean;
        isLatest?: boolean;
        artifactRef?: string;
        sha256?: string;
        schemaVersion?: number;
      };
      if (body.schemaVersion !== undefined) {
        const release = await deps.releases.getRelease(id);
        if (!release) return reply.status(404).send({ error: 'Release not found' });
        if (!isHostedManifestRef(release.manifestRef) || existsSync(hostedManifestPath(release))) {
          return reply.status(409).send({ error: 'Database schema can only be corrected on releases with a generated manifest' });
        }
      }
      const updated = await deps.releases.updateRelease(id, body);
      return reply.send(updated);
    },
  );

  app.post(
    '/control/releases/:id/set-latest',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const updated = await deps.releases.setLatestRelease(id);
      return reply.send(updated);
    },
  );

  app.post(
    '/control/releases/:id/set-lts',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { isLts?: boolean };
      const updated = await deps.releases.setLtsRelease(id, body.isLts !== false);
      return reply.send(updated);
    },
  );

  app.post(
    '/control/releases/import',
    {
      onRequest: [requirePermission('control:manage')],
      // Base64 JSON needs about one third more space than the installer itself.
      bodyLimit: importBodyLimit,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = (req.body ?? {}) as {
        filename?: string;
        artifactBase64?: string;
        artifactUrl?: string;
        artifactPath?: string;
        version?: string;
        channel?: 'stable' | 'beta' | 'rc' | 'lts';
        platform?: 'windows-x64' | 'node-bundle';
        architecture?: 'x64' | 'arm64';
        schemaVersion?: number;
        sha256?: string;
        signature?: string;
        minSupportedVersion?: string;
        releaseNotes?: string;
        isLts?: boolean;
        isLatest?: boolean;
        signedManifest?: unknown;
      };

      const releasesDir = process.env['PRINTOPS_RELEASES_DIR'] || resolve(process.cwd(), 'data/releases');
      mkdirSync(releasesDir, { recursive: true });

      let artifactRef = body.artifactUrl ?? body.artifactPath ?? '';
      let sha256 = body.sha256 ?? '';

      if (body.artifactBase64) {
        const buffer = Buffer.from(body.artifactBase64, 'base64');
        const filename = body.filename || `PrintOps_Setup_v${body.version || 'unknown'}_${body.platform || 'windows-x64'}.exe`;
        if (deps.storage) {
          const stored = await deps.storage.saveArtifact(filename, buffer);
          artifactRef = stored.artifactRef;
          sha256 = stored.sha256;
        } else {
          const releasesDir = process.env['PRINTOPS_RELEASES_DIR'] || resolve(process.cwd(), 'data/releases');
          mkdirSync(releasesDir, { recursive: true });
          sha256 = createHash('sha256').update(buffer).digest('hex');
          const destPath = join(releasesDir, filename);
          writeFileSync(destPath, buffer);
          artifactRef = destPath;
        }
      } else if (body.artifactPath && existsSync(body.artifactPath)) {
        if (!sha256) {
          const fileBuf = readFileSync(body.artifactPath);
          sha256 = createHash('sha256').update(fileBuf).digest('hex');
        }
        artifactRef = resolve(body.artifactPath);
      } else if (!artifactRef) {
        return reply.status(400).send({ error: 'Either artifactBase64, artifactPath, or artifactUrl must be provided' });
      }

      let version = body.version?.trim();
      if (!version && body.filename) {
        const match = body.filename.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);
        if (match) version = match[1];
      }
      if (!version) {
        return reply.status(400).send({ error: 'version is required or must be present in filename' });
      }

      if (!sha256) {
        const manifest = body.signedManifest === undefined ? undefined : parseReleaseManifestEnvelope(body.signedManifest).manifest;
        const platform = body.platform ?? 'windows-x64';
        sha256 = manifest?.artifacts[platform === 'windows-x64' ? 'desktop' : 'api']?.[platform]?.sha256
          ?? createHash('sha256').update(artifactRef).digest('hex');
      }

      const platform = body.platform ?? 'windows-x64';
      const manifestRef = `/api/v1/control/releases/${version}${platform === 'node-bundle' ? '/node-bundle' : ''}/manifest.json`;
      const manifestEntry = body.signedManifest === undefined ? undefined
        : validateHostedManifest(body.signedManifest, { version, platform, schemaVersion: body.schemaVersion ?? 8, sha256 });
      const signature = manifestEntry?.signature || body.signature?.trim() || `sig_auto_${sha256.slice(0, 32)}`;
      const isLts = Boolean(body.isLts || body.channel === 'lts');
      const channel = body.channel ?? (isLts ? 'lts' : 'stable');

      const created = await deps.releases.registerRelease({
        version,
        channel,
        platform,
        architecture: body.architecture ?? 'x64',
        schemaVersion: body.schemaVersion ?? 8,
        manifestRef,
        artifactRef,
        sha256,
        signature,
        minSupportedVersion: body.minSupportedVersion ?? '0.1.0',
        releaseNotes: body.releaseNotes,
        isLts,
        isLatest: body.isLatest,
      });

      if (body.signedManifest !== undefined) saveHostedManifest(created, body.signedManifest);

      return reply.status(201).send(created);
    },
  );

  app.put('/control/releases/:id/manifest', { onRequest: [requirePermission('control:manage')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const release = await deps.releases.getRelease(id);
    if (!release) return reply.status(404).send({ error: 'Release not found' });
    if (release.status !== 'AVAILABLE') return reply.status(409).send({ error: 'Release is not available' });
    if (!isHostedManifestRef(release.manifestRef)) {
      return reply.status(409).send({ error: 'This release uses an external manifest URL' });
    }
    const { signedManifest } = (req.body ?? {}) as { signedManifest?: unknown };
    // Older URL-only imports hashed the URL text because no file bytes were
    // available. Replace only that recognizable placeholder with the manifest's
    // content hash; real file checksums must always match, never be overwritten.
    const legacyUrlChecksum = /^https?:\/\//.test(release.artifactRef)
      && release.signature.startsWith('sig_auto_')
      && release.sha256 === createHash('sha256').update(release.artifactRef).digest('hex');
    const manifest = legacyUrlChecksum ? parseReleaseManifestEnvelope(signedManifest).manifest : undefined;
    const sha256 = manifest?.artifacts[release.platform === 'windows-x64' ? 'desktop' : 'api']?.[release.platform]?.sha256 ?? release.sha256;
    validateHostedManifest(signedManifest, { ...release, sha256 });
    saveHostedManifest(release, signedManifest);
    if (sha256 !== release.sha256) await deps.releases.updateRelease(id, { sha256 });
    return reply.send({ manifestRef: release.manifestRef });
  });

  // Published OTA files are fetched by the updater without an operator JWT.
  // Only AVAILABLE catalog entries are served. Uploaded installers need no
  // accompanying manifest: metadata is derived from their stored file details.
  for (const path of ['/control/releases/:version/:filename', '/control/releases/:version/:platform/:filename']) {
    app.get(path, async (req, reply) => {
      const { version, filename, platform } = req.params as { version: string; filename: string; platform?: string };
      const release = await deps.releases.findReleaseByVersion(version, platform ?? 'windows-x64');
      if (!release || !isHostedManifestRef(release.manifestRef)) return reply.status(404).send({ error: 'Release not found' });
      if (release.status !== 'AVAILABLE') return reply.status(403).send({ error: 'Release is not available' });
      const manifestPath = hostedManifestPath(release);
      const envelope: unknown = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, 'utf8'))
        : await generatedReleaseManifest(release, deps);
      const parsed = parseReleaseManifestEnvelope(envelope).manifest;
      const entry = parsed.artifacts[release.platform === 'windows-x64' ? 'desktop' : 'api']?.[release.platform];
      if (!entry) return reply.status(404).send({ error: 'Artifact not found' });
      reply.header('Cache-Control', 'no-store');
      if (filename === 'manifest.json') return reply.send(envelope);
      if (filename !== entry.url || filename === '.' || filename === '..') {
        return reply.status(404).send({ error: 'Artifact not found in signed manifest' });
      }
      return serveReleaseArtifact(release, req, reply, undefined, deps.storage);
    });
  }

  // ─── Audit Logs ─────────────────────────────────────────────────────────────

  app.get(
    '/control/audit',
    { onRequest: [requirePermission('control:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!deps.audit) {
        return reply.send([]);
      }
      const query = (req.query ?? {}) as { deviceId?: string; limit?: string; offset?: string };
      const limit = query.limit ? Number(query.limit) : 50;
      const offset = query.offset ? Number(query.offset) : 0;

      if (query.deviceId) {
        const logs = await deps.audit.findByDeviceId(query.deviceId, { limit, offset });
        return reply.send(logs);
      }
      const logs = await deps.audit.findAll({ limit, offset });
      return reply.send(logs);
    },
  );

  app.get(
    '/control/storage-settings',
    { onRequest: [requirePermission('control:manage')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      if (!deps.storage) {
        return reply.status(503).send({ error: 'Storage service is not configured' });
      }
      return reply.send(deps.storage.getConfig());
    },
  );

  app.patch(
    '/control/storage-settings',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!deps.storage) {
        return reply.status(503).send({ error: 'Storage service is not configured' });
      }
      const body = (req.body ?? {}) as {
        provider?: 'local' | 'minio';
        localPath?: string;
        minio?: Partial<MinioStorageConfig>;
      };
      const updated = await deps.storage.updateConfig(body);
      return reply.send(updated);
    },
  );

  app.post(
    '/control/storage-settings/test',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!deps.storage) {
        return reply.status(503).send({ error: 'Storage service is not configured' });
      }
      const body = (req.body ?? {}) as {
        provider?: 'local' | 'minio';
        localPath?: string;
        minio?: Partial<MinioStorageConfig>;
      };
      const result = await deps.storage.testConnection(body);
      return reply.send(result);
    },
  );
}

function isHostedManifestRef(ref: string): boolean {
  return /^\/(?:api\/)?v1\/control\/releases\/[^/]+\/(?:node-bundle\/)?manifest\.json$/.test(ref);
}

async function generatedReleaseManifest(release: ReleaseCatalogRecord, deps: ControlRoutesDeps) {
  const metadata = deps.storage
    ? await deps.storage.getArtifactMetadata(release.artifactRef)
    : { size: statSync(release.artifactRef).size };
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0) throw new ValidationError('Installer file is empty or unavailable');
  let sha256 = release.sha256;
  if (metadata.sha256 && metadata.sha256 !== sha256) {
    const legacyPlaceholder = release.signature.startsWith('sig_auto_')
      && sha256 === createHash('sha256').update(release.artifactRef).digest('hex');
    if (!legacyPlaceholder) throw new ValidationError('Installer checksum does not match the registered release');
    sha256 = metadata.sha256;
    await deps.releases.updateRelease(release.id, { sha256 });
  }
  const component = release.platform === 'windows-x64' ? 'desktop' : 'api';
  return {
    schema_version: 1,
    release: { version: release.version, channel: release.channel === 'lts' ? 'stable' : release.channel,
      release_date: release.createdAt.toISOString(), notes: release.releaseNotes ?? '' },
    artifacts: { [component]: { [release.platform]: {
      url: getArtifactFilename(release), size: metadata.size, sha256,
      format: release.platform === 'windows-x64' ? 'nsis-installer' : 'archive',
    } } },
    compatibility: { min_supported_version: release.minSupportedVersion ?? '0.1.0', schema_version: release.schemaVersion },
    rollout: { staged: false, rollout_percentage: 100 },
  };
}

function hostedManifestPath(release: Pick<ReleaseCatalogRecord, 'id'>): string {
  const directory = process.env['PRINTOPS_RELEASES_DIR'] || resolve(process.cwd(), 'data/releases');
  return join(directory, `${encodeURIComponent(release.id)}.manifest.json`);
}

function validateHostedManifest(input: unknown, release: Pick<ReleaseCatalogRecord, 'version' | 'platform' | 'schemaVersion' | 'sha256'>) {
  let parsed: ReturnType<typeof parseReleaseManifestEnvelope>;
  try {
    if (Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8') > 1_048_576) throw new Error('Manifest exceeds 1 MiB');
    parsed = parseReleaseManifestEnvelope(input);
  } catch {
    throw new ValidationError('signedManifest must be a valid signed OTA manifest envelope (at most 1 MiB)');
  }
  const entry = parsed.manifest.artifacts[release.platform === 'windows-x64' ? 'desktop' : 'api']?.[release.platform];
  if (Buffer.from(parsed.signature, 'base64').length !== 64 || !entry || Buffer.from(entry.signature, 'base64').length !== 64) {
    throw new ValidationError('signedManifest must include Ed25519 manifest and artifact signatures from the release build');
  }
  if (parsed.manifest.release.version !== release.version || parsed.manifest.compatibility.schemaVersion !== release.schemaVersion
    || entry.sha256 !== release.sha256.toLowerCase()) {
    throw new ValidationError('signedManifest version, schema and artifact SHA-256 must match the release');
  }
  // Relative installer URLs must be a sibling filename so the signed payload
  // can stay byte-for-byte unchanged while this host serves the uploaded file.
  if (!/^[a-zA-Z0-9_. -]+$/.test(entry.url) || entry.url === '.' || entry.url === '..' || entry.url === 'manifest.json') {
    let url: URL;
    try { url = new URL(entry.url); } catch { throw new ValidationError('Manifest artifact URL must be a sibling filename or absolute http(s) URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ValidationError('Manifest artifact URL must be a sibling filename or absolute http(s) URL without credentials');
    }
  }
  return entry;
}

function saveHostedManifest(release: ReleaseCatalogRecord, envelope: unknown): void {
  const directory = process.env['PRINTOPS_RELEASES_DIR'] || resolve(process.cwd(), 'data/releases');
  mkdirSync(directory, { recursive: true });
  const destination = hostedManifestPath(release);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(envelope));
  renameSync(temporary, destination);
}

function resolveControlManifestUrl(manifestRef: string, req: FastifyRequest, platform: ReleaseCatalogRecord['platform']): string {
  // Resolve only local references. Absolute catalog URLs still go through the
  // command service's protocol/credential validation without being rewritten.
  if (!manifestRef.startsWith('/') || /^\/[\\/]/.test(manifestRef)) return manifestRef;
  const publicUrl = process.env['PRINTOPS_CONTROL_PUBLIC_HTTP_URL'] || `${req.protocol}://${req.hostname}`;
  let origin: URL;
  try {
    origin = new URL(publicUrl);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid origin');
  } catch {
    throw new ValidationError('PRINTOPS_CONTROL_PUBLIC_HTTP_URL must be an absolute http(s) origin without credentials');
  }
  // Releases imported by older control planes used the frontend's /v1 path.
  let path = manifestRef.startsWith('/v1/control/releases/') ? `/api${manifestRef}` : manifestRef;
  if (platform === 'node-bundle' && /\/releases\/[^/]+\/manifest\.json$/.test(path)) {
    path = path.replace(/\/manifest\.json$/, '/node-bundle/manifest.json');
  }
  return new URL(path, origin).href;
}

function getArtifactFilename(release: ReleaseCatalogRecord): string {
  const ext = release.platform === 'windows-x64' ? '.exe' : '.tar.gz';
  const urlOrPath = release.artifactRef;
  const noQuery = urlOrPath.split('?')[0] ?? urlOrPath;
  const parts = noQuery.split(/[/\\]/);
  const candidate = parts[parts.length - 1];
  if (candidate && candidate.includes('.') && candidate.includes(release.version)) {
    return candidate;
  }
  return `PrintOps_Setup_v${release.version}_${release.platform}${ext}`;
}

async function serveReleaseArtifact(
  release: ReleaseCatalogRecord,
  req: FastifyRequest,
  reply: FastifyReply,
  audit?: ControlAuditRepositoryPort,
  storage?: ReleaseStorageService,
): Promise<void> {
  const filename = getArtifactFilename(release);
  const query = (req.query ?? {}) as { stream?: string };
  const isUrl = release.artifactRef.startsWith('http://') || release.artifactRef.startsWith('https://');

  if (audit) {
    await audit.record({
      actor: actor(req),
      deviceId: 'release-catalog',
      action: 'release.downloaded',
      sourceVersion: release.version,
      requestedAt: new Date(),
      terminalState: 'COMPLETED',
      metadata: {
        releaseId: release.id,
        version: release.version,
        platform: release.platform,
        artifactRef: release.artifactRef,
        filename,
      },
    });
  }
  if (storage) {
    try {
      const res = await storage.getArtifactStream(release.artifactRef);
      if (res.redirectUrl) {
        return reply.redirect(res.redirectUrl, 302);
      }
      if (res.stream) {
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('Content-Type', 'application/octet-stream');
        if (res.size) {
          reply.header('Content-Length', res.size);
        }
        return reply.send(res.stream);
      }
    } catch (err) {
      if (!isUrl) {
        return reply.status(404).send({
          error: `Artifact file not found: ${release.artifactRef}`,
        });
      }
    }
  }
  if (isUrl) {
    if (query.stream === 'true') {
      try {
        const upstream = await fetch(release.artifactRef);
        if (!upstream.ok) {
          return reply.status(502).send({
            error: `Failed to fetch release artifact: upstream returned HTTP ${upstream.status}`,
          });
        }
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
        const contentLength = upstream.headers.get('content-length');
        if (contentLength) {
          reply.header('Content-Length', contentLength);
        }
        return reply.send(upstream.body ? Readable.fromWeb(upstream.body as unknown as WebReadableStream) : null);
      } catch (err) {
        return reply.status(502).send({
          error: `Failed to stream release artifact: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    return reply.redirect(release.artifactRef, 302);
  }

  // Local file path
  const candidatePaths = [
    release.artifactRef,
    resolve(process.cwd(), release.artifactRef),
  ];
  let foundPath: string | null = null;
  for (const p of candidatePaths) {
    if (existsSync(p)) {
      foundPath = p;
      break;
    }
  }

  if (foundPath) {
    const stat = statSync(foundPath);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Length', stat.size);
    return reply.send(createReadStream(foundPath));
  }

  return reply.status(404).send({
    error: `Artifact file not found: ${release.artifactRef}`,
  });
}

const ACTIVE_QUEUE_STATUSES = new Set(['ACCEPTED', 'VALIDATED', 'QUEUED', 'DISPATCHED', 'PRINTING']);
const ATTENTION_STATUSES = new Set(['UNVERIFIED', 'TIMEOUT']);

async function buildFleetControlJobsPayload(deps: ControlRoutesDeps) {
  let devices = await deps.registry.listDevices();

  if (deps.jobs) {
    const localJobs = await deps.jobs.findAll({ limit: 500 });
    if (localJobs.length > 0) {
      const localId = deps.localDeviceId?.();
      const localInst = deps.localInstallationId?.() ?? 'local-printops';
      let targetDevice: DeviceRecord | undefined = devices.find(
        (d) => (localId && d.deviceId === localId) || d.installationId === localInst,
      );
      if (!targetDevice) {
        targetDevice = await deps.registry.autoRegisterDevice({
          installationId: localInst,
          hostname: os.hostname(),
          platform: process.platform === 'win32' ? 'windows-x64' : process.platform,
          architecture: process.arch,
          appVersion: process.env['PRINTOPS_APP_VERSION'] ?? '0.1.32',
          schemaVersion: CURRENT_SCHEMA_VERSION,
          capabilities: [...LOCAL_CONTROL_CAPABILITIES],
          preserveDisplayName: true,
        });
        devices = await deps.registry.listDevices();
      }
      const syncedLocal = localJobs.map((job) => jobToControlSyncedJob(job, targetDevice!.deviceId));
      await deps.registry.upsertDeviceJobs(targetDevice.deviceId, syncedLocal);
    }
  }

  let totalJobs = 0;
  let queuedJobs = 0;
  let successJobs = 0;
  let attentionJobs = 0;
  let failedJobs = 0;
  let onlineDevices = 0;
  let offlineDevices = 0;

  const errorMap = new Map<string, {
    deviceId: string;
    deviceName: string;
    errorCode: string;
    errorMessage?: string;
    count: number;
    latestAt: string;
  }>();

  const deviceEntries = await Promise.all(
    devices.map(async (device) => {
      if (device.connectionState === 'ONLINE') onlineDevices += 1;
      else offlineDevices += 1;

      const [latestRelease, jobs] = await Promise.all([
        deps.releases.findLatestCompatibleRelease(device),
        deps.registry.getDeviceJobs(device.deviceId),
      ]);

      let devQueued = 0;
      let devSuccess = 0;
      let devAttention = 0;
      let devFailed = 0;
      const payloadKeySet = new Set<string>();
      let latestError: {
        jobId: string;
        status: string;
        errorCode?: string;
        errorMessage?: string;
        occurredAt: string;
      } | null = null;

      for (const job of jobs) {
        for (const key of Object.keys(job.payload ?? {})) {
          payloadKeySet.add(key);
        }

        if (ACTIVE_QUEUE_STATUSES.has(job.status)) {
          devQueued += 1;
        } else if (job.status === 'SUCCESS') {
          devSuccess += 1;
        } else if (job.status === 'FAILED') {
          devFailed += 1;
        } else if (ATTENTION_STATUSES.has(job.status) || (job.status !== 'CANCELLED' && job.status !== 'DUPLICATE_RETURNED')) {
          devAttention += 1;
        }

        const isErrorRow = job.status === 'FAILED'
          || job.status === 'TIMEOUT'
          || job.status === 'UNVERIFIED'
          || Boolean(job.errorCode)
          || Boolean(job.errorMessage);
        if (isErrorRow) {
          const occurredAt = job.finishedAt ?? job.completedAt ?? job.createdAt;
          if (!latestError || Date.parse(occurredAt) > Date.parse(latestError.occurredAt)) {
            latestError = {
              jobId: job.id,
              status: job.status,
              ...(job.errorCode ? { errorCode: job.errorCode } : {}),
              ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
              occurredAt,
            };
          }
          const errCode = job.errorCode || job.status;
          const mapKey = `${device.deviceId}::${errCode}`;
          const prev = errorMap.get(mapKey);
          const deviceName = device.displayName || device.hostname;
          if (prev) {
            prev.count += 1;
            if (Date.parse(occurredAt) > Date.parse(prev.latestAt)) {
              prev.latestAt = occurredAt;
              if (job.errorMessage) prev.errorMessage = job.errorMessage;
            }
          } else {
            errorMap.set(mapKey, {
              deviceId: device.deviceId,
              deviceName,
              errorCode: errCode,
              ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
              count: 1,
              latestAt: occurredAt,
            });
          }
        }
      }

      totalJobs += jobs.length;
      queuedJobs += devQueued;
      successJobs += devSuccess;
      attentionJobs += devAttention;
      failedJobs += devFailed;

      return {
        ...device,
        latestCompatibleVersion: latestRelease?.version ?? null,
        hasUpdateAvailable: latestRelease !== null,
        stats: {
          totalJobs: jobs.length,
          queuedJobs: devQueued,
          successJobs: devSuccess,
          attentionJobs: devAttention,
          failedJobs: devFailed,
          lastJobAt: jobs[0]?.createdAt ?? null,
          latestError,
        },
        payloadKeys: Array.from(payloadKeySet).sort((a, b) => a.localeCompare(b)),
        jobs,
      };
    }),
  );

  const errorBreakdown = Array.from(errorMap.values()).sort(
    (a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt),
  );

  return {
    syncedAt: new Date().toISOString(),
    summary: {
      totalDevices: devices.length,
      onlineDevices,
      offlineDevices,
      totalJobs,
      queuedJobs,
      successJobs,
      attentionJobs,
      failedJobs,
      errorBreakdown,
    },
    devices: deviceEntries,
  };
}
