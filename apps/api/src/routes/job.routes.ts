import type { FastifyInstance } from 'fastify';
import type { CreatePrintJobService } from '../services/create-print-job.service.js';
import type { ExecuteJobService } from '../services/execute-job.service.js';
import type { JobRepositoryPort, TraceRepositoryPort } from '@printerops/domain';
import { redactJob, redactJobs } from './job-redaction.js';

export async function jobRoutes(
  app: FastifyInstance,
  deps: {
    jobs: JobRepositoryPort;
    traces: TraceRepositoryPort;
    createJob: CreatePrintJobService;
    executeJob: ExecuteJobService;
  }
): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/jobs', auth, async (req) => {
    const { status, limit, offset } = req.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };
    const jobs = await deps.jobs.findAll({
      status: status as import('@printerops/domain').JobStatus | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return redactJobs(jobs);
  });

  app.post('/jobs', auth, async (req, reply) => {
    const actor = (req.user as { sub: string }).sub;
    const job = await deps.createJob.execute(req.body as Parameters<typeof deps.createJob.execute>[0], actor);
    return reply.status(201).send(job);
  });

  app.get('/jobs/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await deps.jobs.findById(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    return redactJob(job);
  });

  app.get('/jobs/:id/trace', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const trace = await deps.traces.findByJobId(id);
    if (!trace) return reply.status(404).send({ error: 'Trace not found' });
    return trace;
  });

  app.post('/jobs/:id/execute', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { runnerId } = req.body as { runnerId: string };
    const job = await deps.executeJob.execute(id, runnerId);
    return reply.send(job);
  });
}
