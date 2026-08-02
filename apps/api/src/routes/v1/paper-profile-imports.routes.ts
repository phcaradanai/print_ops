import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ImportPaperProfileService } from '../../services/import-paper-profile.service.js';
import { actor, requirePermission } from './permission-guard.js';
import { AppError, ValidationError } from '@printerops/shared';
import { ImageParseError } from '../../services/image-parser.js';

export async function paperProfileImportRoutes(
  app: FastifyInstance,
  deps: {
    importService: ImportPaperProfileService;
  },
): Promise<void> {
  // POST /api/v1/paper-profile-imports/analyze
  app.post(
    '/paper-profile-imports/analyze',
    {
      onRequest: [requirePermission('paper-profile:create')],
      bodyLimit: 12 * 1024 * 1024,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await deps.importService.analyze(req.body as Parameters<typeof deps.importService.analyze>[0]);
        return reply.send(result);
      } catch (err: unknown) {
        return handleError(reply, err);
      }
    },
  );

  // POST /api/v1/paper-profile-imports
  app.post(
    '/paper-profile-imports',
    {
      onRequest: [requirePermission('paper-profile:create')],
      bodyLimit: 12 * 1024 * 1024,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = req.body as Parameters<typeof deps.importService.import>[0];
        const result = await deps.importService.import(body, actor(req));
        if (result.duplicate) {
          return reply.status(200).send(result);
        }
        return reply.status(201).send(result);
      } catch (err: unknown) {
        return handleError(reply, err);
      }
    },
  );

  // GET /api/v1/paper-profiles/:id/artwork
  app.get(
    '/paper-profiles/:id/artwork',
    { onRequest: [requirePermission('paper-profile:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = req.params as { id: string };
        const artwork = await deps.importService.getArtwork(id);
        return reply.send(artwork);
      } catch (err: unknown) {
        return handleError(reply, err);
      }
    },
  );
}

function handleError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ImageParseError) {
    return reply.status(400).send({ error: err.code, message: err.message });
  }
  if (err instanceof ValidationError) {
    return reply.status(400).send({
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({
      error: err.code,
      message: err.message,
    });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message,
  });
}
