import type { FastifyInstance } from 'fastify';
import type { AuditRepositoryPort } from '@printerops/domain';
import { requirePermission } from './v1/permission-guard.js';

// An unparameterized request must not return the entire history — on the
// SQLite repo an undefined limit becomes `LIMIT -1` (unbounded), and audit
// rows accumulate forever with no retention policy (see pruneOldRecords in
// infra/db/retention.ts). Cap it the same way a paginated UI would.
const DEFAULT_AUDIT_LOG_LIMIT = 200;
const MAX_AUDIT_LOG_LIMIT = 1000;

export async function auditRoutes(
  app: FastifyInstance,
  deps: { audit: AuditRepositoryPort }
): Promise<void> {
  // Previously guarded only by `app.authenticate` — any logged-in user,
  // including VIEWER, could read the full audit trail without an explicit
  // audit:read permission check.
  const read = { onRequest: [requirePermission('audit:read')] };

  app.get('/audit-logs', read, async (req) => {
    const { resourceType, resourceId, limit, offset } = req.query as {
      resourceType?: string;
      resourceId?: string;
      limit?: string;
      offset?: string;
    };
    const requestedLimit = limit ? Number(limit) : DEFAULT_AUDIT_LOG_LIMIT;
    const safeLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_AUDIT_LOG_LIMIT)
      : DEFAULT_AUDIT_LOG_LIMIT;
    return deps.audit.findAll({
      resourceType,
      resourceId,
      limit: safeLimit,
      offset: offset ? Number(offset) : undefined,
    });
  });
}
