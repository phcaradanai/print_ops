import type { FastifyInstance } from 'fastify';
import type {
  AuditRepositoryPort,
  PaperProfileRepositoryPort,
  PrinterTemplateBindingRepositoryPort,
  PrintTemplateRepositoryPort,
  TemplateRendererPort,
  PrinterRepositoryPort,
} from '@printerops/domain';
import { actor, requirePermission } from './permission-guard.js';

export async function templateRoutes(
  app: FastifyInstance,
  deps: {
    templates: PrintTemplateRepositoryPort;
    papers: PaperProfileRepositoryPort;
    bindings: PrinterTemplateBindingRepositoryPort;
    printers: PrinterRepositoryPort;
    renderer: TemplateRendererPort;
    audit: AuditRepositoryPort;
  }
): Promise<void> {
  app.get('/templates', { onRequest: [requirePermission('template:read')] }, async () => deps.templates.findAll());

  app.post('/templates', { onRequest: [requirePermission('template:create')] }, async (req, reply) => {
    const body = req.body as Parameters<typeof deps.templates.create>[0];
    const template = await deps.templates.create({ ...body, createdBy: actor(req), updatedBy: actor(req) });
    await deps.audit.create({ traceId: 'template', action: 'template.created', actorId: actor(req), resourceType: 'template', resourceId: template.id, after: template as unknown as Record<string, unknown>, metadata: {} });
    return reply.status(201).send(template);
  });

  app.get('/templates/:id', { onRequest: [requirePermission('template:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await deps.templates.findById(id);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    return template;
  });

  app.put('/templates/:id', { onRequest: [requirePermission('template:update')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await deps.templates.update(id, { ...(req.body as Record<string, unknown>), updatedBy: actor(req) });
    await deps.audit.create({ traceId: 'template', action: 'template.updated', actorId: actor(req), resourceType: 'template', resourceId: id, after: template as unknown as Record<string, unknown>, metadata: {} });
    return reply.send(template);
  });

  app.post('/templates/:id/preview', { onRequest: [requirePermission('template:preview')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { samplePayload?: Record<string, unknown>; paperProfileId?: string };
    const template = await deps.templates.findById(id);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    const paper = body.paperProfileId
      ? await deps.papers.findById(body.paperProfileId)
      : template.paperProfileId
        ? await deps.papers.findById(template.paperProfileId)
        : undefined;
    if (!paper) return reply.status(404).send({ error: 'Paper profile not found' });
    return deps.renderer.renderPreview(template, body.samplePayload ?? {}, paper);
  });

  app.post('/templates/:id/publish', { onRequest: [requirePermission('template:publish')] }, async (req) => {
    const { id } = req.params as { id: string };
    const template = await deps.templates.update(id, { status: 'PUBLISHED', updatedBy: actor(req) });
    await deps.audit.create({ traceId: 'template', action: 'template.published', actorId: actor(req), resourceType: 'template', resourceId: id, metadata: {} });
    return template;
  });

  app.post('/templates/:id/test-print', { onRequest: [requirePermission('sandbox:send-test-print')] }, async (req) => {
    const { id } = req.params as { id: string };
    await deps.audit.create({ traceId: 'template', action: 'template.test_print.requested', actorId: actor(req), resourceType: 'template', resourceId: id, metadata: {} });
    return { accepted: true, templateId: id };
  });

  app.get('/paper-profiles', { onRequest: [requirePermission('paper-profile:read')] }, async () => deps.papers.findAll());
  app.post('/paper-profiles', { onRequest: [requirePermission('paper-profile:create')] }, async (req, reply) => {
    const profile = await deps.papers.create(req.body as Parameters<typeof deps.papers.create>[0]);
    await deps.audit.create({ traceId: 'paper', action: 'paper_profile.created', actorId: actor(req), resourceType: 'paper_profile', resourceId: profile.id, after: profile as unknown as Record<string, unknown>, metadata: {} });
    return reply.status(201).send(profile);
  });
  app.get('/paper-profiles/:id', { onRequest: [requirePermission('paper-profile:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = await deps.papers.findById(id);
    if (!profile) return reply.status(404).send({ error: 'Paper profile not found' });
    return profile;
  });
  app.put('/paper-profiles/:id', { onRequest: [requirePermission('paper-profile:update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const profile = await deps.papers.update(id, req.body as Record<string, unknown>);
    await deps.audit.create({ traceId: 'paper', action: 'paper_profile.updated', actorId: actor(req), resourceType: 'paper_profile', resourceId: id, after: profile as unknown as Record<string, unknown>, metadata: {} });
    return profile;
  });

  app.get('/printer-template-bindings', { onRequest: [requirePermission('template:read')] }, async () => deps.bindings.findAll());
  app.post('/printer-template-bindings', { onRequest: [requirePermission('template:update')] }, async (req, reply) => reply.status(201).send(await deps.bindings.create(req.body as Parameters<typeof deps.bindings.create>[0])));
  app.put('/printer-template-bindings/:id', { onRequest: [requirePermission('template:update')] }, async (req) => {
    const { id } = req.params as { id: string };
    return deps.bindings.update(id, req.body as Record<string, unknown>);
  });
}
