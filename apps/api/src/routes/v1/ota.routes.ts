import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ArtifactComponent,
  ArtifactPlatform,
  ControlCommandProgress,
  ControlContentKind,
} from '@printerops/domain';
import type {
  DownloadUpdateRequest,
  DownloadUpdateResult,
  OtaArtifactDownloadProgress,
  OtaExternalOutcome,
  OtaUpdateServicePort,
} from '../../services/ota-update.service.js';
import type { ControlContentSyncService } from '../../services/control-content-sync.service.js';
import type { LocalControlDeviceInfo } from '../../services/control-device-info.service.js';
import { PassThrough } from 'node:stream';
import { AppError, ValidationError } from '@printerops/shared';
import { requireInternalToken, requirePermissionOrInternal } from './permission-guard.js';
function sendProgressStream<T, P = ControlCommandProgress>(
  reply: FastifyReply,
  operation: (onProgress: (progress: P) => void | Promise<void>) => Promise<T>,
): FastifyReply {
  const stream = new PassThrough();
  reply.header('content-type', 'application/x-ndjson; charset=utf-8');
  reply.send(stream);
  const writeEvent = (event: unknown) => {
    if (!stream.destroyed) stream.write(`${JSON.stringify(event)}\n`);
  };
  void operation((progress) => writeEvent({ type: 'progress', progress }))
    .then((result) => {
      writeEvent({ type: 'result', result });
      stream.end();
    })
    .catch((error: unknown) => {
      writeEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      stream.end();
    });
  return reply;
}

