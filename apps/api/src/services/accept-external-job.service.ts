import type {
  JobRepositoryPort,
  JobQueuePort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  PrinterRepositoryPort,
  Job,
  JobPriority,
} from '@printerops/domain';
import { ConflictError } from '@printerops/shared';
import { CreatePrintJobService } from './create-print-job.service.js';

export interface ExternalPrintJobRequest {
  request_id: string;
  source_system: string;
  source_reference?: string;
  printer_code: string;
  template_code?: string;
  payload: Record<string, unknown>;
  copies?: number;
  priority?: JobPriority;
  metadata?: Record<string, unknown>;
}

export interface ExternalPrintJobResponse {
  print_job_id: string;
  request_id: string;
  status: string;
  trace_id: string;
  accepted_at: Date;
  duplicate: boolean;
  existing_job_id?: string;
}

function snapshotPayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  const len = JSON.stringify(payload).length;
  return `keys=[${keys.join(',')}] len=${len}`;
}

export class AcceptExternalJobService {
  private createJob: CreatePrintJobService;

  constructor(
    private jobs: JobRepositoryPort,
    printers: PrinterRepositoryPort,
    queue: JobQueuePort,
    traces: TraceRepositoryPort,
    audit: AuditRepositoryPort,
    events: EventBusPort
  ) {
    this.createJob = new CreatePrintJobService(jobs, printers, queue, traces, audit, events);
  }

  async execute(
    req: ExternalPrintJobRequest,
    actorId: string
  ): Promise<ExternalPrintJobResponse> {
    // Idempotency check
    const existing = await this.jobs.findByRequestId(req.request_id, req.source_system);
    if (existing) {
      return {
        print_job_id: existing.id,
        request_id: req.request_id,
        status: 'DUPLICATE_RETURNED',
        trace_id: existing.traceId,
        accepted_at: existing.createdAt,
        duplicate: true,
        existing_job_id: existing.id,
      };
    }

    const job = await this.createJob.execute(
      {
        printerId: '',
        printerCode: req.printer_code,
        templateCode: req.template_code,
        sourceSystem: req.source_system,
        sourceReference: req.source_reference,
        requestId: req.request_id,
        createdBy: actorId,
        mimeType: 'application/octet-stream',
        copies: req.copies ?? 1,
        duplex: false,
        colorMode: 'auto',
        priorityLabel: req.priority ?? 'normal',
        payloadSnapshot: snapshotPayload(req.payload),
        metadata: {
          ...(req.metadata ?? {}),
          payload: req.payload,
        },
      },
      actorId
    );

    return {
      print_job_id: job.id,
      request_id: req.request_id,
      status: job.status,
      trace_id: job.traceId,
      accepted_at: job.createdAt,
      duplicate: false,
    };
  }

  async getJobByRequestId(requestId: string, sourceSystem: string): Promise<Job | undefined> {
    return this.jobs.findByRequestId(requestId, sourceSystem);
  }
}
