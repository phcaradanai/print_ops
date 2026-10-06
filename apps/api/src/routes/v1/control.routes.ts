import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ControlAuditRepositoryPort,
  ControlCommandType,
  ControlContentKind,
  CreateReleaseCatalogInput,
  DeviceEnrollmentRequest,
  ReleaseCatalogRecord,
  ReleaseRecordStatus,
} from '@printerops/domain';
import type { WebControlRegistryService } from '../../services/web-control-registry.service.js';
import type { ControlCommandService } from '../../services/control-command.service.js';
import type { ReleaseCatalogService } from '../../services/release-catalog.service.js';
import type { ControlContentSyncService } from '../../services/control-content-sync.service.js';
import type { ReleaseStorageService, MinioStorageConfig } from '../../services/release-storage.service.js';
import { requirePermission, actor } from './permission-guard.js';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export interface ControlRoutesDeps {
  registry: WebControlRegistryService;
  commands: ControlCommandService;
  releases: ReleaseCatalogService;
  audit?: ControlAuditRepositoryPort;
  content?: ControlContentSyncService;
  storage?: ReleaseStorageService;
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
        appVersion: body.appVersion || '0.1.31',
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
        manifestUrl = release.manifestRef;
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
      };
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
        sha256 = createHash('sha256').update(artifactRef).digest('hex');
      }

      const signature = body.signature?.trim() || `sig_auto_${sha256.slice(0, 32)}`;
      const manifestRef = `/v1/control/releases/${version}/manifest.json`;
      const platform = body.platform ?? 'windows-x64';
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

      return reply.status(201).send(created);
    },
  );

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
