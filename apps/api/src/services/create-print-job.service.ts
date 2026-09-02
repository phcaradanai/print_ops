import type {
  JobRepositoryPort,
  JobQueuePort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  PrinterRepositoryPort,
  CreateJobInput,
  Job,
  PaperProfileRepositoryPort,
  PrinterPaperCalibrationRepositoryPort,
} from '@printerops/domain';
import type { JobPriority } from '@printerops/domain';
import {
  generateId,
  generateTraceId,
  generateCorrelationId,
  NotFoundError,
  ValidationError,
  isValidRotation,
  withRenderTransformOverrides,
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
    private events: EventBusPort,
    private calibrations?: PrinterPaperCalibrationRepositoryPort,
    private papers?: PaperProfileRepositoryPort,
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

    if (input.rotate !== undefined && !isValidRotation(input.rotate)) {
      throw new ValidationError('rotate must be a finite number from 0 to less than 360');
    }
    if (input.flipHorizontal !== undefined && typeof input.flipHorizontal !== 'boolean') {
      throw new ValidationError('flipHorizontal must be a boolean');
    }
    if (input.flipVertical !== undefined && typeof input.flipVertical !== 'boolean') {
      throw new ValidationError('flipVertical must be a boolean');
    }

    // Validate copies.
    //
    // The lower bound matters as much as the upper one: `copies` is what
    // decides how many physical pages leave the device. Only the upper bound
    // used to be checked here, so POST /api/v1/print-jobs accepted copies of
    // -5, 0 and 2.7 and persisted them verbatim (the job still reached
    // SUCCESS). DynamicIntakeService clamps with Math.max(1, ...) before it
    // ever gets here, so the external API was the only way in — but this is
    // the one chokepoint every transport passes through, so the check belongs
    // here rather than in each intake path.
    if (!Number.isInteger(input.copies)) {
      throw new ValidationError(`copies must be a whole number, received ${input.copies}`);
    }
    if (input.copies < 1) {
      throw new ValidationError(`copies must be at least 1, received ${input.copies}`);
    }
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

    const metadata = withRenderTransformOverrides(input.metadata, {
      rotate: input.rotate,
      flipHorizontal: input.flipHorizontal,
      flipVertical: input.flipVertical,
    });
    // Calibration is resolved from the trusted printer/profile tuple at job
    // creation time. Never accept offsets supplied by an external payload.
    delete metadata['printerCalibration'];
    if (this.calibrations && input.paperProfileId) {
      // The profile's DPI comes from the repository, not request metadata.
      // Metadata is only a rendering snapshot and can be supplied by a caller.
      const profileDpi = this.papers
        ? (await this.papers.findById(input.paperProfileId))?.dpi
        : undefined;
      if (typeof profileDpi === 'number' && Number.isInteger(profileDpi) && profileDpi > 0) {
        const calibration = await this.calibrations.findByKey(printer.id, input.paperProfileId, profileDpi);
        if (calibration) {
          metadata['printerCalibration'] = {
            printerId: calibration.printerId,
            paperProfileId: calibration.paperProfileId,
            dpi: calibration.dpi,
            xOffsetDots: calibration.xOffsetDots,
            yOffsetDots: calibration.yOffsetDots,
          };
        }
      }
    }
    const job = await this.jobs.create({
      ...input,
      metadata,
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

    // Persist QUEUED before touching the volatile in-memory queue. If the
    // process stops between these two operations, desktop startup can safely
    // rehydrate the durable row. The reverse ordering can lose a job forever
    // (or let the worker dequeue it while the database still says VALIDATED).
    const priority = input.priority ?? PRIORITY_MAP[input.priorityLabel ?? 'normal'];
    const queuedAt = new Date();
    const queuedJob = await this.jobs.update(job.id, {
      status: 'QUEUED',
      queuedAt,
    });

    await this.queue.enqueue({
      jobId: job.id,
      printerId: printer.id,
      traceId,
      correlationId,
      priority,
      enqueuedAt: queuedAt,
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
