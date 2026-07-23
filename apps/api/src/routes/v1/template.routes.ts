import type { FastifyInstance } from 'fastify';
import type {
  AuditRepositoryPort,
  PaperProfile,
  PaperProfileRepositoryPort,
  PrinterTemplateBindingRepositoryPort,
  PrintTemplateRepositoryPort,
  TemplateRendererPort,
  PrinterRepositoryPort,
} from '@printerops/domain';
import { actor, requirePermission } from './permission-guard.js';

/**
 * CSS anchor transform for a field's text alignment — kept in lockstep with
 * apps/web/src/pages/PaperProfiles.tsx's anchorTransform() so the printed HTML
 * lands where the paper-profile editor's preview shows it.
 */
function fieldAnchorTransform(align: PaperProfile['fields'][number]['align']): string {
  if (align === 'center') return 'transform:translateX(-50%);';
  if (align === 'right') return 'transform:translateX(-100%);';
  return '';
}

function escapeHtmlAttr(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render a paper profile's fields as absolutely-positioned {{key}} spans, in
 * real mm/pt units — this is what "print at the real position" means: no
 * ZPL/TSPL dot-coordinate generation, just HTML the existing HTML engine
 * (and WindowsSpoolerAdapter's printHtml) already renders literally.
 */
function buildFieldsTemplateHtml(profile: PaperProfile): string {
  const naturalOrientation = profile.widthMm > profile.heightMm ? 'landscape' : 'portrait';
  const rotated = naturalOrientation !== profile.orientation;
  const widthMm = rotated ? profile.heightMm : profile.widthMm;
  const heightMm = rotated ? profile.widthMm : profile.heightMm;
  const sourcePrintableHeightMm = Math.max(
    0,
    profile.heightMm - profile.marginTopMm - profile.marginBottomMm,
  );
  const spans = (profile.fields ?? [])
    .map((f) => {
      const placeholderKey = f.key.trim() || f.id;
      // Match mapPrintablePointToVisual() in the profile editor. Rotate only
      // the stored coordinate system; keeping the span itself unrotated means
      // text and barcodes stay upright exactly as they do in the preview.
      const xMm = rotated ? sourcePrintableHeightMm - f.yMm : f.xMm;
      const yMm = rotated ? f.xMm : f.yMm;
      const style =
        `position:absolute;left:${xMm}mm;top:${yMm}mm;` +
        `font-size:${f.fontSize}pt;font-weight:${f.bold ? 700 : 400};` +
        `color:${escapeHtmlAttr(f.color)};white-space:nowrap;` +
        fieldAnchorTransform(f.align);
      return `  <span style="${style}">{{${placeholderKey}}}</span>`;
    })
    .join('\n');
  return `<div style="position:relative;width:${widthMm}mm;height:${heightMm}mm;">\n${spans}\n</div>`;
}

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

  /**
   * Deleting a template that a printer binding still points at would break
   * dispatch at print time with no trace back to this action, so a bound
   * template is refused (409) instead of silently removed.
   */
  app.delete('/templates/:id', { onRequest: [requirePermission('template:delete')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await deps.templates.findById(id);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    const bound = await deps.bindings.findAll({ templateCode: template.templateCode });
    if (bound.length > 0) {
      return reply.status(409).send({
        error: 'Template is bound to a printer',
        bindings: bound.map((b) => b.printerCode),
      });
    }
    await deps.templates.delete(id);
    await deps.audit.create({ traceId: 'template', action: 'template.deleted', actorId: actor(req), resourceType: 'template', resourceId: id, before: template as unknown as Record<string, unknown>, metadata: {} });
    return reply.send({ deleted: true, id });
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

  /**
   * Keep a paper profile's fields and its companion print template in sync,
   * one HTML template per profile. Without this, a profile's fields (set up
   * visually, with a key per field) had nowhere to go: the template had to be
   * hand-authored with matching {{key}} text and no link back to the profile.
   */
  async function uniqueTemplateCode(base: string): Promise<string> {
    let candidate = `${base}_auto`;
    for (let suffix = 2; await deps.templates.findByCode(candidate); suffix++) {
      candidate = `${base}_auto_${suffix}`;
    }
    return candidate;
  }

  async function ensureFieldsTemplate(profile: PaperProfile, createdBy: string): Promise<void> {
    const content = buildFieldsTemplateHtml(profile);
    const existing = (await deps.templates.findAll()).find(
      (t) => t.paperProfileId === profile.id && t.engine === 'HTML',
    );
    if (existing) {
      if (existing.content !== content) {
        await deps.templates.update(existing.id, { content });
      }
      return;
    }
    const template = await deps.templates.create({
      templateCode: await uniqueTemplateCode(profile.code),
      name: `${profile.name} (auto)`,
      engine: 'HTML',
      content,
      paperProfileId: profile.id,
      createdBy,
    });
    await deps.audit.create({ traceId: 'paper', action: 'template.auto_created', actorId: createdBy, resourceType: 'template', resourceId: template.id, after: template as unknown as Record<string, unknown>, metadata: { paperProfileId: profile.id } });
  }

  app.get('/paper-profiles', { onRequest: [requirePermission('paper-profile:read')] }, async () => deps.papers.findAll());
  app.post('/paper-profiles', { onRequest: [requirePermission('paper-profile:create')] }, async (req, reply) => {
    const profile = await deps.papers.create(req.body as Parameters<typeof deps.papers.create>[0]);
    await deps.audit.create({ traceId: 'paper', action: 'paper_profile.created', actorId: actor(req), resourceType: 'paper_profile', resourceId: profile.id, after: profile as unknown as Record<string, unknown>, metadata: {} });
    await ensureFieldsTemplate(profile, actor(req));
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
    await ensureFieldsTemplate(profile, actor(req));
    return profile;
  });

  app.get('/printer-template-bindings', { onRequest: [requirePermission('template:read')] }, async () => deps.bindings.findAll());
  app.post('/printer-template-bindings', { onRequest: [requirePermission('template:update')] }, async (req, reply) => reply.status(201).send(await deps.bindings.create(req.body as Parameters<typeof deps.bindings.create>[0])));
  app.put('/printer-template-bindings/:id', { onRequest: [requirePermission('template:update')] }, async (req) => {
    const { id } = req.params as { id: string };
    return deps.bindings.update(id, req.body as Record<string, unknown>);
  });
}
