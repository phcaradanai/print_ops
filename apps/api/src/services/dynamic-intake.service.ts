import type {
  AuditRepositoryPort,
  JobRepositoryPort,
  JobQueuePort,
  PaperProfileRepositoryPort,
  PrinterTemplateBindingRepositoryPort,
  PrintTemplateRepositoryPort,
  PrinterRepositoryPort,
  TemplateRendererPort,
  TraceRepositoryPort,
  WebhookEndpointRepositoryPort,
  WebhookRoutePolicyRepositoryPort,
  WebhookEndpoint,
  EventBusPort,
  AcceptanceCallbackSystemField,
  PrinterPaperCalibrationRepositoryPort,
} from '@printerops/domain';
import { CALLBACK_INTENT_METADATA_KEY, paperProfileForCell, snapshotPaperProfileGeometry } from '@printerops/domain';
import { isValidRotation, NotFoundError, ValidationError } from '@printerops/shared';
import { buildCallbackIntentSafe, wantsAcceptanceCallback } from './callback-intent.service.js';
import { CreatePrintJobService } from './create-print-job.service.js';
import { RoutePolicyResolverService } from './route-policy-resolver.service.js';
import type { WebhookCallbackService, WebhookCallbackLogger } from './webhook-callback.service.js';

export interface IntakeRequest {
  endpointCode: string;
  headers: Record<string, string | undefined>;
  body: Record<string, unknown>;
}

export interface IntakeResponse {
  accepted: true;
  print_job_id: string;
  job_id: string;
  request_id: string;
  trace_id: string;
  source_system: string;
  /** ISO-8601 — when the job was created (≈ when the print was ordered). */
  created_at: string;
  /** ISO-8601 — when the job entered the queue, when known. */
  queued_at?: string;
  resolved_printer_code: string;
  resolved_template_code: string;
  status: string;
  duplicate?: boolean;
}

/**
 * This response is the only `result` a templatable callback ever sees, so the
 * `$$.field` keys the Webhooks page offers an operator must all exist on it.
 * Compile-time, because a field that silently resolves to `undefined` looks
 * exactly like a working callback until an integrator reads the body.
 */
type _SystemFieldsExist = AcceptanceCallbackSystemField extends keyof IntakeResponse ? true : never;
const _systemFieldsExist: _SystemFieldsExist = true;
void _systemFieldsExist;

function snapshotPayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).filter((key) => !/secret|token|password|key/i.test(key));
  const len = JSON.stringify(payload).length;
  return `keys=[${keys.join(',')}] len=${len}`;
}

function requestIdFrom(body: Record<string, unknown>): string {
  const value = body['request_id'] ?? body['requestId'] ?? body['id'];
  if (typeof value === 'string' && value.length > 0) return value;
  throw new ValidationError('request_id is required');
}

function renderTransformOverrides(body: Record<string, unknown>): {
  rotate?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
} {
  if ('rotate' in body && !isValidRotation(body['rotate'])) {
    throw new ValidationError('rotate must be a finite number from 0 to less than 360');
  }
  if ('flipHorizontal' in body && typeof body['flipHorizontal'] !== 'boolean') {
    throw new ValidationError('flipHorizontal must be a boolean');
  }
  if ('flipVertical' in body && typeof body['flipVertical'] !== 'boolean') {
    throw new ValidationError('flipVertical must be a boolean');
  }
  return {
    ...(body['rotate'] !== undefined ? { rotate: body['rotate'] as number } : {}),
    ...(body['flipHorizontal'] !== undefined ? { flipHorizontal: body['flipHorizontal'] as boolean } : {}),
    ...(body['flipVertical'] !== undefined ? { flipVertical: body['flipVertical'] as boolean } : {}),
  };
}

export class DynamicIntakeService {
  private createJob: CreatePrintJobService;
  private resolver = new RoutePolicyResolverService();
  private callbacks: WebhookCallbackService | undefined;

  constructor(
    private endpoints: WebhookEndpointRepositoryPort,
    private policies: WebhookRoutePolicyRepositoryPort,
    private templates: PrintTemplateRepositoryPort,
    private papers: PaperProfileRepositoryPort,
    private bindings: PrinterTemplateBindingRepositoryPort,
    private jobs: JobRepositoryPort,
    printers: PrinterRepositoryPort,
    queue: JobQueuePort,
    private traces: TraceRepositoryPort,
    private audit: AuditRepositoryPort,
    events: EventBusPort,
    private renderer: TemplateRendererPort,
    callbacks?: WebhookCallbackService,
    callbackLogger?: WebhookCallbackLogger,
    calibrations?: PrinterPaperCalibrationRepositoryPort,
  ) {
    this.createJob = new CreatePrintJobService(jobs, printers, queue, traces, audit, events, calibrations, papers);
    this.callbacks = callbacks;
    if (callbackLogger) this.callbackLogger = callbackLogger;
  }

