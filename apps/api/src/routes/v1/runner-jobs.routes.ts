import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  JobRepositoryPort,
  PrinterRepositoryPort,
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
import { emitPrintJobTerminal } from '../../services/emit-terminal-event.js';

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
    printers: PrinterRepositoryPort;
    traces: TraceRepositoryPort;
    audit: AuditRepositoryPort;
    events: EventBusPort;
  }
): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  // ---- Claim next job --------------------------------------------------
  // Claim the next QUEUED job for this runner via a conditional write, so two
  // runners polling in the same tick cannot both be handed the same job and
  // both print it.
  // Returns { job: null } when no job is available (instead of 404) so the
  // runner can treat it as a normal idle poll without error-path logging.
  app.post('/runners/:runnerId/jobs/next', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const { runnerId } = req.params as { runnerId: string };
    const body = (req.body ?? {}) as { wait_ms?: number };

    // MVP: no server-side long-poll; ignore wait_ms. The runner's poll loop
    // already implements its own interval/backoff.
    void body.wait_ms;

    // Fetch a handful, not one: with two runners and a full queue, losing the
    // claim race on the single candidate used to waste a whole poll interval.
    // Try each until a claim sticks (LOW-7).
    const candidates = orderQueuedCandidates(
      await deps.jobs.findAll({ status: 'QUEUED' as JobStatus }),
    ).slice(0, 5);
    if (candidates.length === 0) {
      return reply.status(200).send({ job: null });
    }

    let claimed: Job | undefined;
    for (const candidate of candidates) {
      const now = new Date();
      // Claim: QUEUED -> DISPATCHED, conditional on the job still being QUEUED.
      // Losing the race is a normal idle poll, not an error.
      const queueWaitMs = candidate.queuedAt ? now.getTime() - candidate.queuedAt.getTime() : undefined;
      const got = await deps.jobs.claim(candidate.id, ['QUEUED' as JobStatus], {
        status: 'DISPATCHED',
        dispatchedAt: now,
        runnerReceivedAt: now,
        runnerId,
        latency: { ...candidate.latency, queueWaitMs },
      });
      if (got) {
        claimed = got;
        break;
      }
    }
    if (!claimed) {
      return reply.status(200).send({ job: null });
    }

    deps.events.publish({
      eventId: generateId(),
      eventType: 'JobDispatched',
      traceId: claimed.traceId,
      correlationId: claimed.correlationId,
      occurredAt: claimed.dispatchedAt ?? new Date(),
      jobId: claimed.id,
      runnerId,
      printerId: claimed.printerId,
    });

    // Include printer protocol + connectionUri so the runner can select the
    // correct executor (fake, windows-spooler, raw-tcp-9100, etc.).
    const printer = claimed.printerId ? await deps.printers.findById(claimed.printerId) : undefined;

    return reply.status(200).send({ job: sanitizeForRunner(claimed), printer: printer ? {
      id: printer.id,
      code: printer.code,
      protocol: printer.protocol,
      connectionUri: printer.connectionUri,
    } : undefined });
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

    let status = normalizeStatus(body.status);
    const printer = job.printerId ? await deps.printers.findById(job.printerId) : undefined;
    const executionContext = {
      executor: body.executor,
      evidence: body.evidence,
      printerProtocol: printer?.protocol,
    };
    const windowsExecutor = isWindowsSpoolerExecution(executionContext);
    const deviceConfirmed = hasDeviceConfirmation(body.evidence);
    const ippJobConfirmed = hasIppJobConfirmation(body.evidence);
    const windowsPrintConfirmed = deviceConfirmed && ippJobConfirmed;
    status = enforceWindowsSpoolerConfirmation(status, executionContext);
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
      adapterUsed: body.executor ?? job.adapterUsed,
      metadata: buildRunnerResultMetadata(job.metadata, body.evidence),
      latency,
    };
    if (status === 'SUCCESS' && (!windowsExecutor || windowsPrintConfirmed)) {
      patch.printerAckAt = finishedAt;
    }
    if (status === 'FAILED') {
      // Keep the executor's specific error code when it sent one (e.g.
      // PRINT_JOB_ERROR, PRINTER_DEVICE_ERROR) — it is how operators and the
      // dashboard tell a real fault from an ambiguous one. Fall back to the
      // generic runner-failed code only when the runner had nothing to say.
      patch.errorCode = (body.evidence?.['error_code'] as string) ?? 'RUNNER_FAILED';
      patch.errorMessage = body.safe_message ?? 'runner reported failure';
    } else if (status === 'UNVERIFIED') {
      // UNVERIFIED must never be re-executable: EXECUTE relies on errorCode, so
      // stamp PRINT_NOT_VERIFIABLE explicitly even if the runner omitted it.
      patch.errorCode = 'PRINT_NOT_VERIFIABLE';
      patch.errorMessage = body.safe_message ?? 'runner could not verify the print';
    }

    // Conditional write: only apply a terminal result while the job is still
    // DISPATCHED/PRINTING. A duplicate or late result POST (runner crash +
    // restart, double-report) used to land via update() and could overwrite a
    // real SUCCESS with a stale FAILED at any time. claim() returning
    // undefined means the job already resolved — return 409 so the runner logs
    // it instead of silently double-writing (LOW-5).
    const updated = await deps.jobs.claim(jobId, ['DISPATCHED', 'PRINTING'], patch);
    if (!updated) {
      const current = await deps.jobs.findById(jobId);
      return reply.status(409).send({
        ok: false,
        conflict: true,
        status: current?.status ?? 'UNKNOWN',
        message: `Job ${jobId} is no longer DISPATCHED/PRINTING (now ${current?.status ?? 'unknown'}); result not applied`,
      });
    }

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
        errorCode: patch.errorCode ?? 'RUNNER_FAILED',
        errorMessage: patch.errorMessage ?? 'runner reported failure',
      };
      deps.events.publish(evt);
    }

    // The Go runner's terminal path. Without this the result-callback
    // subscriber only ever fired under PRINTOPS_LOCAL_WORKER (the in-process
    // executor), i.e. never in the deployment that actually ships.
    emitPrintJobTerminal(deps.events, updated, {
      status,
      runnerId,
      printerCode: printer?.code,
      errorCode: patch.errorCode,
      errorMessage: patch.errorMessage,
      finishedAt,
      traceId: body.trace_id ?? job.traceId,
    });

    return reply.status(200).send({ ok: true, status });
  });
}

