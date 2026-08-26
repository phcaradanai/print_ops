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
  IntakeAttemptRepositoryPort,
  IntakeSource,
  Job,
  JobPriority,
  WebhookEndpointRepositoryPort,
} from '@printerops/domain';
import { CALLBACK_INTENT_METADATA_KEY } from '@printerops/domain';
import { AppError, isValidRotation, ValidationError } from '@printerops/shared';
import { CreatePrintJobService } from './create-print-job.service.js';
import { resolveEndpointCallbackIntent } from './callback-intent.service.js';

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
  rotate?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  /** Optional webhook endpoint whose callback configuration receives this
   *  job's terminal print result. Omitted = no result callback (previous
   *  behaviour, unchanged for every existing caller). */
  endpoint_code?: string;
}

export interface ExternalPrintJobResponse {
  print_job_id: string;
  request_id: string;
  status: string;
  trace_id: string;
  accepted_at: Date;
  /** Instant the job entered the queue. Mirrors IntakeResponse.queued_at so
   *  BOTH intake paths' acceptance callbacks report the same queued time the
   *  terminal callback reports. */
  queued_at: Date;
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
    private intakeLog?: IntakeAttemptRepositoryPort,
    private endpoints?: WebhookEndpointRepositoryPort,
  ) {
    this.createJob = new CreatePrintJobService(jobs, printers, queue, traces, audit, events);
  }

  async execute(
    req: ExternalPrintJobRequest,
    actorId: string,
    source: IntakeSource = 'api',
  ): Promise<ExternalPrintJobResponse> {
    try {
      const result = await this.doExecute(req, actorId);
      void this.intakeLog?.record({
        source,
        outcome: result.duplicate ? 'duplicate' : 'accepted',
        requestId: req.request_id,
        sourceSystem: req.source_system,
        sourceReference: req.source_reference,
        printerCode: req.printer_code,
        codeTemplate: req.template_code,
        clientId: (req.metadata?.['nats'] as { clientId?: string } | undefined)?.clientId,
        subject: (req.metadata?.['nats'] as { subject?: string } | undefined)?.subject,
        jobId: result.print_job_id,
      });
      return result;
    } catch (err) {
      void this.intakeLog?.record({
        source,
        outcome: 'rejected',
        reason: err instanceof Error ? err.message : String(err),
        requestId: req.request_id,
        sourceSystem: req.source_system,
        sourceReference: req.source_reference,
        printerCode: req.printer_code,
        codeTemplate: req.template_code,
        clientId: (req.metadata?.['nats'] as { clientId?: string } | undefined)?.clientId,
        subject: (req.metadata?.['nats'] as { subject?: string } | undefined)?.subject,
      });
      throw err;
    }
  }

  private async doExecute(
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
        queued_at: existing.queuedAt ?? existing.createdAt,
        duplicate: true,
        existing_job_id: existing.id,
      };
    }

    const renderOptions = externalRenderTransformOverrides(req);
    // An explicitly provided template that does not exist is a client error.
    //
    // Without this, POST /api/v1/print-jobs with template_code=NO_SUCH_TEMPLATE
    // returned 201 and printed the job unrendered: the rendering block below is
    // guarded on the template being FOUND, so a miss silently fell through to
    // "print the raw payload". The caller asked for a specific document; giving
    // them a different one and calling it success is worse than refusing.
    //
    // Only enforced when a template repository is available — callers that
    // construct this service without one (unit tests, embedded uses) keep their
    // previous behaviour.
    if (req.template_code && this.templates) {
      const declared = await this.templates.findByCode(req.template_code);
      if (!declared || declared.status !== 'PUBLISHED') {
        throw new AppError(
          'TEMPLATE_NOT_FOUND',
          'The requested print template does not exist.',
          422,
        );
      }
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
        // On the rendered-document flow (renderer + papers wired), a template
        // whose paper profile is missing cannot produce the document the
        // caller asked for. Falling through would print the RAW payload —
        // giving the caller a different document and calling it success.
        if (!paper) {
          throw new AppError(
            'TEMPLATE_PROFILE_MISSING',
            `Template '${req.template_code}' has no usable paper profile; the document cannot be rendered.`,
            422,
          );
        }
        {
          paperProfileMetadata = {
            widthMm: paper.widthMm,
            heightMm: paper.heightMm,
            marginTopMm: paper.marginTopMm,
            marginRightMm: paper.marginRightMm,
            marginBottomMm: paper.marginBottomMm,
            marginLeftMm: paper.marginLeftMm,
            orientation: paper.orientation,
            dpi: paper.dpi,
            rotation: paper.rotation ?? 0,
            flipHorizontal: paper.flipHorizontal ?? false,
            flipVertical: paper.flipVertical ?? false,
          };
          // Two very different failure classes meet here and must not be
          // conflated (product decision, 2026-08-03):
          //  - MISSING FIELDS render fine with warnings — the job proceeds and
          //    the warnings travel with it into the result callback.
          //  - A renderer EXCEPTION means no document exists at all. Printing
          //    the raw payload instead would send JSON to a label printer, so
          //    this is a rejection the caller hears about, not a warning.
          try {
            const rendered = Object.keys(renderOptions).length > 0
              ? await this.renderer.renderPrintPayload(template, req.payload, paper, renderOptions)
              : await this.renderer.renderPrintPayload(template, req.payload, paper);
            renderedPrintPayload = rendered.renderedPrintPayload;
            renderWarnings = rendered.warnings ?? [];
          } catch (err) {
            throw new AppError(
              'RENDER_FAILED',
              `Rendering template '${req.template_code}' failed: ${err instanceof Error ? err.message : String(err)}`,
              422,
            );
          }
        }
      }
    }

    // Snapshotted at accept time and stored WITH the job: `$.field` callback
    // destinations point into `req.payload`, which no longer exists once the
    // print reaches a terminal state. Throws (422/403) on a bad reference, so
    // the caller learns about it instead of getting a silent page and no result.
    const callbackIntent = await resolveEndpointCallbackIntent(
      this.endpoints,
      req.endpoint_code,
      req.source_system,
      req.payload,
    );

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
        rotate: req.rotate,
        flipHorizontal: req.flipHorizontal,
        flipVertical: req.flipVertical,
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
          ...(callbackIntent ? { [CALLBACK_INTENT_METADATA_KEY]: callbackIntent } : {}),
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
      queued_at: job.queuedAt ?? job.createdAt,
      duplicate: false,
    };
  }

  async getJobByRequestId(requestId: string, sourceSystem: string): Promise<Job | undefined> {
    return this.jobs.findByRequestId(requestId, sourceSystem);
  }
}

function externalRenderTransformOverrides(req: ExternalPrintJobRequest): {
  rotate?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
} {
  if (req.rotate !== undefined && !isValidRotation(req.rotate)) {
    throw new ValidationError('rotate must be a finite number from 0 to less than 360');
  }
  if (req.flipHorizontal !== undefined && typeof req.flipHorizontal !== 'boolean') {
    throw new ValidationError('flipHorizontal must be a boolean');
  }
  if (req.flipVertical !== undefined && typeof req.flipVertical !== 'boolean') {
    throw new ValidationError('flipVertical must be a boolean');
  }
  return {
    ...(req.rotate !== undefined ? { rotate: req.rotate } : {}),
    ...(req.flipHorizontal !== undefined ? { flipHorizontal: req.flipHorizontal } : {}),
    ...(req.flipVertical !== undefined ? { flipVertical: req.flipVertical } : {}),
  };
}
