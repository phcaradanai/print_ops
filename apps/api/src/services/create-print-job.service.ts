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
import type { JobPriority } from '@printerops/domain';
import {
  generateId,
  generateTraceId,
  generateCorrelationId,
  NotFoundError,
  ValidationError,
} from '@printerops/shared';

const PRIORITY_MAP: Record<JobPriority, number> = {
  urgent: 100, high: 75, normal: 50, low: 25,
};

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
    const receivedAt = new Date();

    // Resolve printer (by id or code)
    const printer = input.printerId
      ? await this.printers.findById(input.printerId)
      : input.printerCode
        ? await this.printers.findByCode(input.printerCode)
        : undefined;

    if (!printer) {
      throw new NotFoundError('Printer', input.printerCode ?? input.printerId ?? 'unknown');
    }

    // Validate copies
    if (printer.maxCopiesPerJob && input.copies > printer.maxCopiesPerJob) {
      throw new ValidationError(
        `copies ${input.copies} exceeds printer limit ${printer.maxCopiesPerJob}`
      );
    }

    // Validate template
    if (
      input.templateCode &&
      printer.allowedTemplates &&
      printer.allowedTemplates.length > 0 &&
      !printer.allowedTemplates.includes(input.templateCode)
    ) {
      throw new ValidationError(
        `template_code '${input.templateCode}' not allowed for printer '${printer.code}'`
      );
    }

    const validatedAt = new Date();
    const validationMs = validatedAt.getTime() - receivedAt.getTime();

    const jobId = generateId();
    const traceId = generateTraceId();
    const correlationId = generateCorrelationId();

    const job = await this.jobs.create({
      ...input,
      printerId: printer.id,
      id: jobId,
      traceId,
      correlationId,
    });

    // ACCEPTED → VALIDATED
    const validatedJob = await this.jobs.update(job.id, {
      status: 'VALIDATED',
      validatedAt,
      latency: { validationMs },
    });

    await this.traces.create({
      jobId: job.id,
      traceId,
      correlationId,
      source: actorId,
      destination: printer.connectionUri,
      printerId: printer.id,
      adapterName: printer.protocol,
      status: 'VALIDATED',
      retryCount: 0,
      evidence: {},
      steps: [
        {
          stepName: 'job_accepted',
          startedAt: receivedAt,
          finishedAt: receivedAt,
          durationMs: 0,
          status: 'success',
          outputSummary: `Job ${job.id} accepted`,
        },
        {
          stepName: 'job_validated',
          startedAt: receivedAt,
          finishedAt: validatedAt,
          durationMs: validationMs,
          status: 'success',
          outputSummary: `Printer ${printer.code} resolved, ${input.copies} copies validated`,
        },
      ],
    });

    // Enqueue → QUEUED
    const priority = input.priority ?? PRIORITY_MAP[input.priorityLabel ?? 'normal'];
    await this.queue.enqueue({
      jobId: job.id,
      printerId: printer.id,
      traceId,
      correlationId,
      priority,
      enqueuedAt: new Date(),
    });

    const queuedAt = new Date();
    const queuedJob = await this.jobs.update(job.id, {
      status: 'QUEUED',
      queuedAt,
    });

    await this.audit.create({
      traceId,
      action: 'job.created',
      actorId,
      resourceType: 'job',
      resourceId: job.id,
      after: queuedJob as unknown as Record<string, unknown>,
      metadata: { printerCode: printer.code, priority },
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobAccepted',
      traceId,
      correlationId,
      occurredAt: receivedAt,
      jobId: job.id,
      printerId: printer.id,
      requestId: input.requestId,
      sourceSystem: input.sourceSystem,
      createdBy: actorId,
    });

    this.events.publish({
      eventId: generateId(),
      eventType: 'JobQueued',
      traceId,
      correlationId,
      occurredAt: queuedAt,
      jobId: job.id,
      printerId: printer.id,
    });

    return queuedJob;
  }
}
