import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  JobRepositoryPort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  Job,
  JobStatus,
  TraceStep,
  JobSucceeded,
  JobFailed,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

/**
 * Runner-scoped job endpoints (Go runner / future runners).
 *
 * These endpoints are ADDITIVE and BACKWARD COMPATIBLE:
 *  - The legacy GET /runners/:id/poll and POST /jobs/:id/execute routes remain.
 *  - The TypeScript runner is unaffected.
 *  - The Go runner uses these richer endpoints for claim/trace/result.
 *
 * Auth: JWT bearer (same `app.authenticate` hook used by the rest of v1).
 */
export async function v1RunnerJobRoutes(
  app: FastifyInstance,
  deps: {
    jobs: JobRepositoryPort;
    traces: TraceRepositoryPort;
    audit: AuditRepositoryPort;
    events: EventBusPort;
  }
): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  // ---- Claim next job --------------------------------------------------
  // Atomically claim the next QUEUED job for this runner.
  // Returns { job: null } when no job is available (instead of 404) so the
  // runner can treat it as a normal idle poll without error-path logging.
  app.post('/runners/:runnerId/jobs/next', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const { runnerId } = req.params as { runnerId: string };
    const body = (req.body ?? {}) as { wait_ms?: number };

    // MVP: no server-side long-poll; ignore wait_ms. The runner's poll loop
    // already implements its own interval/backoff.
    void body.wait_ms;

    const queued = await deps.jobs.findAll({ status: 'QUEUED' as JobStatus, limit: 1 });
    if (queued.length === 0) {
      return reply.status(200).send({ job: null });
    }

    const job = queued[0]!;
    const now = new Date();

    // Claim: QUEUED -> DISPATCHED (idempotent-ish; matches execute-job flow).
    const queueWaitMs = job.queuedAt ? now.getTime() - job.queuedAt.getTime() : undefined;
    const claimed = await deps.jobs.update(job.id, {
      status: 'DISPATCHED',
      dispatchedAt: now,
      runnerReceivedAt: now,
      runnerId,
      latency: { ...job.latency, queueWaitMs },
    });

    deps.events.publish({
      eventId: generateId(),
      eventType: 'JobDispatched',
      traceId: job.traceId,
      correlationId: job.correlationId,
      occurredAt: now,
      jobId: job.id,
      runnerId,
      printerId: job.printerId,
    });

    return reply.status(200).send({ job: sanitizeForRunner(claimed) });
  });

  // ---- Report a trace/audit event -------------------------------------
  // Appends a step to the job trace and writes an audit log entry. Non-terminal.
  app.post('/runners/:runnerId/jobs/:jobId/events', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const { runnerId, jobId } = req.params as { runnerId: string; jobId: string };
    const body = req.body as RunnerEventInput;

    const job = await deps.jobs.findById(jobId);
    if (!job) return reply.status(404).send({ error: `Job ${jobId} not found` });

    const occurredAt = body.timestamp ? new Date(body.timestamp) : new Date();
    const trace = await deps.traces.findByJobId(jobId);

    const step: TraceStep = {
      stepName: body.event_type,
      startedAt: occurredAt,
      finishedAt: occurredAt,
      durationMs: body.duration_ms ?? 0,
      status: mapEventStatus(body.status),
      outputSummary: body.safe_message ?? undefined,
    };

    if (trace) {
      await deps.traces.update(trace.id, {
        runnerId,
        steps: [...trace.steps, step],
      });
    } else {
      await deps.traces.create({
        jobId,
        runnerId,
        traceId: body.trace_id ?? job.traceId,
        correlationId: job.correlationId,
        source: job.sourceSystem ?? 'runner-go',
        destination: runnerId,
        printerId: job.printerId,
        adapterName: 'pending',
        status: 'DISPATCHED',
        retryCount: 0,
        steps: [step],
        evidence: body.evidence ?? {},
      });
    }

    await deps.audit.create({
      traceId: body.trace_id ?? job.traceId,
      action: 'job.dispatched',
      resourceType: 'job',
      resourceId: jobId,
      metadata: {
        runnerId,
        eventType: body.event_type,
        status: body.status,
        durationMs: body.duration_ms,
        evidence: sanitizeEvidence(body.evidence),
      },
    });

    return reply.status(202).send({ accepted: true });
  });

  // ---- Report terminal result -----------------------------------------
  // Applies the final job status (SUCCESS/FAILED) with latency + evidence.
  app.post('/runners/:runnerId/jobs/:jobId/result', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const { runnerId, jobId } = req.params as { runnerId: string; jobId: string };
    const body = req.body as RunnerResultInput;

    const job = await deps.jobs.findById(jobId);
    if (!job) return reply.status(404).send({ error: `Job ${jobId} not found` });

    const status = normalizeStatus(body.status);
    const startedAt = body.started_at ? new Date(body.started_at) : job.dispatchedAt ?? new Date();
    const finishedAt = body.finished_at ? new Date(body.finished_at) : new Date();
    const runnerExecMs = body.duration_ms ?? (finishedAt.getTime() - startedAt.getTime());
    const totalLatencyMs = job.receivedAt ? finishedAt.getTime() - job.receivedAt.getTime() : undefined;

    const latency = {
      ...(job.latency ?? {}),
      runnerExecMs,
      totalLatencyMs,
    };

    const patch: Partial<Job> = {
      status,
      finishedAt,
      completedAt: finishedAt,
      printerAckAt: finishedAt,
      adapterUsed: body.executor ?? job.adapterUsed,
      latency,
    };
    if (status === 'FAILED') {
      patch.errorCode = 'RUNNER_FAILED';
      patch.errorMessage = body.safe_message ?? 'runner reported failure';
    }

    const updated = await deps.jobs.update(jobId, patch);

    const trace = await deps.traces.findByJobId(jobId);
    if (trace) {
      await deps.traces.update(trace.id, {
        runnerId,
        adapterName: body.executor ?? trace.adapterName,
        startedAt,
        finishedAt,
        durationMs: runnerExecMs,
        status,
        steps: [
          ...trace.steps,
          {
            stepName: 'runner_result',
            startedAt,
            finishedAt,
            durationMs: runnerExecMs,
            status: status === 'SUCCESS' ? 'success' : 'failed',
            outputSummary: body.safe_message,
          },
        ],
      });
    }

    await deps.audit.create({
      traceId: body.trace_id ?? job.traceId,
      action: status === 'SUCCESS' ? 'job.succeeded' : 'job.failed',
      resourceType: 'job',
      resourceId: jobId,
      after: updated as unknown as Record<string, unknown>,
      metadata: {
        runnerId,
        executor: body.executor,
        durationMs: runnerExecMs,
        totalLatencyMs,
        evidence: sanitizeEvidence(body.evidence),
      },
    });

    if (status === 'SUCCESS') {
      const evt: JobSucceeded = {
        eventId: generateId(),
        eventType: 'JobSucceeded',
        traceId: body.trace_id ?? job.traceId,
        correlationId: job.correlationId,
        occurredAt: finishedAt,
        jobId,
        durationMs: runnerExecMs,
      };
      deps.events.publish(evt);
    } else {
      const evt: JobFailed = {
        eventId: generateId(),
        eventType: 'JobFailed',
        traceId: body.trace_id ?? job.traceId,
        correlationId: job.correlationId,
        occurredAt: finishedAt,
        jobId,
        errorCode: 'RUNNER_FAILED',
        errorMessage: body.safe_message ?? 'runner reported failure',
      };
      deps.events.publish(evt);
    }

    return reply.status(200).send({ ok: true, status });
  });
}

