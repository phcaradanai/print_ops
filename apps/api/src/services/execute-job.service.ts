import type {
  JobRepositoryPort,
  PrinterRepositoryPort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  JobQueuePort,
  Job,
  TraceStep,
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

    const startedAt = new Date();
    await this.jobs.update(jobId, { status: 'RUNNING', startedAt });

    const trace = await this.traces.findByJobId(jobId);

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

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      if (result.success) {
        const completed = await this.jobs.update(jobId, {
          status: 'SUCCESS',
          finishedAt,
        });

        if (trace) {
          await this.traces.update(trace.id, {
            runnerId,
            adapterName: adapter.adapterName,
            startedAt,
            finishedAt,
            durationMs,
            status: 'SUCCESS',
            steps: [
              ...trace.steps,
              {
                stepName: 'adapter_execute',
                startedAt,
                finishedAt,
                durationMs,
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
          metadata: { runnerId, durationMs },
        });

        this.events.publish({
          eventId: generateId(),
          eventType: 'JobSucceeded',
          traceId: job.traceId,
          correlationId: job.correlationId,
          occurredAt: finishedAt,
          jobId,
          durationMs,
        });

        await this.queue.ack(jobId);
        return completed;
      } else {
        return await this.handleFailure(job, runnerId, result.errorCode ?? 'UNKNOWN', result.message ?? 'Adapter failed', startedAt, trace ?? undefined);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return await this.handleFailure(job, runnerId, 'EXECUTION_ERROR', errMsg, startedAt, trace ?? undefined);
    }
  }

  private async handleFailure(
    job: Job,
    runnerId: string,
    errorCode: string,
    errorMessage: string,
    startedAt: Date,
    trace?: { id: string; steps: TraceStep[] }
  ): Promise<Job> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    const failed = await this.jobs.update(job.id, {
      status: 'FAILED',
      finishedAt,
      errorCode,
      errorMessage,
    });

    if (trace) {
      await this.traces.update(trace.id, {
        runnerId,
        startedAt,
        finishedAt,
        durationMs,
        status: 'FAILED',
        errorCode,
        errorMessage,
        steps: [
          ...trace.steps,
          {
            stepName: 'adapter_execute',
            startedAt,
            finishedAt,
            durationMs,
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
      metadata: { runnerId, errorCode, errorMessage },
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
