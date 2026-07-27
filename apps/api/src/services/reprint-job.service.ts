import type { AuditRepositoryPort, Job, JobRepositoryPort } from '@printerops/domain';
import { generateId, NotFoundError, ValidationError } from '@printerops/shared';
import type { CreatePrintJobService } from './create-print-job.service.js';

export interface ReprintJobInput {
  copies: number;
  printerId: string;
  reason: string;
  confirmedDuplicateRisk: boolean;
  confirmedDestinationChange?: boolean;
}

export class ReprintJobService {
  constructor(
    private readonly jobs: JobRepositoryPort,
    private readonly createJob: CreatePrintJobService,
    private readonly audit: AuditRepositoryPort,
  ) {}

  async execute(originalJobId: string, input: ReprintJobInput, actorId: string): Promise<Job> {
    const original = await this.jobs.findById(originalJobId);
    if (!original) throw new NotFoundError('Job', originalJobId);
    if (!original.printerId || !original.traceId || !original.requestId) {
      throw new ValidationError('Original job has insufficient printer, trace, or request identity for a safe reprint');
    }
    if (!input.confirmedDuplicateRisk) {
      throw new ValidationError('Duplicate-print risk acknowledgement is required');
    }
    if (!input.reason?.trim()) throw new ValidationError('A reprint reason is required');
    if (!Number.isInteger(input.copies) || input.copies < 1) {
      throw new ValidationError('Reprint copies must be a whole number of at least 1');
    }
    if (input.printerId !== original.printerId && !input.confirmedDestinationChange) {
      throw new ValidationError('Changing the destination printer requires explicit confirmation');
    }

    const requestId = `reprint-${generateId()}`;
    const created = await this.createJob.execute({
      printerId: input.printerId,
      templateCode: original.templateCode,
      resolvedTemplateCode: original.resolvedTemplateCode,
      paperProfileId: original.paperProfileId,
      renderedPrintPayload: original.renderedPrintPayload,
      documentUrl: original.documentUrl,
      documentBase64: original.documentBase64,
      payloadSnapshot: original.payloadSnapshot,
      mimeType: original.mimeType,
      copies: input.copies,
      duplex: original.duplex,
      colorMode: original.colorMode,
      mediaType: original.mediaType,
      resolution: original.resolution,
      priority: original.priority,
      priorityLabel: original.priorityLabel,
      sourceSystem: original.sourceSystem,
      sourceReference: original.sourceReference,
      requestId,
      createdBy: actorId,
      metadata: {
        reprintOfJobId: original.id,
        reprintOfRequestId: original.requestId,
        reprintReason: input.reason.trim(),
        requestedBy: actorId,
        confirmedDuplicateRisk: true,
      },
    }, actorId);

    await this.audit.create({
      traceId: created.traceId,
      action: 'job.reprint_confirmed',
      actorId,
      resourceType: 'job',
      resourceId: created.id,
      before: original as unknown as Record<string, unknown>,
      after: created as unknown as Record<string, unknown>,
      metadata: {
        originalJobId: original.id,
        originalRequestId: original.requestId,
        reason: input.reason.trim(),
        copies: input.copies,
        destinationChanged: input.printerId !== original.printerId,
      },
    });
    return created;
  }
}
