import type { FastifyInstance } from 'fastify';
import type {
  AuditRepositoryPort,
  TemplateRendererPort,
  PaperProfileRepositoryPort,
  PrintTemplateRepositoryPort,
  WebhookEndpointRepositoryPort,
  WebhookRoutePolicyRepositoryPort,
} from '@printerops/domain';
import type { DynamicIntakeService } from '../../services/dynamic-intake.service.js';
import { actor, requirePermission } from './permission-guard.js';

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
  app.post('/sandbox/test-print', { onRequest: [requirePermission('sandbox:send-test-print')] }, async (req) => {
    await deps.audit.create({ traceId: 'sandbox', action: 'sandbox.test_print', actorId: actor(req), resourceType: 'sandbox', resourceId: 'test-print', metadata: {} });
    return { accepted: true };
  });
}