export async function otaRoutes(
  app: FastifyInstance,
  deps: {
    service: OtaUpdateServicePort & { getPrintSystemStatus(): Promise<{ state: 'IDLE' | 'PRINTING' | 'PAUSED' | 'ERROR'; queueDepth: number; readiness: string }> };
    internalToken?: string;
    contentSync?: ControlContentSyncService;
    deviceInfo?: () => LocalControlDeviceInfo;
    onControlAgentHeartbeat?: () => void;
  },
): Promise<void> {
  app.get('/ota/status', { onRequest: [requirePermissionOrInternal('ota:read', deps.internalToken)] }, async (_req, reply) => {
    try {
      return reply.send(await deps.service.getStatus());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/check', { onRequest: [requirePermissionOrInternal('ota:manage', deps.internalToken)] }, async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const manifestUrl = body?.['manifestUrl'];
      if (manifestUrl !== undefined && typeof manifestUrl !== 'string') {
        throw new ValidationError('manifestUrl must be a string');
      }
      return reply.send(await deps.service.checkForUpdate(manifestUrl as string | undefined));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/download', { onRequest: [requirePermissionOrInternal('ota:manage', deps.internalToken)] }, async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const version = typeof body?.['version'] === 'string' ? body['version'] : '';
      const component = body?.['component'];
      const platform = body?.['platform'];
      const manifestUrl = body?.['manifestUrl'];
      if (!version.trim()) throw new ValidationError('version is required');
      if (component !== undefined && typeof component !== 'string') {
        throw new ValidationError('component must be a string');
      }
      if (platform !== undefined && typeof platform !== 'string') {
        throw new ValidationError('platform must be a string');
      }
      if (manifestUrl !== undefined && typeof manifestUrl !== 'string') {
        throw new ValidationError('manifestUrl must be a string');
      }
      const downloadRequest: DownloadUpdateRequest = {
        version,
        ...(component !== undefined ? { component: component as ArtifactComponent } : {}),
        ...(platform !== undefined ? { platform: platform as ArtifactPlatform } : {}),
        ...(manifestUrl !== undefined ? { manifestUrl } : {}),
      };
      if (String(req.headers.accept ?? '').includes('application/x-ndjson')) {
        return sendProgressStream<DownloadUpdateResult, OtaArtifactDownloadProgress>(reply, (onProgress) =>
          deps.service.downloadUpdate({ ...downloadRequest, onProgress }));
      }
      return reply.send(await deps.service.downloadUpdate(downloadRequest));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/install', { onRequest: [requirePermissionOrInternal('ota:manage', deps.internalToken)] }, async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const version = typeof body?.['version'] === 'string' ? body['version'] : '';
      const component = body?.['component'];
      const platform = body?.['platform'];
      const manifestUrl = body?.['manifestUrl'];
      if (!version.trim()) throw new ValidationError('version is required');
      if (component !== undefined && typeof component !== 'string') {
        throw new ValidationError('component must be a string');
      }
      if (platform !== undefined && typeof platform !== 'string') {
        throw new ValidationError('platform must be a string');
      }
      if (manifestUrl !== undefined && typeof manifestUrl !== 'string') {
        throw new ValidationError('manifestUrl must be a string');
      }
      return reply.send(await deps.service.installUpdate({
        version,
        ...(component !== undefined ? { component: component as ArtifactComponent } : {}),
        ...(platform !== undefined ? { platform: platform as ArtifactPlatform } : {}),
        ...(manifestUrl !== undefined ? { manifestUrl } : {}),
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/rollback', { onRequest: [requirePermissionOrInternal('ota:manage', deps.internalToken)] }, async (_req, reply) => {
    try {
      return reply.send(await deps.service.rollbackUpdate());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/ota/print-status', { onRequest: [requireInternalToken(deps.internalToken)] }, async (_req, reply) => {
    try {
      return reply.send(await deps.service.getPrintSystemStatus());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/ota/device-info', { onRequest: [requireInternalToken(deps.internalToken)] }, async (_req, reply) => {
    return reply.send(deps.deviceInfo?.() ?? { capabilities: ['ota'] });
  });


  app.post('/ota/control-agent-heartbeat', { onRequest: [requireInternalToken(deps.internalToken)] }, async (_req, reply) => {
    if (!deps.onControlAgentHeartbeat) {
      return reply.status(503).send({ error: 'Control-agent heartbeat reporting is not configured' });
    }
    deps.onControlAgentHeartbeat();
    return reply.send({ accepted: true });
  });
  app.post('/ota/content-sync', { onRequest: [requireInternalToken(deps.internalToken)] }, async (req, reply) => {
    if (!deps.contentSync) return reply.status(503).send({ error: 'Content sync is not configured' });
    try {
      if (String(req.headers.accept ?? '').includes('application/x-ndjson')) {
        return sendProgressStream(reply, (onProgress) =>
          deps.contentSync!.applyBundle(req.body, onProgress));
      }
      const result = await deps.contentSync.applyBundle(req.body);
      return reply.send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/ota/content-index', { onRequest: [requireInternalToken(deps.internalToken)] }, async (_req, reply) => {
    if (!deps.contentSync) return reply.status(503).send({ error: 'Content sync is not configured' });
    try {
      return reply.send(await deps.contentSync.createClientContentIndex());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/content-export', { onRequest: [requireInternalToken(deps.internalToken)] }, async (req, reply) => {
    if (!deps.contentSync) return reply.status(503).send({ error: 'Content sync is not configured' });
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const kind = body?.['kind'];
      const code = typeof body?.['code'] === 'string' ? body['code'].trim() : '';
      if (kind !== 'paper-profile' && kind !== 'template') {
        throw new ValidationError('kind must be paper-profile or template');
      }
      if (!code || code.length > 128) throw new ValidationError('code must be a non-empty content code up to 128 characters');
      return reply.send(await deps.contentSync.createClientContentBundle(kind as ControlContentKind, code));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Local-only callback used by the external updater after it has restarted
  // the application. It cannot be called with a dashboard JWT or from LAN;
  // the per-installation token and loopback guard form a separate recovery
  // boundary from operator-facing OTA controls.
  app.post('/ota/recovery', { onRequest: [requireInternalToken(deps.internalToken)] }, async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const operationId = typeof body?.['operation_id'] === 'string' ? body['operation_id'].trim() : '';
      const version = typeof body?.['version'] === 'string' ? body['version'].trim() : '';
      const state = body?.['state'];
      const errorMessage = body?.['error_message'];
      if (!operationId || operationId.length > 128) throw new ValidationError('operation_id is required');
      if (!version) throw new ValidationError('version is required');
      if (!['COMPLETED', 'ROLLED_BACK', 'INSTALL_FAILED', 'HEALTH_CHECK_FAILED', 'ROLLBACK_FAILED'].includes(String(state))) {
        throw new ValidationError('state is not a supported external OTA outcome');
      }
      if (errorMessage !== undefined && typeof errorMessage !== 'string') {
        throw new ValidationError('error_message must be a string');
      }
      await deps.service.recordExternalOutcome({
        operationId,
        version,
        state: state as OtaExternalOutcome['state'],
        ...(typeof errorMessage === 'string' ? { errorMessage: errorMessage.slice(0, 500) } : {}),
      });
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ValidationError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message, details: error.details });
  }
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
}
