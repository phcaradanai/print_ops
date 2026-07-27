import type {
  JobRepositoryPort,
  PrinterRepositoryPort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  JobQueuePort,
  Job,
  JobStatus,
  TraceStep,
  JobLatency,
} from '@printerops/domain';
import type { AdapterRegistry } from '@printerops/adapters';
import { generateId, ConflictError, NotFoundError } from '@printerops/shared';
import { emitPrintJobTerminal } from './emit-terminal-event.js';

/**
 * Statuses that mean the job is already claimed, already on the wire, or
 * already resolved. Executing one of these prints a second physical page.
 *
 * The desktop app runs the in-process executor AND the Go runner at the same
 * time, and both draw from the same QUEUED pool: the runner claims via
 * POST /api/v1/runners/:id/jobs/next, the UI via POST /jobs/:id/execute.
 * Whichever moves the job out of QUEUED first owns it.
 */
const NON_EXECUTABLE_STATUSES: readonly JobStatus[] = [
  'DISPATCHED',
  'PRINTING',
  'SUCCESS',
  'UNVERIFIED',
  'CANCELLED',
  'DUPLICATE_RETURNED',
];

/** Statuses a job may be executed from — the complement of the list above. */
const EXECUTABLE_STATUSES: readonly JobStatus[] = [
  'ACCEPTED',
  'VALIDATED',
  'QUEUED',
  'FAILED',
  'TIMEOUT',
];

/**
 * The adapter could not get the device to confirm the page. Something may well
 * have printed, so this is not FAILED: re-running it risks a duplicate page,
 * which for a patient or specimen label is real harm.
 */
const UNVERIFIABLE_ERROR_CODE = 'PRINT_NOT_VERIFIABLE';

