import type { FastifyInstance } from 'fastify';
import type { AcceptExternalJobService } from '../../services/accept-external-job.service.js';
import type { CancelJobService } from '../../services/cancel-job.service.js';
import type { ExecuteJobService } from '../../services/execute-job.service.js';
import type { JobRepositoryPort, TraceRepositoryPort, ServiceAccount } from '@printerops/domain';

type ReqWithServiceAccount = { serviceAccount: ServiceAccount };

export async function v1PrintJobRoutes(
  app: FastifyInstance,
  deps: {
    jobs: JobRepositoryPort;
    traces: TraceRepositoryPort;
    acceptExternalJob: AcceptExternalJobService;
    cancelJob: CancelJobService;
    executeJob: ExecuteJobService;
    apiKeyHook: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
): Promise<void> {
  const guard = { onRequest: [deps.apiKeyHook] };

  // POST /api/v1/print-jobs — accept from external integration program
  app.post('/print-jobs', { onRequest: [deps.apiKeyHook] }, async (req, reply) => {
    const sa = (req as unknown as ReqWithServiceAccount).serviceAccount;
    const body = req.body as {
      request_id: string;
      source_system?: string;
      source_reference?: string;
      printer_code: string;
      template_code?: string;
      payload: Record<string, unknown>;
      copies?: number;
      priority?: import('@printerops/domain').JobPriority;
      metadata?: Record<string, unknown>;
    };

    if (!body.request_id) return reply.status(400).send({ error: 'request_id is required' });
    if (!body.printer_code) return reply.status(400).send({ error: 'printer_code is required' });

    // Service account printer allowlist check
    if (
      sa.allowedPrinterCodes.length > 0 &&
      !sa.allowedPrinterCodes.includes(body.printer_code)
    ) {
      return reply.status(403).send({ error: `printer_code '${body.printer_code}' not allowed for this service account` });
    }

    const result = await deps.acceptExternalJob.execute(
      {
        request_id: body.request_id,
        source_system: body.source_system ?? sa.sourceSystem,
        source_reference: body.source_reference,
        printer_code: body.printer_code,
        template_code: body.template_code,
        payload: body.payload ?? {},
        copies: body.copies,
        priority: body.priority,
        metadata: body.metadata,
      },
      sa.id
    );

    const status = result.duplicate ? 200 : 201;
    return reply.status(status).send(result);
  });

  // GET /api/v1/print-jobs — list with optional ?status=&limit=&offset=
  app.get('/print-jobs', guard, async (req, reply) => {
    const { status, limit, offset } = req.query as { status?: string; limit?: string; offset?: string };
    const jobs = await deps.jobs.findAll({
      status: status as import('@printerops/domain').JobStatus | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return reply.send(jobs);
  });

  // GET /api/v1/print-jobs/:id
  app.get('/print-jobs/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await deps.jobs.findById(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    return job;
  });

  // GET /api/v1/print-jobs/by-request-id/:requestId?source_system=...
  app.get('/print-jobs/by-request-id/:requestId', guard, async (req, reply) => {
    const { requestId } = req.params as { requestId: string };
    const { source_system } = req.query as { source_system?: string };
    const sa = (req as unknown as ReqWithServiceAccount).serviceAccount;
    const sourceSystem = source_system ?? sa.sourceSystem;
    const job = await deps.acceptExternalJob.getJobByRequestId(requestId, sourceSystem);
    if (!job) return reply.status(404).send({ error: 'Job not found for given request_id' });
    return job;
  });

  // POST /api/v1/print-jobs/:id/cancel
  app.post('/print-jobs/:id/cancel', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const sa = (req as unknown as ReqWithServiceAccount).serviceAccount;
    const job = await deps.cancelJob.execute(id, sa.id);
    return reply.send(job);
  });

  // GET /api/v1/print-jobs/:id/trace
  app.get('/print-jobs/:id/trace', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const trace = await deps.traces.findByJobId(id);
    if (!trace) return reply.status(404).send({ error: 'Trace not found' });
    return trace;
  });
}
