import type {
  JobRepositoryPort,
  JobQueuePort,
  TraceRepositoryPort,
  AuditRepositoryPort,
  EventBusPort,
  PrinterRepositoryPort,
  PrintTemplateRepositoryPort,
  PaperProfileRepositoryPort,
  TemplateRendererPort,
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
    events: EventBusPort,
    private templates?: PrintTemplateRepositoryPort,
    private papers?: PaperProfileRepositoryPort,
    private renderer?: TemplateRendererPort,
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

    // Render template if a template_code is provided and renderer is available.
    // The rendered bytes are stored in metadata._renderedPayload and passed to
    // the job as renderedPrintPayload so the runner can send them to the printer.
    let renderedPrintPayload: string | undefined;
    let renderWarnings: string[] = [];
    let resolvedMimeType = 'text/plain';
    let paperProfileMetadata: Record<string, unknown> | undefined;
    if (req.template_code && this.templates && this.renderer && this.papers) {
      const template = await this.templates.findByCode(req.template_code);
      if (template) {
        resolvedMimeType =
          template.engine === 'HTML' ? 'text/html' :
          template.engine === 'RAW_TEXT' ? 'text/plain' :
          template.engine === 'PDF_LIKE_PREVIEW' ? 'application/pdf' :
          `application/${template.engine.toLowerCase()}`;
        const paperId = template.paperProfileId;
        const paper = paperId ? await this.papers.findById(paperId) : undefined;
        if (paper) {
          paperProfileMetadata = {
            widthMm: paper.widthMm,
            heightMm: paper.heightMm,
            marginTopMm: paper.marginTopMm,
            marginRightMm: paper.marginRightMm,
            marginBottomMm: paper.marginBottomMm,
            marginLeftMm: paper.marginLeftMm,
            orientation: paper.orientation,
            dpi: paper.dpi,
          };
          try {
            const rendered = await this.renderer.renderPrintPayload(template, req.payload, paper);
            renderedPrintPayload = rendered.renderedPrintPayload;
            renderWarnings = rendered.warnings ?? [];
          } catch (err) {
            renderWarnings.push(`render error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
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
        mimeType: resolvedMimeType,
        copies: req.copies ?? 1,
        duplex: false,
        colorMode: 'auto',
        priorityLabel: req.priority ?? 'normal',
        payloadSnapshot: snapshotPayload(req.payload),
        renderedPrintPayload,
        metadata: {
          ...(req.metadata ?? {}),
          payload: req.payload,
          ...(paperProfileMetadata ? { paperProfile: paperProfileMetadata } : {}),
          ...(renderWarnings.length > 0 ? { renderWarnings } : {}),
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