  /** Late-bind the callback service (e.g. after the NATS consumer is up). */
  setCallbackService(service: WebhookCallbackService): void {
    this.callbacks = service;
  }

  private callbackLogger: WebhookCallbackLogger = {
    info: (obj, msg) => console.info(msg, obj),
    warn: (obj, msg) => console.warn(msg, obj),
    error: (obj, msg) => console.error(msg, obj),
  };

  async execute(req: IntakeRequest): Promise<IntakeResponse> {
    const intakeReceivedAt = new Date();
    this.assertBodySize(req.body);
    const endpoint = await this.endpoints.findByCode(req.endpointCode);
    if (!endpoint || !endpoint.enabled) throw new NotFoundError('WebhookEndpoint', req.endpointCode);
    this.assertEndpointAuth(endpoint.authMode, endpoint.apiKey, req.headers);

    const requestId = requestIdFrom(req.body);
    const existing = await this.jobs.findByRequestId(requestId, endpoint.sourceSystem);
    if (existing) {
      const result: IntakeResponse = {
        accepted: true,
        print_job_id: existing.id,
        job_id: existing.id,
        request_id: requestId,
        trace_id: existing.traceId,
        source_system: endpoint.sourceSystem,
        created_at: existing.createdAt?.toISOString() ?? new Date().toISOString(),
        queued_at: existing.queuedAt?.toISOString(),
        resolved_printer_code: existing.printerCode ?? '',
        resolved_template_code: existing.resolvedTemplateCode ?? existing.templateCode ?? '',
        status: 'DUPLICATE_RETURNED',
        duplicate: true,
      };
      void this.fireCallback(endpoint, req.body, result);
      return result;
    }

    const policy = await this.policies.findById(endpoint.routePolicyId);
    if (!policy) throw new NotFoundError('WebhookRoutePolicy', endpoint.routePolicyId);

    const routeStart = Date.now();
    const route = this.resolver.resolve(policy, req.body);
    const routeResolvedAt = new Date();
    const template = await this.templates.findByCode(route.templateCode);
    if (!template || template.status !== 'PUBLISHED') throw new NotFoundError('PrintTemplate', route.templateCode);
    const templateResolvedAt = new Date();
    const paper = await this.resolvePaper(route.printerCode, route.templateCode, template.paperProfileId);
    const renderOptions = renderTransformOverrides(req.body);
    const rendered = Object.keys(renderOptions).length > 0
      ? await this.renderer.renderPrintPayload(template, route.mappedPayload, paperProfileForCell(paper), renderOptions)
      : await this.renderer.renderPrintPayload(template, route.mappedPayload, paperProfileForCell(paper));
    const renderedAt = new Date();
    const routeResolveMs = routeResolvedAt.getTime() - routeStart;

    const job = await this.createJob.execute(
      {
        printerId: '',
        printerCode: route.printerCode,
        templateCode: route.templateCode,
        resolvedTemplateCode: route.templateCode,
        paperProfileId: paper.id,
        routePolicyId: policy.id,
        renderedPrintPayload: rendered.renderedPrintPayload,
        rotate: renderOptions.rotate,
        flipHorizontal: renderOptions.flipHorizontal,
        flipVertical: renderOptions.flipVertical,
        sourceSystem: endpoint.sourceSystem,
        requestId,
        createdBy: endpoint.id,
        mimeType:
          template.engine === 'HTML' ? 'text/html' :
          template.engine === 'RAW_TEXT' ? 'text/plain' :
          template.engine === 'PDF_LIKE_PREVIEW' ? 'application/pdf' :
          `application/${template.engine.toLowerCase()}`,
        copies: typeof req.body['copies'] === 'number' ? Math.max(1, Math.min(req.body['copies'], 100)) : 1,
        duplex: false,
        colorMode: 'auto',
        priorityLabel: route.priority,
        payloadSnapshot: snapshotPayload(req.body),
        templateTiming: {
          intakeReceivedAt,
          routeResolvedAt,
          templateResolvedAt,
          renderedAt,
          routeResolveMs,
          renderMs: rendered.renderTimeMs,
        },
        // Callback intent is snapshotted HERE, at accept time, and travels with
        // the job. `$.field` destinations resolve against req.body, which does
        // not exist any more by the time the print reaches a terminal state.
        metadata: {
          [CALLBACK_INTENT_METADATA_KEY]: buildCallbackIntentSafe(endpoint, req.body),
          routePolicyCode: policy.policyCode,
          warnings: rendered.warnings,
          mappedPayload: route.mappedPayload,
          // The original intake payload, kept so the TERMINAL callback can
          // resolve `$.field` template tokens (the intake payload itself is
          // long gone by the time the print finishes).
          intakePayload: req.body,
          paperProfile: {
            widthMm: paper.widthMm,
            paperProfileId: paper.id,
            heightMm: paper.heightMm,
            gapMm: paper.gapMm ?? 0,
            marginTopMm: paper.marginTopMm,
            marginRightMm: paper.marginRightMm,
            marginBottomMm: paper.marginBottomMm,
            marginLeftMm: paper.marginLeftMm,
            orientation: paper.orientation,
            dpi: paper.dpi,
            rotation: paper.rotation ?? 0,
            flipHorizontal: paper.flipHorizontal ?? false,
            flipVertical: paper.flipVertical ?? false,
            geometry: snapshotPaperProfileGeometry(paper),
          },
        },
      },
      endpoint.id
    );

    await this.appendTrace(job.id, route.templateCode, paper.id, policy.policyCode, rendered.renderTimeMs);
    await this.audit.create({
      traceId: job.traceId,
      action: 'webhook.intake.accepted',
      actorId: endpoint.id,
      resourceType: 'webhook',
      resourceId: endpoint.id,
      metadata: { endpointCode: endpoint.endpointCode, routePolicyCode: policy.policyCode },
    });

    const result: IntakeResponse = {
      accepted: true,
      print_job_id: job.id,
      job_id: job.id,
      request_id: requestId,
      trace_id: job.traceId,
      source_system: endpoint.sourceSystem,
      created_at: job.createdAt?.toISOString() ?? new Date().toISOString(),
      queued_at: job.queuedAt?.toISOString(),
      resolved_printer_code: route.printerCode,
      resolved_template_code: route.templateCode,
      status: job.status,
    };

    // Defer to the intake caller via the endpoint's configured callback
    // (HTTP and/or NATS), if any. Best-effort: failures are logged
    // inside the callback service and never fail the accept path.
    void this.fireCallback(endpoint, req.body, result);

    return result;
  }

