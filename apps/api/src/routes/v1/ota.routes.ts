import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ArtifactComponent,
  ArtifactPlatform,
} from '@printerops/domain';
import type { OtaExternalOutcome, OtaUpdateServicePort } from '../../services/ota-update.service.js';
import { AppError, ValidationError } from '@printerops/shared';
import { requireInternalToken, requirePermission } from './permission-guard.js';

export async function otaRoutes(
  app: FastifyInstance,
  deps: { service: OtaUpdateServicePort; internalToken?: string },
): Promise<void> {
  app.get('/ota/status', { onRequest: [requirePermission('ota:read')] }, async (_req, reply) => {
    try {
      return reply.send(await deps.service.getStatus());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/check', { onRequest: [requirePermission('ota:manage')] }, async (_req, reply) => {
    try {
      return reply.send(await deps.service.checkForUpdate());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/download', { onRequest: [requirePermission('ota:manage')] }, async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const version = typeof body?.['version'] === 'string' ? body['version'] : '';
      const component = body?.['component'];
      const platform = body?.['platform'];
      if (!version.trim()) throw new ValidationError('version is required');
      if (component !== undefined && typeof component !== 'string') {
        throw new ValidationError('component must be a string');
      }
      if (platform !== undefined && typeof platform !== 'string') {
        throw new ValidationError('platform must be a string');
      }
      return reply.send(await deps.service.downloadUpdate({
        version,
        ...(component !== undefined ? { component: component as ArtifactComponent } : {}),
        ...(platform !== undefined ? { platform: platform as ArtifactPlatform } : {}),
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/install', { onRequest: [requirePermission('ota:manage')] }, async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const version = typeof body?.['version'] === 'string' ? body['version'] : '';
      const component = body?.['component'];
      const platform = body?.['platform'];
      if (!version.trim()) throw new ValidationError('version is required');
      if (component !== undefined && typeof component !== 'string') {
        throw new ValidationError('component must be a string');
      }
      if (platform !== undefined && typeof platform !== 'string') {
        throw new ValidationError('platform must be a string');
      }
      return reply.send(await deps.service.installUpdate({
        version,
        ...(component !== undefined ? { component: component as ArtifactComponent } : {}),
        ...(platform !== undefined ? { platform: platform as ArtifactPlatform } : {}),
      }));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/ota/rollback', { onRequest: [requirePermission('ota:manage')] }, async (_req, reply) => {
    try {
      return reply.send(await deps.service.rollbackUpdate());
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
