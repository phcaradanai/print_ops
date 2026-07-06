import type { FastifyInstance } from 'fastify';
import type { ExportJobsService } from '../services/export-jobs.service.js';

export async function exportRoutes(
  app: FastifyInstance,
  deps: { exportJobs: ExportJobsService }
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
}