  private async resolvePaper(printerCode: string, templateCode: string, templatePaperId?: string) {
    const bindings = await this.bindings.findAll({ printerCode, templateCode });
    const binding = bindings.find((b) => b.enabled && b.isDefault) ?? bindings.find((b) => b.enabled);
    const paperId = binding?.paperProfileId ?? templatePaperId;
    if (!paperId) throw new ValidationError('paper profile could not be resolved');
    const paper = await this.papers.findById(paperId);
    if (!paper) throw new NotFoundError('PaperProfile', paperId);
    return paper;
  }

  private assertBodySize(body: Record<string, unknown>): void {
    if (JSON.stringify(body).length > 65536) throw new ValidationError('intake request too large');
  }

  private assertEndpointAuth(authMode: string, apiKey: string | undefined, headers: Record<string, string | undefined>): void {
    if (authMode !== 'API_KEY') return;
    const provided = headers['x-webhook-key'] ?? headers['X-Webhook-Key'];
    if (!apiKey || provided !== apiKey) throw new ValidationError('invalid webhook key');
  }

  private async appendTrace(jobId: string, templateCode: string, paperProfileId: string, policyCode: string, renderMs: number): Promise<void> {
    const trace = await this.traces.findByJobId(jobId);
    if (!trace) return;
    const now = new Date();
    await this.traces.update(trace.id, {
      steps: [
        ...trace.steps,
        { stepName: 'route_resolved', startedAt: now, finishedAt: now, durationMs: 0, status: 'success', outputSummary: `policy=${policyCode}` },
        { stepName: 'template_resolved', startedAt: now, finishedAt: now, durationMs: 0, status: 'success', outputSummary: `template=${templateCode} paper=${paperProfileId}` },
        { stepName: 'template_rendered', startedAt: now, finishedAt: now, durationMs: renderMs, status: 'success', outputSummary: `renderMs=${renderMs}` },
      ],
    });
  }

  /**
   * Fires the ACCEPTANCE notification (`print.job.accepted`). Not a print
   * result — the job has only been queued at this point.
   */
  private fireCallback(
    endpoint: WebhookEndpoint,
    intakePayload: Record<string, unknown>,
    result: IntakeResponse,
  ): void {
    if (!this.callbacks) return;
    // This used to be `if (result.duplicate !== true) return;` — the acceptance
    // callback fired ONLY for a resent request_id, never for a normal first
    // accept, which is the case every endpoint is actually configured for.
    if (!wantsAcceptanceCallback(endpoint, result.duplicate === true)) return;
    void this.callbacks
      .send({ endpoint, intakePayload, result: result as unknown as Record<string, unknown> })
      .catch((err: unknown) => {
        this.callbackLogger.error({ endpointId: endpoint.id, error: errMsg(err) }, 'webhook callback send failed');
      });
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
