import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ArtifactComponent,
  ArtifactPlatform,
} from '@printerops/domain';
import type { OtaUpdateServicePort } from '../../services/ota-update.service.js';
import { AppError, ValidationError } from '@printerops/shared';
import { requirePermission } from './permission-guard.js';

export async function otaRoutes(
  app: FastifyInstance,
  deps: { service: OtaUpdateServicePort },
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
