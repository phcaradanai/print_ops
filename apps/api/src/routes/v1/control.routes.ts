import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ControlAuditRepositoryPort,
  ControlCommandType,
  ControlContentKind,
  CreateReleaseCatalogInput,
  DeviceEnrollmentRequest,
  ReleaseRecordStatus,
} from '@printerops/domain';
import type { WebControlRegistryService } from '../../services/web-control-registry.service.js';
import type { ControlCommandService } from '../../services/control-command.service.js';
import type { ReleaseCatalogService } from '../../services/release-catalog.service.js';
import type { ControlContentSyncService } from '../../services/control-content-sync.service.js';
import { requirePermission, actor } from './permission-guard.js';
import { randomUUID } from 'node:crypto';

export interface ControlRoutesDeps {
  registry: WebControlRegistryService;
  commands: ControlCommandService;
  releases: ReleaseCatalogService;
  audit?: ControlAuditRepositoryPort;
  content?: ControlContentSyncService;
}

export async function controlRoutes(
  app: FastifyInstance,
  deps: { prefix?: string } & ControlRoutesDeps,
): Promise<void> {
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
          version: release.version,
          channel: release.channel,
          schemaVersion: release.schemaVersion,
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

  app.post(
    '/control/releases',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as CreateReleaseCatalogInput;
      const created = await deps.releases.registerRelease(body);
      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/control/releases/:id',
    { onRequest: [requirePermission('control:manage')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { status: ReleaseRecordStatus };
      const updated = await deps.releases.updateReleaseStatus(id, body.status);
      return reply.send(updated);
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
}
