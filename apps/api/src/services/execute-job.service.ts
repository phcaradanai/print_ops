import type {
  JobRepositoryPort,
  PrinterRepositoryPort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  JobQueuePort,
  Job,
  TraceStep,
  JobLatency,
} from '@printerops/domain';
import type { AdapterRegistry } from '@printerops/adapters';
import { generateId, NotFoundError } from '@printerops/shared';

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

    const printer = await this.printers.findById(job.printerId);
    if (!printer) throw new NotFoundError('Printer', job.printerId);

    const dispatchedAt = new Date();
    const queueWaitMs = job.queuedAt
      ? dispatchedAt.getTime() - job.queuedAt.getTime()
      : undefined;

    // QUEUED → DISPATCHED
    await this.jobs.update(jobId, {
      status: 'DISPATCHED',
      dispatchedAt,
      runnerReceivedAt: dispatchedAt,
      runnerId,
      latency: { ...job.latency, queueWaitMs },
    });

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
        documentUrl: job.documentUrl,
        documentBase64: job.documentBase64,
        mimeType: job.mimeType,
        copies: job.copies,
        duplex: job.duplex,
        colorMode: job.colorMode,
        mediaType: job.mediaType,
        resolution: job.resolution,
        metadata: job.metadata,
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

    const failed = await this.jobs.update(job.id, {
      status: 'FAILED',
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