/** Priority first, FIFO within a priority. Repository list views are newest
 * first for operators, which is the opposite of safe queue dispatch order. */
export function orderQueuedCandidates(jobs: Job[]): Job[] {
  return [...jobs].sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority;
    const leftQueued = left.queuedAt ?? left.createdAt;
    const rightQueued = right.queuedAt ?? right.createdAt;
    const queuedDelta = leftQueued.getTime() - rightQueued.getTime();
    if (queuedDelta !== 0) return queuedDelta;
    return left.id.localeCompare(right.id);
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

type WindowsSpoolerExecutionInput = {
  executor?: unknown;
  evidence?: Record<string, unknown>;
  printerProtocol?: unknown;
};

/**
 * Identify the concrete Windows spooler path, not just the runner's configured
 * mode. The Go multi-dispatcher reports its mode in `executor` and the selected
 * backend in evidence, so either source (or the persisted printer protocol)
 * must be able to activate the stricter confirmation gate.
 */
export function isWindowsSpoolerExecution(input: WindowsSpoolerExecutionInput): boolean {
  const candidates = [
    input.executor,
    input.evidence?.['dispatched_executor'],
    input.evidence?.['dispatchedExecutor'],
    input.printerProtocol,
  ];
  return candidates.some((candidate) => {
    if (typeof candidate !== 'string') return false;
    const compact = candidate.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return compact === 'spooler' || compact.includes('windowsspool') || compact.includes('winspool');
  });
}

/** Accept evidence emitted by both Go (snake_case) and TypeScript (camelCase). */
export function hasDeviceConfirmation(evidence?: Record<string, unknown>): boolean {
  return evidence?.['device_confirmed'] === true || evidence?.['deviceConfirmed'] === true;
}

/** Exact printer-side job proof; a printer-global SNMP counter is insufficient. */
export function hasIppJobConfirmation(evidence?: Record<string, unknown>): boolean {
  return evidence?.['ipp_job_confirmed'] === true || evidence?.['ippJobConfirmed'] === true;
}

/**
 * A Windows queue completion and a printer-global SNMP delta cannot identify
 * which host produced a page. Preserve SUCCESS only when the runner also
 * supplies exact printer-side IPP job confirmation.
 */
export function enforceWindowsSpoolerConfirmation(
  status: 'SUCCESS' | 'UNVERIFIED' | 'FAILED',
  input: WindowsSpoolerExecutionInput,
): 'SUCCESS' | 'UNVERIFIED' | 'FAILED' {
  if (status !== 'SUCCESS' || !isWindowsSpoolerExecution(input)) return status;
  return hasDeviceConfirmation(input.evidence) && hasIppJobConfirmation(input.evidence)
    ? 'SUCCESS'
    : 'UNVERIFIED';
}

function normalizeStatus(raw: string): 'SUCCESS' | 'UNVERIFIED' | 'FAILED' {
  const upper = (raw ?? '').toUpperCase();
  if (upper === 'SUCCESS' || upper === 'SUCCEEDED' || upper === 'DONE' || upper === 'OK') return 'SUCCESS';
  // UNVERIFIED is a distinct terminal status, not FAILED: a page may have come
  // out, so re-running the job risks a duplicate. The Go runner reports it on
  // the result line, and PRINTER_NOT_VERIFIABLE / PRINT_NOT_VERIFIABLE arrive
  // through the evidence error_code from both runners — collapse both spellings
  // to the same status so an operator is never invited to blind-retry.
  if (upper === 'UNVERIFIED' || upper === 'NOT_VERIFIABLE' || upper === 'PRINT_NOT_VERIFIABLE') {
    return 'UNVERIFIED';
  }
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

/** Keep remote-runner proof visible on the job without persisting secrets. */
export function buildRunnerResultMetadata(
  existing: Record<string, unknown> | undefined,
  evidence?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    printEvidence: sanitizeEvidence(evidence) ?? {},
  };
}

/** Project the job to the fields the runner needs for local execution.
 *
 * Includes renderedPrintPayload so the Go runner can execute the job locally.
 * The runner treats this as SENSITIVE and must never log it raw.
 */
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
    // Payload for local execution on the runner side.
    renderedPrintPayload: job.renderedPrintPayload,
  } as Partial<Job>;
}