function adapterEvidence(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function evidenceDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export class ExecuteJobService {
  constructor(
    private jobs: JobRepositoryPort,
    private printers: PrinterRepositoryPort,
    private traces: TraceRepositoryPort,
    private audit: AuditRepositoryPort,
    private queue: JobQueuePort,
    private events: EventBusPort,
    private registry: AdapterRegistry
  ) {}

  async execute(jobId: string, runnerId: string): Promise<Job> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    if (NON_EXECUTABLE_STATUSES.includes(job.status)) {
      throw new ConflictError(
        `Job ${jobId} is ${job.status} and cannot be executed again`
      );
    }

    const printer = await this.printers.findById(job.printerId);

    if (!printer) throw new NotFoundError('Printer', job.printerId);

    const dispatchedAt = new Date();
    const queueWaitMs = job.queuedAt
      ? dispatchedAt.getTime() - job.queuedAt.getTime()
      : undefined;

    // QUEUED → DISPATCHED, as a conditional write. The status check above is
    // only a fast path: two callers racing on the same job (a double-clicked
    // Print button, a webhook re-fire) both pass it, and only this claim can
    // stop both of them from printing the document.
    const claimed = await this.jobs.claim(jobId, [...EXECUTABLE_STATUSES], {
      status: 'DISPATCHED',
      dispatchedAt,
      runnerReceivedAt: dispatchedAt,
      runnerId,
      latency: { ...job.latency, queueWaitMs },
    });
    if (!claimed) {
      throw new ConflictError(`Job ${jobId} was already claimed by another runner`);
    }

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobDispatched',
      traceId: job.traceId,
      correlationId: job.correlationId,
      occurredAt: dispatchedAt,
      jobId,
      runnerId,
      printerId: printer.id,
    });

    const startedAt = new Date();
    // Execution has started, but PRINTING is reserved for a correlated native
    // Windows job. The adapter's progress callback performs that transition.
    await this.jobs.update(jobId, {
      startedAt,
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobStarted',
      traceId: job.traceId,
      correlationId: job.correlationId,
      occurredAt: startedAt,
      jobId,
      runnerId,
      printerId: printer.id,
    });

    const trace = await this.traces.findByJobId(jobId);
    let acceptedProgress: { occurredAt: Date; evidence: Record<string, unknown> } | undefined;

    try {
      const adapter = this.registry.getAdapterForPrinter(printer);
      const result = await adapter.executeCommand({
        jobId,
        printerId: printer.id,
        traceId: job.traceId,
        connectionUri: printer.connectionUri,
        documentUrl: job.documentUrl,
        documentBase64: job.documentBase64,
        renderedPrintPayload: job.renderedPrintPayload,
        mimeType: job.mimeType,
        copies: job.copies,
        duplex: job.duplex,
        colorMode: job.colorMode,
        mediaType: job.mediaType,
        resolution: job.resolution,
        // Printer metadata first so job metadata can still override per job;
        // this is how snmpHost / snmpCommunity reach the adapter.
        metadata: {
          ...printer.metadata,
          ...job.metadata,
          printerName: printer.name,
          printerCode: printer.code,
        },
        onProgress: async (progress) => {
          if (progress.stage !== 'SPOOLER_ACCEPTED') return;
          acceptedProgress = { occurredAt: progress.occurredAt, evidence: progress.evidence };
          try {
            await this.jobs.update(jobId, {
              status: 'PRINTING',
              spoolerSentAt: progress.occurredAt,
              metadata: {
                ...job.metadata,
                printEvidence: progress.evidence,
              },
            });
          } catch (err) {
            // The print has already reached Windows. Keep verification running;
            // retrying because this intermediate write failed can duplicate it.
            // eslint-disable-next-line no-console
            console.error(`[ExecuteJobService] job ${jobId} progress persistence failed:`, err);
          }
        },
      });

      const finishedAt = new Date();
      const runnerExecMs = finishedAt.getTime() - startedAt.getTime();
      const dispatchMs = startedAt.getTime() - dispatchedAt.getTime();
      const totalLatencyMs = job.receivedAt
        ? finishedAt.getTime() - job.receivedAt.getTime()
        : undefined;

      const evidence = {
        ...(acceptedProgress?.evidence ?? {}),
        ...adapterEvidence(result.raw),
      };
      if (
        result.success &&
        adapter.protocol === 'windows_spooler' &&
        (
          evidence['deviceConfirmed'] !== true ||
          evidence['ippJobConfirmed'] !== true
        )
      ) {
        return await this.handleFailure(
          job,
          runnerId,
          UNVERIFIABLE_ERROR_CODE,
          result.message ??
            'Windows accepted the job, but no exact printer-side IPP job confirmed the physical output',
          startedAt,
          dispatchedAt,
          queueWaitMs,
          trace ?? undefined,
          adapter.adapterName,
          evidence,
        );
      }

      if (result.success) {
        const printerAckAt = finishedAt;
        const latency: JobLatency = {
          ...(job.latency ?? {}),
          queueWaitMs,
          dispatchMs,
          runnerExecMs,
          printerAckMs: 0,
          totalLatencyMs,
        };

        const completed = await this.jobs.update(jobId, {
          status: 'SUCCESS',
          finishedAt,
          completedAt: finishedAt,
          printerAckAt,
          adapterUsed: adapter.adapterName,
          metadata: {
            ...job.metadata,
            printEvidence: evidence,
          },
          latency,
        });

        if (trace) {
          await this.traces.update(trace.id, {
            runnerId,
            adapterName: adapter.adapterName,
            startedAt,
            finishedAt,
            durationMs: runnerExecMs,
            status: 'SUCCESS',
            evidence: {
              ...trace.evidence,
              print: evidence,
            },
            steps: [
              ...trace.steps,
              {
                stepName: 'job_dispatched',
                startedAt: dispatchedAt,
                finishedAt: startedAt,
                durationMs: dispatchMs,
                status: 'success',
                outputSummary: `Dispatched to runner ${runnerId}`,
              },
              {
                stepName: 'adapter_execute',
                startedAt,
                finishedAt,
                durationMs: runnerExecMs,
                status: 'success',
                outputSummary: result.message,
              },
            ],
          });
        }

        await this.audit.create({
          traceId: job.traceId,
          action: 'job.succeeded',
          resourceType: 'job',
          resourceId: jobId,
          after: completed as unknown as Record<string, unknown>,
          metadata: {
            runnerId,
            durationMs: runnerExecMs,
            totalLatencyMs,
            adapter: adapter.adapterName,
            evidence,
          },
        });

        this.events.publish({
          eventId: generateId(),
          eventType: 'JobSucceeded',
          traceId: job.traceId,
          correlationId: job.correlationId,
          occurredAt: finishedAt,
          jobId,
          durationMs: runnerExecMs,
        });

        // Terminal state is persisted (the `completed` update above), so the
        // result-callback subscriber can safely read the job back.
        emitPrintJobTerminal(this.events, completed, {
          status: 'SUCCESS',
          runnerId,
          printerCode: printer.code,
          finishedAt,
        });

        await this.queue.ack(jobId);
        return completed;
      } else {
        return await this.handleFailure(
          job, runnerId, result.errorCode ?? 'UNKNOWN', result.message ?? 'Adapter failed',
          startedAt, dispatchedAt, queueWaitMs, trace ?? undefined, adapter.adapterName, evidence
        );
      }
    } catch (err) {
      // Without this the stack is swallowed and the job only records the bare
      // message, which is not enough to locate an adapter-side defect.
      // eslint-disable-next-line no-console
      console.error(`[ExecuteJobService] job ${jobId} threw during execution:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const mayHavePrinted = acceptedProgress !== undefined;
      return await this.handleFailure(
        job,
        runnerId,
        mayHavePrinted ? UNVERIFIABLE_ERROR_CODE : 'EXECUTION_ERROR',
        mayHavePrinted ? `${errMsg}. Windows had already accepted the job; do not auto-retry.` : errMsg,
        startedAt,
        dispatchedAt,
        queueWaitMs,
        trace ?? undefined,
        'unknown',
        acceptedProgress?.evidence ?? {},
      );
    }
  }

  private async handleFailure(
    job: Job,
    runnerId: string,
    errorCode: string,
    errorMessage: string,
    startedAt: Date,
    dispatchedAt: Date,
    queueWaitMs: number | undefined,
    trace?: { id: string; steps: TraceStep[]; evidence: Record<string, unknown> },
    adapterName?: string,
    evidence: Record<string, unknown> = {},
  ): Promise<Job> {
    const finishedAt = new Date();
    const runnerExecMs = finishedAt.getTime() - startedAt.getTime();
    const dispatchMs = startedAt.getTime() - dispatchedAt.getTime();
    const totalLatencyMs = job.receivedAt
      ? finishedAt.getTime() - job.receivedAt.getTime()
      : undefined;

    const latency: JobLatency = {
      ...(job.latency ?? {}),
      queueWaitMs,
      dispatchMs,
      runnerExecMs,
      totalLatencyMs,
    };

    // "Could not confirm" is not "did not print" — keep the two apart so an
    // operator is never invited to blind-retry a job that may have produced a
    // page. UNVERIFIED is in NON_EXECUTABLE_STATUSES; reprinting means creating
    // a new job on purpose.
    const terminalStatus: JobStatus =
      errorCode === UNVERIFIABLE_ERROR_CODE ? 'UNVERIFIED' : 'FAILED';

    const spoolerSentAt = evidenceDate(evidence['spoolerAcceptedAt']);
    const failed = await this.jobs.update(job.id, {
      status: terminalStatus,
      finishedAt,
      completedAt: finishedAt,
      errorCode,
      errorMessage,
      adapterUsed: adapterName,
      ...(spoolerSentAt ? { spoolerSentAt } : {}),
      metadata: {
        ...job.metadata,
        printEvidence: evidence,
      },
      latency,
    });

    if (trace) {
      await this.traces.update(trace.id, {
        runnerId,
        startedAt,
        finishedAt,
        durationMs: runnerExecMs,
        status: terminalStatus,
        errorCode,
        errorMessage,
        evidence: {
          ...trace.evidence,
          print: evidence,
        },
        steps: [
          ...trace.steps,
          {
            stepName: 'job_dispatched',
            startedAt: dispatchedAt,
            finishedAt: startedAt,
            durationMs: dispatchMs,
            status: 'success',
            outputSummary: `Dispatched to runner ${runnerId}`,
          },
          {
            stepName: 'adapter_execute',
            startedAt,
            finishedAt,
            durationMs: runnerExecMs,
            status: 'failed',
            error: errorMessage,
          },
        ],
      });
    }

    await this.audit.create({
      traceId: job.traceId,
      action: 'job.failed',
      resourceType: 'job',
      resourceId: job.id,
      after: failed as unknown as Record<string, unknown>,
      metadata: { runnerId, errorCode, errorMessage, totalLatencyMs, evidence },
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobFailed',
      traceId: job.traceId,
      correlationId: job.correlationId,
      occurredAt: finishedAt,
      jobId: job.id,
      errorCode,
      errorMessage,
    });

    // `terminalStatus`, not a flattened 'FAILED'. UNVERIFIED means a page may
    // physically exist; telling the caller's system it failed would invite a
    // duplicate reprint of a label that is already in the tray.
    emitPrintJobTerminal(this.events, failed, {
      status: terminalStatus,
      runnerId,
      errorCode,
      errorMessage,
      finishedAt,
    });

    // Terminal failures (FAILED/UNVERIFIED) are done — ack, not nack. Nothing
    // dequeues today, so nack only ever accumulated inflight entries and grew
    // size()/getMetrics() without bound; the day a drainer is wired up, nack
    // here would re-dispatch a print that may already have produced a page
    // (LOW-4). A retry, when one exists, must be an explicit new job.
    await this.queue.ack(job.id);
    return failed;
  }
}
