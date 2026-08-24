import type { FastifyInstance } from 'fastify';
import type {
  AuditRepositoryPort,
  TemplateRendererPort,
  PaperProfileRepositoryPort,
  PrintTemplateRepositoryPort,
  WebhookEndpointRepositoryPort,
  WebhookRoutePolicyRepositoryPort,
  WebhookCallbackAttemptRepositoryPort,
  CallbackAttemptOutcome,
  CallbackAttemptTransport,
  CallbackDeliveryRepositoryPort,
  CallbackDeliveryStatus,
  CallbackTransport,
  JobPriority,
} from '@printerops/domain';
import { evaluatePrinterReadiness } from '@printerops/domain';
import type { DynamicIntakeService } from '../../services/dynamic-intake.service.js';
import type { CreatePrintJobService } from '../../services/create-print-job.service.js';
import type { ExecuteJobService } from '../../services/execute-job.service.js';
import type { GetPrinterStatusService } from '../../services/get-printer-status.service.js';
import type { HttpClient, NatsPublisher, WebhookCallbackLogger } from '../../services/webhook-callback.service.js';
import { actor, requirePermission } from './permission-guard.js';

const PRIORITY_MAP: Record<string, JobPriority> = {
  low: 'low', normal: 'normal', high: 'high', urgent: 'urgent',
};

/**
 * Reject an unknown enum filter value instead of silently returning everything.
 * A typo'd `?deliveryStatus=DELIVRED` that quietly answers "here is the whole
 * table" reads to an operator as "nothing failed".
 */
function validateFilters(
  checks: Array<[name: string, value: string | undefined, allowed: readonly string[]]>,
): string | undefined {
  for (const [name, value, allowed] of checks) {
    if (value !== undefined && !allowed.includes(value)) {
      return `${name} must be one of: ${allowed.join(', ')}`;
    }
  }
  return undefined;
}

