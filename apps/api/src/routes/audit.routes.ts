import type { FastifyInstance } from 'fastify';
import type { AuditRepositoryPort } from '@printerops/domain';

export async function auditRoutes(
  app: FastifyInstance,
  deps: { audit: AuditRepositoryPort }
): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/audit-logs', auth, async (req) => {
    const { resourceType, resourceId, limit, offset } = req.query as {
      resourceType?: string;
      resourceId?: string;
      limit?: string;
      offset?: string;
    };
    return deps.audit.findAll({
      resourceType,
      resourceId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  });
}
