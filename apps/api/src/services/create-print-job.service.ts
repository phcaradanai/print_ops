import type {
  JobRepositoryPort,
  JobQueuePort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  PrinterRepositoryPort,
  CreateJobInput,
  Job,
} from '@printerops/domain';
import {
  generateId,
  generateTraceId,
  generateCorrelationId,
  NotFoundError,
} from '@printerops/shared';

export class CreatePrintJobService {
  constructor(
    private jobs: JobRepositoryPort,
    private printers: PrinterRepositoryPort,
    private queue: JobQueuePort,
    private traces: TraceRepositoryPort,
    private audit: AuditRepositoryPort,
    private events: EventBusPort
  ) {}

  async execute(input: CreateJobInput, actorId: string): Promise<Job> {
    const printer = await this.printers.findById(input.printerId);
    if (!printer) throw new NotFoundError('Printer', input.printerId);

    const jobId = generateId();
    const traceId = generateTraceId();
    const correlationId = generateCorrelationId();

    const job = await this.jobs.create({ ...input, id: jobId, traceId, correlationId });

    await this.traces.create({
      jobId: job.id,
      traceId,
      correlationId,
      source: actorId,
      destination: printer.connectionUri,
      printerId: printer.id,
      adapterName: printer.protocol,
      status: 'PENDING',
      retryCount: 0,
      evidence: {},
      steps: [
        {
          stepName: 'job_created',
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 0,
          status: 'success',
          outputSummary: `Job ${job.id} created`,
        },
      ],
    });

    await this.queue.enqueue({
      jobId: job.id,
      printerId: printer.id,
      traceId,
      correlationId,
      priority: input.priority ?? 0,
      enqueuedAt: new Date(),
    });

    const queuedJob = await this.jobs.update(job.id, { status: 'QUEUED', queuedAt: new Date() });

    await this.audit.create({
      traceId,
      action: 'job.created',
      actorId,
      resourceType: 'job',
      resourceId: job.id,
      after: queuedJob as unknown as Record<string, unknown>,
      metadata: {},
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobCreated',
      traceId,
      correlationId,
      occurredAt: new Date(),
      jobId: job.id,
      printerId: printer.id,
      createdBy: actorId,
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobQueued',
      traceId,
      correlationId,
      occurredAt: new Date(),
      jobId: job.id,
      printerId: printer.id,
    });

    return queuedJob;
  }
}
