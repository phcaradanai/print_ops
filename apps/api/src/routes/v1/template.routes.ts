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
import {
  coerceImportNumber,
  validatePaperProfileCreate,
  validatePaperProfileUpdate,
} from './paper-profile-validation.js';

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
      const isMachineReadable = f.type === 'barcode' || f.type === 'qrcode';
      const style =
        `position:absolute;left:${xMm}mm;top:${yMm}mm;` +
        (isMachineReadable
          ? 'font-size:0;line-height:0;'
          : `font-size:${f.fontSize}pt;font-weight:${f.bold ? 700 : 400};color:${escapeHtmlAttr(f.color)};`) +
        `white-space:nowrap;` +
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
    const body = req.body as { samplePayload?: Record<string, unknown>; paperProfileId?: string; rotate?: number; flipHorizontal?: boolean; flipVertical?: boolean };
    const template = await deps.templates.findById(id);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    const paper = body.paperProfileId
      ? await deps.papers.findById(body.paperProfileId)
      : template.paperProfileId
        ? await deps.papers.findById(template.paperProfileId)
        : undefined;
    if (!paper) return reply.status(404).send({ error: 'Paper profile not found' });
    const renderOptions = {
      ...(body.rotate !== undefined ? { rotate: body.rotate } : {}),
      ...(body.flipHorizontal !== undefined ? { flipHorizontal: body.flipHorizontal } : {}),
      ...(body.flipVertical !== undefined ? { flipVertical: body.flipVertical } : {}),
    };
    return Object.keys(renderOptions).length > 0
      ? deps.renderer.renderPreview(template, body.samplePayload ?? {}, paper, renderOptions)
      : deps.renderer.renderPreview(template, body.samplePayload ?? {}, paper);
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
    const issues = validatePaperProfileCreate((req.body ?? {}) as Record<string, unknown>);
    if (issues.length > 0) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: issues[0]!.message, issues });
    }
    const profile = await deps.papers.create(req.body as Parameters<typeof deps.papers.create>[0]);
    await deps.audit.create({ traceId: 'paper', action: 'paper_profile.created', actorId: actor(req), resourceType: 'paper_profile', resourceId: profile.id, after: profile as unknown as Record<string, unknown>, metadata: {} });
    await ensureFieldsTemplate(profile, actor(req));
    return reply.status(201).send(profile);
  });

  app.post('/paper-profiles/export', { onRequest: [requirePermission('paper-profile:read')] }, async (req, reply) => {
    const body = (req.body ?? {}) as { ids?: string[] };
    const all = await deps.papers.findAll();
    const targets = body.ids && body.ids.length > 0
      ? all.filter((p) => body.ids!.includes(p.id))
      : all;

    await deps.audit.create({
      traceId: 'paper',
      action: 'paper_profile.exported',
      actorId: actor(req),
      resourceType: 'paper_profile',
      resourceId: 'batch',
      metadata: { count: targets.length },
    });

    const exportData = {
      version: '1.0',
      type: 'paper_profile_export',
      exportedAt: new Date().toISOString(),
      profiles: targets.map((profile) => ({
        code: profile.code,
        name: profile.name,
        widthMm: profile.widthMm,
        heightMm: profile.heightMm,
        marginTopMm: profile.marginTopMm,
        marginRightMm: profile.marginRightMm,
        marginBottomMm: profile.marginBottomMm,
        rotation: profile.rotation ?? 0,
        flipHorizontal: profile.flipHorizontal ?? false,
        flipVertical: profile.flipVertical ?? false,
        marginLeftMm: profile.marginLeftMm,
        dpi: profile.dpi,
        orientation: profile.orientation,
        unit: profile.unit,
        fields: profile.fields ?? [],
      })),
    };

    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', 'attachment; filename="paper-profiles-export.json"')
      .send(exportData);
  });

  app.post('/paper-profiles/import', { onRequest: [requirePermission('paper-profile:create')] }, async (req, reply) => {
    const rawBody = (req.body ?? {}) as any;
    const query = (req.query ?? {}) as { overwrite?: string };
    const overwrite = query.overwrite === 'true' || query.overwrite === '1' || Boolean(rawBody?.overwrite);

    let rawProfiles: any[] = [];
    if (Array.isArray(rawBody)) {
      rawProfiles = rawBody;
    } else if (rawBody && Array.isArray(rawBody.profiles)) {
      rawProfiles = rawBody.profiles;
    } else if (rawBody && typeof rawBody === 'object') {
      rawProfiles = [rawBody];
    }

    if (rawProfiles.length === 0) {
      return reply.status(400).send({ error: 'No paper profiles found in import payload' });
    }

    const importedResults: PaperProfile[] = [];

    for (const item of rawProfiles) {
      if (!item.name || typeof item.name !== 'string' || !item.name.trim()) {
        return reply.status(400).send({ error: 'Invalid profile: name is required' });
      }
      const baseCode = (item.code && typeof item.code === 'string' && item.code.trim())
        ? item.code.trim()
        : item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

      // A missing numeric field keeps its legacy default, but a PRESENT value
      // that is not a usable number is a client error — silently replacing it
      // with a default prints on the wrong physical size without anyone asking.
      const numericFields: Array<[string, number]> = [
        ['widthMm', 100],
        ['heightMm', 150],
        ['marginTopMm', 0],
        ['marginRightMm', 0],
        ['marginBottomMm', 0],
        ['rotation', 0],
        ['marginLeftMm', 0],
        ['dpi', 203],
      ];
      const numbers: Record<string, number> = {};
      for (const [field, fallback] of numericFields) {
        const coerced = coerceImportNumber(item[field], fallback);
        if ('invalid' in coerced) {
          return reply.status(400).send({
            error: 'VALIDATION_ERROR',
            message: `Invalid profile '${baseCode}': ${field} is not a valid number`,
            issues: [{ field, message: `${field} is not a valid number` }],
          });
        }
        numbers[field] = coerced.value;
      }

      const profileInput = {
        code: baseCode,
        name: item.name.trim(),
        widthMm: numbers['widthMm']!,
        heightMm: numbers['heightMm']!,
        marginTopMm: numbers['marginTopMm']!,
        marginRightMm: numbers['marginRightMm']!,
        marginBottomMm: numbers['marginBottomMm']!,
        marginLeftMm: numbers['marginLeftMm']!,
        dpi: numbers['dpi']!,
        orientation: (item.orientation === 'landscape' ? 'landscape' : 'portrait') as 'portrait' | 'landscape',
        unit: (item.unit === 'inch' ? 'inch' : 'mm') as 'mm' | 'inch',
        rotation: numbers['rotation']!,
        flipHorizontal: item.flipHorizontal ?? false,
        flipVertical: item.flipVertical ?? false,
        fields: Array.isArray(item.fields) ? item.fields : [],
      };

      const geometryIssues = validatePaperProfileCreate(profileInput as unknown as Record<string, unknown>);
      if (geometryIssues.length > 0) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: `Invalid profile '${baseCode}': ${geometryIssues[0]!.message}`,
          issues: geometryIssues,
        });
      }

      const existing = await deps.papers.findByCode(profileInput.code);
      let finalProfile: PaperProfile;

      if (existing) {
        if (overwrite) {
          finalProfile = await deps.papers.update(existing.id, profileInput);
        } else {
          let candidateCode = `${profileInput.code}_copy`;
          for (let suffix = 2; await deps.papers.findByCode(candidateCode); suffix++) {
            candidateCode = `${profileInput.code}_copy_${suffix}`;
          }
          finalProfile = await deps.papers.create({ ...profileInput, code: candidateCode });
        }
      } else {
        finalProfile = await deps.papers.create(profileInput);
      }

      await ensureFieldsTemplate(finalProfile, actor(req));
      await deps.audit.create({
        traceId: 'paper',
        action: 'paper_profile.imported',
        actorId: actor(req),
        resourceType: 'paper_profile',
        resourceId: finalProfile.id,
        after: finalProfile as unknown as Record<string, unknown>,
        metadata: { originalCode: profileInput.code },
      });

      importedResults.push(finalProfile);
    }

    return reply.status(201).send({ imported: importedResults, count: importedResults.length });
  });

  app.get('/paper-profiles/:id', { onRequest: [requirePermission('paper-profile:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = await deps.papers.findById(id);
    if (!profile) return reply.status(404).send({ error: 'Paper profile not found' });
    return profile;
  });

  app.get('/paper-profiles/:id/export', { onRequest: [requirePermission('paper-profile:read')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = await deps.papers.findById(id);
    if (!profile) return reply.status(404).send({ error: 'Paper profile not found' });

    await deps.audit.create({
      traceId: 'paper',
      action: 'paper_profile.exported',
      actorId: actor(req),
      resourceType: 'paper_profile',
      resourceId: id,
      metadata: { single: true },
    });

    const exportData = {
      version: '1.0',
      type: 'paper_profile_export',
      exportedAt: new Date().toISOString(),
      profiles: [
        {
          code: profile.code,
          name: profile.name,
          widthMm: profile.widthMm,
          heightMm: profile.heightMm,
          marginTopMm: profile.marginTopMm,
          marginRightMm: profile.marginRightMm,
          marginBottomMm: profile.marginBottomMm,
          marginLeftMm: profile.marginLeftMm,
          dpi: profile.dpi,
          orientation: profile.orientation,
          unit: profile.unit,
          rotation: profile.rotation ?? 0,
          flipHorizontal: profile.flipHorizontal ?? false,
          flipVertical: profile.flipVertical ?? false,
          fields: profile.fields ?? [],
        },
      ],
    };

    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="paper-profile-${profile.code}.json"`)
      .send(exportData);
  });

  app.put('/paper-profiles/:id', { onRequest: [requirePermission('paper-profile:update')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await deps.papers.findById(id);
    if (!existing) return reply.status(404).send({ error: 'Paper profile not found' });
    const issues = validatePaperProfileUpdate(existing, (req.body ?? {}) as Record<string, unknown>);
    if (issues.length > 0) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: issues[0]!.message, issues });
    }
    const profile = await deps.papers.update(id, req.body as Record<string, unknown>);
    await deps.audit.create({ traceId: 'paper', action: 'paper_profile.updated', actorId: actor(req), resourceType: 'paper_profile', resourceId: id, after: profile as unknown as Record<string, unknown>, metadata: {} });
    await ensureFieldsTemplate(profile, actor(req));
    return profile;
  });

  app.delete('/paper-profiles/:id', { onRequest: [requirePermission('paper-profile:delete')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = await deps.papers.findById(id);
    if (!profile) return reply.status(404).send({ error: 'Paper profile not found' });

    const templates = await deps.templates.findAll();
    const customReferencingTemplates = templates.filter(
      (t) => t.paperProfileId === id && !t.name.endsWith('(auto)'),
    );
    if (customReferencingTemplates.length > 0) {
      return reply.status(409).send({
        error: 'Paper profile is used by templates',
        templates: customReferencingTemplates.map((t) => t.name),
      });
    }

    const autoTemplates = templates.filter((t) => t.paperProfileId === id && t.name.endsWith('(auto)'));
    for (const autoT of autoTemplates) {
      await deps.templates.delete(autoT.id);
    }

    await deps.papers.delete(id);
    await deps.audit.create({
      traceId: 'paper',
      action: 'paper_profile.deleted',
      actorId: actor(req),
      resourceType: 'paper_profile',
      resourceId: id,
      before: profile as unknown as Record<string, unknown>,
      metadata: {},
    });
    return reply.send({ deleted: true, id });
  });

  app.get('/printer-template-bindings', { onRequest: [requirePermission('template:read')] }, async () => deps.bindings.findAll());
  app.post('/printer-template-bindings', { onRequest: [requirePermission('template:update')] }, async (req, reply) => reply.status(201).send(await deps.bindings.create(req.body as Parameters<typeof deps.bindings.create>[0])));
  app.put('/printer-template-bindings/:id', { onRequest: [requirePermission('template:update')] }, async (req) => {
    const { id } = req.params as { id: string };
    return deps.bindings.update(id, req.body as Record<string, unknown>);
  });
  app.delete('/printer-template-bindings/:id', { onRequest: [requirePermission('template:update')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deps.bindings.delete(id);
    return reply.send({ deleted: true, id });
  });
}
