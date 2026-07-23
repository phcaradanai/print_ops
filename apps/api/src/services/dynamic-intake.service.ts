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
} from '@printerops/domain';
import { NotFoundError, ValidationError } from '@printerops/shared';
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
  request_id: string;
  trace_id: string;
  resolved_printer_code: string;
  resolved_template_code: string;
  status: string;
  duplicate?: boolean;
}

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
  ) {
    this.createJob = new CreatePrintJobService(jobs, printers, queue, traces, audit, events);
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
        request_id: requestId,
        trace_id: existing.traceId,
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
    const rendered = await this.renderer.renderPrintPayload(template, route.mappedPayload, paper);
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
        metadata: {
          routePolicyCode: policy.policyCode,
          warnings: rendered.warnings,
          mappedPayload: route.mappedPayload,
          paperProfile: {
            widthMm: paper.widthMm,
            heightMm: paper.heightMm,
            marginTopMm: paper.marginTopMm,
            marginRightMm: paper.marginRightMm,
            marginBottomMm: paper.marginBottomMm,
            marginLeftMm: paper.marginLeftMm,
            orientation: paper.orientation,
            dpi: paper.dpi,
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
      request_id: requestId,
      trace_id: job.traceId,
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

  private fireCallback(
    endpoint: WebhookEndpoint,
    intakePayload: Record<string, unknown>,
    result: IntakeResponse,
  ): void {
    if (!this.callbacks) return;
    if ((endpoint.callbackTransport ?? 'NONE') === 'NONE') return;
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
