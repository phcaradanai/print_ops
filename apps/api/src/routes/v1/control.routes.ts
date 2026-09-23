import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ControlAuditRepositoryPort,
  ControlCommandType,
  CreateReleaseCatalogInput,
  DeviceEnrollmentRequest,
  ReleaseRecordStatus,
} from '@printerops/domain';
import type { WebControlRegistryService } from '../../services/web-control-registry.service.js';
import type { ControlCommandService } from '../../services/control-command.service.js';
import type { ReleaseCatalogService } from '../../services/release-catalog.service.js';
import { requirePermission, actor } from './permission-guard.js';

export interface ControlRoutesDeps {
  registry: WebControlRegistryService;
  commands: ControlCommandService;
  releases: ReleaseCatalogService;
  audit?: ControlAuditRepositoryPort;
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

      const latestRelease = await deps.releases.findLatestCompatibleRelease(device);
      return reply.send({
        ...device,
        latestCompatibleVersion: latestRelease?.version ?? null,
        latestCompatibleRelease: latestRelease ?? null,
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
        idempotencyKey?: string;
        expiresInSeconds?: number;
      };

      const idempotencyKey = body.idempotencyKey || `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const command = await deps.commands.issueCommand({
        deviceId: id,
        type: body.type,
        targetVersion: body.targetVersion,
        idempotencyKey,
        expiresInSeconds: body.expiresInSeconds,
        requestedBy: actor(req),
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
      return reply.send(history);
    },
  );

  // ─── Release Catalog ────────────────────────────────────────────────────────

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
