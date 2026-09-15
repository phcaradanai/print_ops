import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ExportJobsService } from '../../services/export-jobs.service.js';
import type { AuditRepositoryPort } from '@printerops/domain';
import type { InMemoryExportAdapter } from '../../infra/export/in-memory-export.adapter.js';

export async function v1ExportRoutes(
  app: FastifyInstance,
  deps: {
    exportJobs: ExportJobsService;
    audit: AuditRepositoryPort;
    exporter: InMemoryExportAdapter;
    apiKeyHook: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
): Promise<void> {
  const guard = { onRequest: [deps.apiKeyHook] };

  app.get('/exports/jobs.csv', guard, async (_req, reply) => {
    const csv = await deps.exportJobs.execute('csv');
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="jobs.csv"')
      .send(csv);
  });

  app.get('/exports/jobs.json', guard, async () => {
    return deps.exportJobs.execute('json');
  });

  app.get('/exports/audit.csv', guard, async (_req, reply) => {
    const logs = await deps.audit.findAll({ limit: 100000 });
    const csv = await deps.exporter.exportAuditLogs(logs, 'csv');
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="audit.csv"')
      .send(csv);
  });
}