export async function webhookRoutes(
  app: FastifyInstance,
  deps: {
    endpoints: WebhookEndpointRepositoryPort;
    policies: WebhookRoutePolicyRepositoryPort;
    templates: PrintTemplateRepositoryPort;
    papers: PaperProfileRepositoryPort;
    renderer: TemplateRendererPort;
    intake: DynamicIntakeService;
    audit: AuditRepositoryPort;
    createJob: CreatePrintJobService;
    executeJob: ExecuteJobService;
    getPrinterStatus: GetPrinterStatusService;
    logger: WebhookCallbackLogger;
    callbackSender: HttpClient;
    callbackNats?: NatsPublisher;
    callbackAttemptLog?: WebhookCallbackAttemptRepositoryPort;
    callbackDeliveries?: CallbackDeliveryRepositoryPort;
  }
): Promise<void> {
  app.get('/webhook-endpoints', { onRequest: [requirePermission('webhook:read')] }, async () => deps.endpoints.findAll());
  app.post('/webhook-endpoints', { onRequest: [requirePermission('webhook:create')] }, async (req, reply) => {
    const endpoint = await deps.endpoints.create(req.body as Parameters<typeof deps.endpoints.create>[0]);
    await deps.audit.create({ traceId: 'webhook', action: 'webhook_endpoint.created', actorId: actor(req), resourceType: 'webhook_endpoint', resourceId: endpoint.id, metadata: {} });
    return reply.status(201).send(endpoint);
  });
  app.put('/webhook-endpoints/:id', { onRequest: [requirePermission('webhook:update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const endpoint = await deps.endpoints.update(id, req.body as Record<string, unknown>);
    await deps.audit.create({ traceId: 'webhook', action: 'webhook_endpoint.updated', actorId: actor(req), resourceType: 'webhook_endpoint', resourceId: id, metadata: {} });
    return endpoint;
  });
  app.delete('/webhook-endpoints/:id', { onRequest: [requirePermission('webhook:update')] }, async (req) => {
    const { id } = req.params as { id: string };
    await deps.endpoints.delete(id);
    await deps.audit.create({ traceId: 'webhook', action: 'webhook_endpoint.deleted', actorId: actor(req), resourceType: 'webhook_endpoint', resourceId: id, metadata: {} });
    return { ok: true, id };
  });
  app.post('/webhook-endpoints/:id/test', { onRequest: [requirePermission('webhook:test')] }, async (req) => {
    const { id } = req.params as { id: string };
    await deps.audit.create({ traceId: 'webhook', action: 'webhook_endpoint.tested', actorId: actor(req), resourceType: 'webhook_endpoint', resourceId: id, metadata: {} });
    return { ok: true, id };
  });

  // Test-fire the endpoint's callback (HTTP and/or NATS) with a sample payload,
  // so operators can verify the destination before going live. Returns the
  // REAL per-transport delivery outcome (attempted/success/status/error) —
  // not just "we called send()" — and records the attempt to the callback
  // log so it also shows up in GET /webhook-endpoints/callback-log.
  app.post('/webhook-endpoints/:id/callback-test', { onRequest: [requirePermission('webhook:test')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const endpoint = await deps.endpoints.findById(id);
    if (!endpoint) return reply.status(404).send({ error: 'WebhookEndpoint not found' });
    const sample = (req.body as { samplePayload?: Record<string, unknown> })?.samplePayload ?? {};
    const { WebhookCallbackService } = await import('../../services/webhook-callback.service.js');
    const service = new WebhookCallbackService(deps.logger, deps.callbackSender, deps.callbackNats, deps.callbackAttemptLog);
    const result = { request_id: 'callback-test', print_job_id: 'test', status: 'QUEUED', trace_id: 'test', duplicate: false };
    const delivery = await service.send({ endpoint, intakePayload: sample, result }, { trigger: 'test' });
    const ok = (delivery.http?.success ?? true) && (delivery.nats?.success ?? true);
    return { ok, id, transport: endpoint.callbackTransport, delivery };
  });

  // Real delivery history for webhook callbacks (HTTP/NATS, live + test),
  // so "did it actually respond successfully?" has a visible answer instead
  // of only showing up in process logs or requiring a unit test to check.
  app.get('/webhook-endpoints/callback-log', { onRequest: [requirePermission('webhook:read')] }, async (req, reply) => {
    const { limit, offset, outcome, transport, endpointId, printJobId, requestId } = req.query as {
      limit?: string;
      offset?: string;
      outcome?: CallbackAttemptOutcome;
      transport?: CallbackAttemptTransport;
      endpointId?: string;
      printJobId?: string;
      requestId?: string;
    };
    const invalid = validateFilters([
      ['outcome', outcome, ['success', 'failed', 'skipped']],
      ['transport', transport, ['HTTP', 'NATS']],
    ]);
    if (invalid) return reply.status(400).send({ error: 'INVALID_FILTER', message: invalid });

    const attempts = await deps.callbackAttemptLog?.findAll({
      limit: limit ? Number(limit) : 100,
      offset: offset ? Number(offset) : undefined,
      outcome,
      transport,
      endpointId,
      // printJobId / requestId were already stored on every attempt but could
      // not be filtered on, so the Job Detail page had to pull the entire log
      // to show one job's callbacks.
      printJobId,
      requestId,
    });
    return reply.send(attempts ?? []);
  });

  /**
   * Terminal result-callback deliveries.
   *
   * Distinct from `/callback-log` above: that lists individual ATTEMPTS
   * (including sandbox test fires and acceptance notifications); this lists the
   * durable DELIVERY records, one per (job, transport, destination), with the
   * retry state a caller actually needs — attempts used, next retry, final
   * verdict. The Job Detail page reads this with `?printJobId=`.
   */
  app.get('/callback-deliveries', { onRequest: [requirePermission('webhook:read')] }, async (req, reply) => {
    if (!deps.callbackDeliveries) return reply.send([]);
    const { limit, offset, printJobId, requestId, eventId, deliveryStatus, transport, endpointId } =
      req.query as {
        limit?: string;
        offset?: string;
        printJobId?: string;
        requestId?: string;
        eventId?: string;
        deliveryStatus?: CallbackDeliveryStatus;
        transport?: CallbackTransport;
        endpointId?: string;
      };
    const invalid = validateFilters([
      [
        'deliveryStatus',
        deliveryStatus,
        ['PENDING', 'DELIVERING', 'DELIVERED', 'RETRY_SCHEDULED', 'FAILED'],
      ],
      ['transport', transport, ['HTTP', 'NATS']],
    ]);
    if (invalid) return reply.status(400).send({ error: 'INVALID_FILTER', message: invalid });

    const deliveries = await deps.callbackDeliveries.findAll({
      limit: limit ? Number(limit) : 100,
      offset: offset ? Number(offset) : undefined,
      printJobId,
      requestId,
      eventId,
      deliveryStatus,
      transport,
      endpointId,
    });
    return reply.send(deliveries);
  });

  app.get('/webhook-route-policies', { onRequest: [requirePermission('webhook:read')] }, async () => deps.policies.findAll());
  app.post('/webhook-route-policies', { onRequest: [requirePermission('webhook:create')] }, async (req, reply) => {
    const raw = JSON.stringify(req.body);
    if (raw.includes('eval(') || raw.includes('Function(') || raw.includes('=>')) return reply.status(400).send({ error: 'Raw JS eval is not allowed' });
    const policy = await deps.policies.create(req.body as Parameters<typeof deps.policies.create>[0]);
    await deps.audit.create({ traceId: 'webhook', action: 'webhook_policy.created', actorId: actor(req), resourceType: 'webhook_policy', resourceId: policy.id, metadata: {} });
    return reply.status(201).send(policy);
  });
  app.put('/webhook-route-policies/:id', { onRequest: [requirePermission('webhook:update')] }, async (req, reply) => {
    const raw = JSON.stringify(req.body);
    if (raw.includes('eval(') || raw.includes('Function(') || raw.includes('=>')) return reply.status(400).send({ error: 'Raw JS eval is not allowed' });
    const { id } = req.params as { id: string };
    const policy = await deps.policies.update(id, req.body as Record<string, unknown>);
    await deps.audit.create({ traceId: 'webhook', action: 'webhook_policy.updated', actorId: actor(req), resourceType: 'webhook_policy', resourceId: id, metadata: {} });
    return policy;
  });

  app.post('/intake/:endpointCode', async (req, reply) => {
    const { endpointCode } = req.params as { endpointCode: string };
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value.join(',') : value?.toString();
    }
    const result = await deps.intake.execute({ endpointCode, headers, body: req.body as Record<string, unknown> });
    return reply.status(result.duplicate ? 200 : 202).send(result);
  });

  app.get('/sandbox/templates', { onRequest: [requirePermission('sandbox:access')] }, async () => deps.templates.findAll());
  app.post('/sandbox/render-preview', { onRequest: [requirePermission('sandbox:render-preview')] }, async (req, reply) => {
    const body = req.body as { templateId?: string; templateCode?: string; paperProfileId?: string; samplePayload?: Record<string, unknown> };
    const template = body.templateId ? await deps.templates.findById(body.templateId) : body.templateCode ? await deps.templates.findByCode(body.templateCode) : undefined;
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    const paper = body.paperProfileId ? await deps.papers.findById(body.paperProfileId) : template.paperProfileId ? await deps.papers.findById(template.paperProfileId) : undefined;
    if (!paper) return reply.status(404).send({ error: 'Paper profile not found' });
    return deps.renderer.renderPreview(template, body.samplePayload ?? {}, paper);
  });
  app.post('/sandbox/test-webhook', { onRequest: [requirePermission('webhook:test')] }, async (req) => req.body);
  app.post('/sandbox/test-print', { onRequest: [requirePermission('sandbox:send-test-print')] }, async (req, reply) => {
    const body = req.body as {
      templateId?: string;
      templateCode?: string;
      paperProfileId?: string;
      printerId?: string;
      printerCode?: string;
      copies?: number;
      duplex?: boolean;
      colorMode?: 'color' | 'monochrome' | 'auto';
      priority?: string;
      samplePayload?: Record<string, unknown>;
    };

    // Resolve template
    const template = body.templateId
      ? await deps.templates.findById(body.templateId)
      : body.templateCode
        ? await deps.templates.findByCode(body.templateCode)
        : undefined;
    if (!template) return reply.status(404).send({ error: 'Template not found' });

    // Resolve paper profile
    const paper = body.paperProfileId
      ? await deps.papers.findById(body.paperProfileId)
      : template.paperProfileId
        ? await deps.papers.findById(template.paperProfileId)
        : undefined;
    if (!paper) return reply.status(404).send({ error: 'Paper profile not found' });

    if (!body.printerId) return reply.status(400).send({ error: 'Printer is required' });

    // Apply the same physical-output gate as the direct printer test endpoint
    // before creating a queued job. Unknown is allowed when the detected
    // Windows queue is not explicitly Offline, Error, or Paused; those three
    // states are rejected without leaving a stranded QUEUED job behind.
    const printerStatus = await deps.getPrinterStatus.execute(body.printerId);
    const readiness = evaluatePrinterReadiness({
      detected: printerStatus.detected,
      statusCode: printerStatus.code,
      rawStatus: printerStatus.rawStatus,
      rawState: printerStatus.rawState,
      workOffline: printerStatus.workOffline,
    });
    if (!readiness.ready) {
      return reply.status(409).send({
        error: 'PRINTER_NOT_READY',
        message: `Printer is not ready: ${readiness.blockedBy ?? 'explicit printer fault'}`,
        status: printerStatus,
      });
    }

    // Render the actual print payload
    const rendered = await deps.renderer.renderPrintPayload(template, body.samplePayload ?? {}, paper);

    const actorId = actor(req);

    // Create a real print job
    const job = await deps.createJob.execute(
      {
        printerId: body.printerId ?? '',
        printerCode: body.printerCode,
        templateCode: template.templateCode,
        paperProfileId: paper.id,
        renderedPrintPayload: rendered.renderedPrintPayload,
        payloadSnapshot: JSON.stringify(body.samplePayload ?? {}),
        copies: body.copies ?? 1,
        duplex: body.duplex ?? false,
        colorMode: body.colorMode ?? 'auto',
        priorityLabel: PRIORITY_MAP[body.priority ?? 'normal'] ?? 'normal',
        mimeType:
          template.engine === 'HTML' ? 'text/html' :
          template.engine === 'RAW_TEXT' ? 'text/plain' :
          template.engine === 'PDF_LIKE_PREVIEW' ? 'application/pdf' :
          `application/${template.engine.toLowerCase()}`,
        createdBy: actorId,
        sourceSystem: 'sandbox',
        sourceReference: 'sandbox.test-print',
        // Driver media settings come from the selected profile. A sandbox job
        // follows the same device-confirmation rule as production: queue-only
        // acceptance is never stored as physical print success.
        metadata: {
          warnings: rendered.warnings,
          sandbox: true,
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
      actorId
    );

    // Execute in the background. Device confirmation can legitimately take
    // tens of seconds; the UI polls the persisted job instead of keeping one
    // HTTP request open and appearing frozen.
    void deps.executeJob.execute(job.id, 'sandbox-runner').then(async (completed) => {
      await deps.audit.create({
        traceId: job.traceId,
        action: 'sandbox.test_print',
        actorId,
        resourceType: 'sandbox',
        resourceId: job.id,
        metadata: {
          printerCode: body.printerCode,
          templateCode: template.templateCode,
          copies: body.copies ?? 1,
          status: completed.status,
          printerStatus: printerStatus.code,
          warnings: rendered.warnings,
        },
      });
    }).catch((err: unknown) => {
      // ExecuteJobService persists adapter failures. This catches only an
      // unexpected route-level failure so it is visible in server logs.
      app.log.error({ err, jobId: job.id }, 'sandbox background execution failed');
    });

    return reply.status(202).send({
      accepted: true,
      jobId: job.id,
      traceId: job.traceId,
      status: job.status,
      printerStatus: printerStatus.code,
      warnings: rendered.warnings,
    });
  });
}
