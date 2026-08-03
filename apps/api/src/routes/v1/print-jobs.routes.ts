import type { FastifyInstance } from 'fastify';
import type { AcceptExternalJobService } from '../../services/accept-external-job.service.js';
import type { CancelJobService } from '../../services/cancel-job.service.js';
import type { ExecuteJobService } from '../../services/execute-job.service.js';
import type { JobRepositoryPort, TraceRepositoryPort, ServiceAccount, IntakeAttemptRepositoryPort } from '@printerops/domain';
import { AppError } from '@printerops/shared';
import { redactJob, redactJobs } from '../job-redaction.js';
import type { IntakeOutcomeCallbackService } from '../../services/intake-outcome-callback.service.js';

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
    intakeLog?: IntakeAttemptRepositoryPort;
    intakeCallbacks?: IntakeOutcomeCallbackService;
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
      /** Optional webhook endpoint that receives this job's terminal print
       *  result. Omitting it preserves the existing contract exactly. */
      endpoint_code?: string;
    };

    const rejectEarly = async (reason: string, errorCode = 'VALIDATION_ERROR') => {
      void deps.intakeLog?.record({
        source: 'api',
        outcome: 'rejected',
        reason,
        requestId: body.request_id,
        sourceSystem: body.source_system ?? sa.sourceSystem,
        sourceReference: body.source_reference,
        codeTemplate: body.template_code,
        printerCode: body.printer_code,
      });
      await deps.intakeCallbacks?.notifyRejected({
        endpointCode: body.endpoint_code,
        sourceSystem: body.source_system ?? sa.sourceSystem,
        requestId: body.request_id,
        sourceReference: body.source_reference,
        intakeTransport: 'API',
        stage: 'VALIDATION',
        errorCode,
        errorMessage: reason,
        intakePayload: body.payload ?? {},
      }).catch(() => false);
    };

    if (!body.request_id) {
      await rejectEarly('request_id is required');
      return reply.status(400).send({ error: 'request_id is required' });
    }
    if (!body.printer_code) {
      await rejectEarly('printer_code is required');
      return reply.status(400).send({ error: 'printer_code is required' });
    }

    // Service account printer allowlist check
    if (
      sa.allowedPrinterCodes.length > 0 &&
      !sa.allowedPrinterCodes.includes(body.printer_code)
    ) {
      const reason = `printer_code '${body.printer_code}' not allowed for this service account`;
      await rejectEarly(reason, 'FORBIDDEN');
      return reply.status(403).send({ error: reason });
    }

    try {
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
          endpoint_code: body.endpoint_code,
        },
        sa.id
      );

      const status = result.duplicate ? 200 : 201;
      return reply.status(status).send(result);
    } catch (err: unknown) {
      await deps.intakeCallbacks?.notifyRejected({
        endpointCode: body.endpoint_code,
        sourceSystem: body.source_system ?? sa.sourceSystem,
        requestId: body.request_id,
        sourceReference: body.source_reference,
        intakeTransport: 'API',
        stage: 'INTAKE',
        errorCode: err instanceof AppError ? err.code : 'INTERNAL_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
        intakePayload: body.payload ?? {},
      }).catch(() => false);
      // Structured client errors (an unknown template_code, an endpoint_code the
      // caller may not use, a callback URL the SSRF guard refused) must come
      // back as the 4xx they are, with their code, rather than a bare 500.
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // GET /api/v1/print-jobs — list with optional ?status=&limit=&offset=
  app.get('/print-jobs', guard, async (req, reply) => {
    const { status, limit, offset } = req.query as { status?: string; limit?: string; offset?: string };
    const jobs = await deps.jobs.findAll({
      status: status as import('@printerops/domain').JobStatus | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return reply.send(redactJobs(jobs));
  });

  // GET /api/v1/print-jobs/:id
  app.get('/print-jobs/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await deps.jobs.findById(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    return redactJob(job);
  });

  // GET /api/v1/print-jobs/by-request-id/:requestId?source_system=...
  app.get('/print-jobs/by-request-id/:requestId', guard, async (req, reply) => {
    const { requestId } = req.params as { requestId: string };
    const { source_system } = req.query as { source_system?: string };
    const sa = (req as unknown as ReqWithServiceAccount).serviceAccount;
    const sourceSystem = source_system ?? sa.sourceSystem;
    const job = await deps.acceptExternalJob.getJobByRequestId(requestId, sourceSystem);
    if (!job) return reply.status(404).send({ error: 'Job not found for given request_id' });
    return redactJob(job);
  });

  // POST /api/v1/print-jobs/:id/cancel
  app.post('/print-jobs/:id/cancel', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const sa = (req as unknown as ReqWithServiceAccount).serviceAccount;
    const job = await deps.cancelJob.execute(id, sa.id);
    return reply.send(redactJob(job));
  });

  // GET /api/v1/print-jobs/:id/trace
  app.get('/print-jobs/:id/trace', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const trace = await deps.traces.findByJobId(id);
    if (!trace) return reply.status(404).send({ error: 'Trace not found' });
    return trace;
  });
}
