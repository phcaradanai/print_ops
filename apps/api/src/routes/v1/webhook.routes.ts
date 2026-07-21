import type { FastifyInstance } from 'fastify';
import type {
  AuditRepositoryPort,
  TemplateRendererPort,
  PaperProfileRepositoryPort,
  PrintTemplateRepositoryPort,
  WebhookEndpointRepositoryPort,
  WebhookRoutePolicyRepositoryPort,
  JobPriority,
} from '@printerops/domain';
import type { DynamicIntakeService } from '../../services/dynamic-intake.service.js';
import type { CreatePrintJobService } from '../../services/create-print-job.service.js';
import type { ExecuteJobService } from '../../services/execute-job.service.js';
import type { GetPrinterStatusService } from '../../services/get-printer-status.service.js';
import { actor, requirePermission } from './permission-guard.js';

const PRIORITY_MAP: Record<string, JobPriority> = {
  low: 'low', normal: 'normal', high: 'high', urgent: 'urgent',
};

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
  app.post('/webhook-endpoints/:id/test', { onRequest: [requirePermission('webhook:test')] }, async (req) => {
    const { id } = req.params as { id: string };
    await deps.audit.create({ traceId: 'webhook', action: 'webhook_endpoint.tested', actorId: actor(req), resourceType: 'webhook_endpoint', resourceId: id, metadata: {} });
    return { ok: true, id };
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
        metadata: { warnings: rendered.warnings, sandbox: true },
      },
      actorId
    );

    // ── Check printer is actually online before executing ──
    let printerStatus: { code: string; message?: string } | undefined;
    try {
      printerStatus = await deps.getPrinterStatus.execute(job.printerId);
    } catch {
      // Can't query printer status — fall through and try anyway
    }

    if (printerStatus && (printerStatus.code === 'offline' || printerStatus.code === 'error')) {
      return reply.status(502).send({
        accepted: false,
        jobId: job.id,
        traceId: job.traceId,
        status: 'FAILED',
        printerStatus: printerStatus.code,
        printerMessage: printerStatus.message ?? `Printer is ${printerStatus.code}`,
        error: `Printer is ${printerStatus.code}: ${printerStatus.message ?? 'unavailable'}`,
        warnings: rendered.warnings,
      });
    }

    // Execute immediately (synchronous for MVP)
    const completed = await deps.executeJob.execute(job.id, 'sandbox-runner');

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
        printerStatus: printerStatus?.code,
        warnings: rendered.warnings,
      },
    });

    return {
      accepted: completed.status === 'SUCCESS',
      jobId: job.id,
      traceId: job.traceId,
      status: completed.status,
      printerStatus: printerStatus?.code,
      warnings: rendered.warnings,
    };
  });
}
