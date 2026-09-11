import type { FastifyInstance } from 'fastify';
import type { ExportJobsService } from '../services/export-jobs.service.js';
import type { AuditRepositoryPort, PrinterRepositoryPort } from '@printerops/domain';
import type { InMemoryExportAdapter } from '../infra/export/in-memory-export.adapter.js';

export async function exportRoutes(
  app: FastifyInstance,
  deps: {
    exportJobs: ExportJobsService;
    audit: AuditRepositoryPort;
    printers: PrinterRepositoryPort;
    exporter: InMemoryExportAdapter;
  }
): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/exports/jobs.csv', auth, async (_req, reply) => {
    const csv = await deps.exportJobs.execute('csv');
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="jobs.csv"')
      .send(csv);
  });

  app.get('/exports/jobs.json', auth, async () => {
    return deps.exportJobs.execute('json');
  });

  app.get('/exports/audit.csv', auth, async (_req, reply) => {
    const logs = await deps.audit.findAll({ limit: 100000 });
    const csv = await deps.exporter.exportAuditLogs(logs, 'csv');
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="audit.csv"')
      .send(csv);
  });

  app.get('/exports/printers.csv', auth, async (_req, reply) => {
    const printers = await deps.printers.findAll({ limit: 10000 });
    const csv = await deps.exporter.exportPrinters(printers, 'csv');
    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="printer-status.csv"')
      .send(csv);
  });
}
