import type { FastifyInstance } from 'fastify';
import type { CreatePrintJobService } from '../services/create-print-job.service.js';
import type { ExecuteJobService } from '../services/execute-job.service.js';
import type { JobRepositoryPort, TraceRepositoryPort } from '@printerops/domain';
import { redactJob, redactJobs } from './job-redaction.js';
import { requirePermission } from './v1/permission-guard.js';
import type { ReprintJobService, ReprintJobInput } from '../services/reprint-job.service.js';
import { AppError } from '@printerops/shared';

export async function jobRoutes(
  app: FastifyInstance,
  deps: {
    jobs: JobRepositoryPort;
    traces: TraceRepositoryPort;
    createJob: CreatePrintJobService;
    executeJob: ExecuteJobService;
    reprintJob: ReprintJobService;
  }
): Promise<void> {
  // These legacy internal-dashboard routes previously only checked
  // `app.authenticate` (valid JWT), not role permission — any logged-in user,
  // including VIEWER, could create/execute jobs. Guard each route with the
  // same permission model the newer v1 routes already use.
  const read = { onRequest: [requirePermission('job:read')] };
  const create = { onRequest: [requirePermission('job:create')] };
  const reprint = { onRequest: [requirePermission('job:retry')] };
  const traceRead = { onRequest: [requirePermission('trace:read')] };

  app.get('/jobs', read, async (req) => {
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

  app.post('/jobs', create, async (req, reply) => {
    const actor = (req.user as { sub: string }).sub;
    const job = await deps.createJob.execute(req.body as Parameters<typeof deps.createJob.execute>[0], actor);
    return reply.status(201).send(job);
  });

  app.get('/jobs/:id', read, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await deps.jobs.findById(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    return redactJob(job);
  });

  app.post('/jobs/:id/reprint', reprint, async (req, reply) => {
    const { id } = req.params as { id: string };
    const actor = (req.user as { sub: string }).sub;
    try {
      const job = await deps.reprintJob.execute(id, req.body as ReprintJobInput, actor);
      return reply.status(201).send(job);
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.get('/jobs/:id/trace', traceRead, async (req, reply) => {
    const { id } = req.params as { id: string };
    const trace = await deps.traces.findByJobId(id);
    if (!trace) return reply.status(404).send({ error: 'Trace not found' });
    return trace;
  });

  // Called by the runner (and legacy dashboard) to dispatch a claimed job;
  // requires job:create so the same trust level that can create a job can
  // also trigger its execution (OWNER/ADMIN/OPERATOR — not VIEWER).
  app.post('/jobs/:id/execute', create, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { runnerId } = req.body as { runnerId: string };
    const job = await deps.executeJob.execute(id, runnerId);
    return reply.send(job);
  });
}
