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
    // DISPATCHED → PRINTING
    await this.jobs.update(jobId, {
      status: 'PRINTING',
      startedAt,
      spoolerSentAt: startedAt,
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
      });

      const printerAckAt = new Date();
      const finishedAt = printerAckAt;
      const runnerExecMs = finishedAt.getTime() - startedAt.getTime();
      const dispatchMs = startedAt.getTime() - dispatchedAt.getTime();
      const totalLatencyMs = job.receivedAt
        ? finishedAt.getTime() - job.receivedAt.getTime()
        : undefined;

      if (result.success) {
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
          metadata: { runnerId, durationMs: runnerExecMs, totalLatencyMs, adapter: adapter.adapterName },
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

        await this.queue.ack(jobId);
        return completed;
      } else {
        return await this.handleFailure(
          job, runnerId, result.errorCode ?? 'UNKNOWN', result.message ?? 'Adapter failed',
          startedAt, dispatchedAt, queueWaitMs, trace ?? undefined, adapter.adapterName
        );
      }
    } catch (err) {
      // Without this the stack is swallowed and the job only records the bare
      // message, which is not enough to locate an adapter-side defect.
      // eslint-disable-next-line no-console
      console.error(`[ExecuteJobService] job ${jobId} threw during execution:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return await this.handleFailure(
        job, runnerId, 'EXECUTION_ERROR', errMsg, startedAt, dispatchedAt, queueWaitMs, trace ?? undefined, 'unknown'
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
    trace?: { id: string; steps: TraceStep[] },
    adapterName?: string
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

    const failed = await this.jobs.update(job.id, {
      status: terminalStatus,
      finishedAt,
      completedAt: finishedAt,
      errorCode,
      errorMessage,
      adapterUsed: adapterName,
      latency,
    });

    if (trace) {
      await this.traces.update(trace.id, {
        runnerId,
        startedAt,
        finishedAt,
        durationMs: runnerExecMs,
        status: 'FAILED',
        errorCode,
        errorMessage,
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
      metadata: { runnerId, errorCode, errorMessage, totalLatencyMs },
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

    await this.queue.nack(job.id);
    return failed;
  }
}