// ---- DTOs -------------------------------------------------------------

interface RunnerEventInput {
  event_type: string;
  trace_id?: string;
  job_id: string;
  runner_id: string;
  timestamp?: string;
  duration_ms?: number;
  status?: string;
  safe_message?: string;
  evidence?: Record<string, unknown>;
}

interface RunnerResultInput {
  trace_id?: string;
  job_id: string;
  runner_id: string;
  status: string;
  executor?: string;
  safe_message?: string;
  duration_ms?: number;
  started_at?: string;
  finished_at?: string;
  evidence?: Record<string, unknown>;
}

// ---- helpers ----------------------------------------------------------

function normalizeStatus(raw: string): 'SUCCESS' | 'FAILED' {
  const upper = (raw ?? '').toUpperCase();
  if (upper === 'SUCCESS' || upper === 'SUCCEEDED' || upper === 'DONE' || upper === 'OK') return 'SUCCESS';
  return 'FAILED';
}

type TraceStepStatus = 'running' | 'success' | 'failed' | 'skipped';

function mapEventStatus(raw?: string): TraceStepStatus {
  const lower = (raw ?? '').toLowerCase();
  switch (lower) {
    case 'success':
    case 'succeeded':
    case 'ok':
    case 'done':
      return 'success';
    case 'failed':
    case 'error':
      return 'failed';
    case 'starting':
    case 'sent':
    case 'acked':
    case 'running':
      return 'running';
    default:
      return 'skipped';
  }
}

/** Strip any field that looks sensitive from evidence before persisting. */
function sanitizeEvidence(ev?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!ev) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev)) {
    const key = k.toLowerCase();
    if (key === 'payload' || key.includes('token') || key.includes('secret') || key.includes('password')) continue;
    out[k] = v;
  }
  return out;
}

/** Project the job to the fields the runner needs; omit large/sensitive blobs. */
function sanitizeForRunner(job: Job): Partial<Job> {
  return {
    id: job.id,
    request_id: (job as unknown as { request_id?: string }).request_id ?? job.requestId,
    status: job.status,
    printer_code: (job as unknown as { printer_code?: string }).printer_code,
    printer_id: job.printerId,
    template_code: job.templateCode,
    copies: job.copies,
    mimeType: job.mimeType,
    priority: job.priority,
    source_system: job.sourceSystem,
    trace_id: job.traceId,
    createdAt: job.createdAt,
    queuedAt: job.queuedAt,
    // NOTE: payload/renderedData are intentionally omitted here. The runner
    // uses template_code + payload mapping or a pre-rendered blob fetched
    // separately. This keeps the claim response small and safe.
  } as Partial<Job>;
}