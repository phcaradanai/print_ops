import { createHash } from 'node:crypto';
import type {
  ControlCommandProgress,
  ControlContentBundle,
  ControlContentIndex,
  ControlContentKind,
  ControlPaperProfileContent,
  ControlPrintTemplateContent,
  PaperProfile,
  PaperProfileRepositoryPort,
  PrintTemplate,
  PrintTemplateRepositoryPort,
} from '@printerops/domain';
import { ConflictError, NotFoundError, ValidationError } from '@printerops/shared';

export const MAX_CONTROL_CONTENT_BYTES = 256 * 1024;

export interface ControlContentSyncResult {
  kind: ControlContentKind;
  key: string;
  profile: 'created' | 'updated' | 'unchanged' | 'none';
  template: 'created' | 'updated' | 'unchanged' | 'none';
}

export interface ControlContentImportResult {
  kind: ControlContentKind;
  sourceCode: string;
  importedCode: string;
  profile: 'created' | 'unchanged' | 'none';
  template: 'created' | 'none';
}

export class ControlContentSyncService {
  constructor(
    private readonly profiles: PaperProfileRepositoryPort,
    private readonly templates: PrintTemplateRepositoryPort,
  ) {}

  async createBundle(input: {
    kind: ControlContentKind;
    itemId: string;
    overwriteExisting: boolean;
    publishedBy: string;
  }): Promise<ControlContentBundle> {
    let profile: ControlPaperProfileContent | undefined;
    let template: ControlPrintTemplateContent | undefined;
    let itemCode: string;

    if (input.kind === 'paper-profile') {
      const source = await this.profiles.findById(input.itemId);
      if (!source) throw new NotFoundError('Paper profile', input.itemId);
      profile = toProfileContent(source);
      itemCode = source.code;
    } else {
      const source = await this.templates.findById(input.itemId);
      if (!source) throw new NotFoundError('Template', input.itemId);
      const paper = source.paperProfileId
        ? await this.profiles.findById(source.paperProfileId)
        : undefined;
      if (source.paperProfileId && !paper) {
        throw new ConflictError(`Template ${source.templateCode} references a missing paper profile`);
      }
      template = toTemplateContent(source, paper?.code);
      if (paper) profile = toProfileContent(paper);
      itemCode = source.templateCode;
    }

    const content = input.kind === 'paper-profile' ? profile : { profile, template };
    const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const bundle: ControlContentBundle = {
      version: 1,
      kind: input.kind,
      key: `${input.kind}:${itemCode}:${digest.slice(0, 16)}`,
      overwriteExisting: input.overwriteExisting,
      publishedBy: input.publishedBy,
      ...(profile ? { profile } : {}),
      ...(template ? { template } : {}),
    };
    assertBundleSize(bundle);
    return bundle;
  }

  async createClientContentIndex(): Promise<ControlContentIndex> {
    const maxItems = 500;
    const [allProfiles, allTemplates] = await Promise.all([
      this.profiles.findAll({ limit: maxItems + 1 }),
      this.templates.findAll({ limit: maxItems + 1 }),
    ]);
    const profileCodes = new Map(allProfiles.map((profile) => [profile.id, profile.code]));
    const profileIds = [...new Set(allTemplates.slice(0, maxItems).flatMap((template) =>
      template.paperProfileId && !profileCodes.has(template.paperProfileId) ? [template.paperProfileId] : []))];
    const linkedProfiles = await Promise.all(profileIds.map((id) => this.profiles.findById(id)));
    for (const profile of linkedProfiles) {
      if (profile) profileCodes.set(profile.id, profile.code);
    }

    const index: ControlContentIndex = {
      version: 1,
      generatedAt: new Date().toISOString(),
      profiles: allProfiles.slice(0, maxItems).map((profile) => ({
        code: profile.code,
        name: profile.name,
        widthMm: profile.widthMm,
        heightMm: profile.heightMm,
        dpi: profile.dpi,
        orientation: profile.orientation,
        updatedAt: profile.updatedAt.toISOString(),
      })),
      templates: allTemplates.slice(0, maxItems).map((template) => ({
        templateCode: template.templateCode,
        name: template.name,
        engine: template.engine,
        status: template.status,
        ...(template.paperProfileId && profileCodes.has(template.paperProfileId)
          ? { paperProfileCode: profileCodes.get(template.paperProfileId)! }
          : {}),
        updatedAt: template.updatedAt.toISOString(),
      })),
      truncated: allProfiles.length > maxItems || allTemplates.length > maxItems,
    };
    if (Buffer.byteLength(JSON.stringify(index), 'utf8') > MAX_CONTROL_CONTENT_BYTES) {
      throw new ValidationError(`Client content index exceeds the ${MAX_CONTROL_CONTENT_BYTES} byte control-channel limit`);
    }
    return index;
  }

  async createClientContentBundle(kind: ControlContentKind, code: string): Promise<ControlContentBundle> {
    const item = kind === 'paper-profile'
      ? await this.profiles.findByCode(code)
      : await this.templates.findByCode(code);
    if (!item) throw new NotFoundError(kind === 'paper-profile' ? 'Paper profile' : 'Template', code);
    return this.createBundle({
      kind,
      itemId: item.id,
      overwriteExisting: false,
      publishedBy: 'printops-client-export',
    });
  }

  async importClientBundle(
    value: unknown,
    input: { importedBy: string; code?: string },
  ): Promise<ControlContentImportResult> {
    const bundle = validateBundle(value);
    if (bundle.overwriteExisting) {
      throw new ValidationError('Client content imports cannot overwrite Web Control catalog items');
    }
    if (!input.importedBy.trim()) throw new ValidationError('Importer identity is required');
    const targetCode = input.code?.trim();
    if (targetCode && (targetCode.length > 128 || /[\r\n]/.test(targetCode))) {
      throw new ValidationError('Import code must be at most 128 characters and contain no line breaks');
    }

    if (bundle.kind === 'paper-profile') {
      const incoming = { ...bundle.profile!, ...(targetCode ? { code: targetCode } : {}) };
      const existing = await this.profiles.findByCode(incoming.code);
      if (existing && !sameProfile(existing, incoming)) {
        throw new ConflictError(`Paper profile ${incoming.code} already exists in Web Control. Choose another code to import a separate copy.`);
      }
      if (existing) {
        return {
          kind: bundle.kind,
          sourceCode: bundle.profile!.code,
          importedCode: incoming.code,
          profile: 'unchanged',
          template: 'none',
        };
      }
      await this.profiles.create(incoming);
      return {
        kind: bundle.kind,
        sourceCode: bundle.profile!.code,
        importedCode: incoming.code,
        profile: 'created',
        template: 'none',
      };
    }

    const incomingTemplate = {
      ...bundle.template!,
      ...(targetCode ? { templateCode: targetCode } : {}),
      status: 'DRAFT' as const,
    };
    const existingTemplate = await this.templates.findByCode(incomingTemplate.templateCode);
    if (existingTemplate) {
      throw new ConflictError(`Template ${incomingTemplate.templateCode} already exists in Web Control. Choose another code to import a separate draft copy.`);
    }

    const incomingProfile = bundle.profile ? { ...bundle.profile } : undefined;
    if (incomingProfile && incomingProfile.code !== incomingTemplate.paperProfileCode) {
      throw new ValidationError('Template content includes a paper profile that does not match its paperProfileCode');
    }
    let linkedProfile = incomingTemplate.paperProfileCode
      ? await this.profiles.findByCode(incomingTemplate.paperProfileCode)
      : undefined;
    let profileResult: ControlContentImportResult['profile'] = 'none';
    if (incomingProfile) {
      if (linkedProfile && !sameProfile(linkedProfile, incomingProfile)) {
        throw new ConflictError(`Template requires paper profile ${incomingProfile.code}, which already has different Web Control data. Import or reconcile that profile first.`);
      }
      if (linkedProfile) {
        profileResult = 'unchanged';
      } else {
        linkedProfile = await this.profiles.create(incomingProfile);
        profileResult = 'created';
      }
    }
    if (incomingTemplate.paperProfileCode && !linkedProfile) {
      throw new ConflictError(`Template requires paper profile ${incomingTemplate.paperProfileCode}, which is not in Web Control and was not included by the client.`);
    }

    await this.templates.create({
      templateCode: incomingTemplate.templateCode,
      name: incomingTemplate.name,
      ...(incomingTemplate.description !== undefined ? { description: incomingTemplate.description } : {}),
      engine: incomingTemplate.engine,
      content: incomingTemplate.content,
      status: 'DRAFT',
      createdBy: input.importedBy,
      updatedBy: input.importedBy,
      ...(linkedProfile ? { paperProfileId: linkedProfile.id } : {}),
    });
    return {
      kind: bundle.kind,
      sourceCode: bundle.template!.templateCode,
      importedCode: incomingTemplate.templateCode,
      profile: profileResult,
      template: 'created',
    };
  }

  async applyBundle(
    value: unknown,
    onProgress?: (progress: ControlCommandProgress) => void | Promise<void>,
  ): Promise<ControlContentSyncResult> {
    const bundle = validateBundle(value);
    const existingProfile = bundle.profile
      ? await this.profiles.findByCode(bundle.profile.code)
      : undefined;
    const existingTemplate = bundle.template
      ? await this.templates.findByCode(bundle.template.templateCode)
      : undefined;

    if (existingProfile && !bundle.overwriteExisting && !sameProfile(existingProfile, bundle.profile!)) {
      throw new ConflictError(`Paper profile ${bundle.profile!.code} already exists with local changes; enable replace to update it`);
    }

    let linkedPaper = existingProfile;
    if (bundle.template?.paperProfileCode) {
      linkedPaper = (await this.profiles.findByCode(bundle.template.paperProfileCode)) ?? existingProfile;
      const includedProfile = bundle.profile?.code === bundle.template.paperProfileCode;
      if (!linkedPaper && !includedProfile) {
        throw new ConflictError(`Required paper profile ${bundle.template.paperProfileCode} is not available on this client`);
      }
    }

    if (existingTemplate && !bundle.overwriteExisting
      && !sameTemplate(existingTemplate, bundle.template!, linkedPaper?.id)) {
      throw new ConflictError(`Template ${bundle.template!.templateCode} already exists with local changes; enable replace to update it`);
    }

    const workItems: Array<{ phase: 'syncing-profile' | 'syncing-template'; item: string }> = [];
    if (bundle.profile) workItems.push({ phase: 'syncing-profile', item: bundle.profile.name || bundle.profile.code });
    if (bundle.template) workItems.push({ phase: 'syncing-template', item: bundle.template.name || bundle.template.templateCode });
    let completed = 0;
    const reportProgress = async (nextItem = workItems[completed]) => {
      const total = workItems.length;
      await onProgress?.({
        current: completed,
        total,
        percent: Math.floor((completed / total) * 100),
        mode: 'steps',
        phase: nextItem?.phase ?? 'completed',
        ...(nextItem?.item ? { item: nextItem.item } : {}),
      });
    };
    if (workItems.length > 0) await reportProgress();

    let profileResult: ControlContentSyncResult['profile'] = 'none';
    if (bundle.profile) {
      if (!existingProfile) {
        linkedPaper = await this.profiles.create(bundle.profile);
        profileResult = 'created';
      } else if (sameProfile(existingProfile, bundle.profile)) {
        profileResult = 'unchanged';
      } else {
        linkedPaper = await this.profiles.update(existingProfile.id, bundle.profile);
        profileResult = 'updated';
      }
      completed += 1;
      await reportProgress();
    }

    let templateResult: ControlContentSyncResult['template'] = 'none';
    if (bundle.template) {
      const templateInput = {
        templateCode: bundle.template.templateCode,
        name: bundle.template.name,
        ...(bundle.template.description !== undefined ? { description: bundle.template.description } : {}),
        engine: bundle.template.engine,
        content: bundle.template.content,
        status: bundle.template.status,
        ...(linkedPaper ? { paperProfileId: linkedPaper.id } : {}),
      };
      if (!existingTemplate) {
        await this.templates.create({ ...templateInput, createdBy: bundle.publishedBy });
        templateResult = 'created';
      } else if (sameTemplate(existingTemplate, bundle.template, linkedPaper?.id)) {
        templateResult = 'unchanged';
      } else {
        await this.templates.update(existingTemplate.id, {
          ...templateInput,
          updatedBy: bundle.publishedBy,
        });
        templateResult = 'updated';
      }
      completed += 1;
      await reportProgress();
    }

    return { kind: bundle.kind, key: bundle.key, profile: profileResult, template: templateResult };
  }
}

function toProfileContent(profile: PaperProfile): ControlPaperProfileContent {
  return {
    code: profile.code,
    name: profile.name,
    widthMm: profile.widthMm,
    gapMm: profile.gapMm ?? 0,
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
    ...(profile.layout ? { layout: profile.layout } : {}),
    fields: profile.fields ?? [],
  };
}

function toTemplateContent(template: PrintTemplate, paperProfileCode?: string): ControlPrintTemplateContent {
  return {
    templateCode: template.templateCode,
    name: template.name,
    ...(template.description !== undefined ? { description: template.description } : {}),
    engine: template.engine,
    content: template.content,
    status: template.status,
    ...(paperProfileCode ? { paperProfileCode } : {}),
  };
}

function sameProfile(existing: PaperProfile, incoming: ControlPaperProfileContent): boolean {
  return JSON.stringify(toProfileContent(existing)) === JSON.stringify(incoming);
}

function sameTemplate(
  existing: PrintTemplate,
  incoming: ControlPrintTemplateContent,
  localPaperProfileId?: string,
): boolean {
  const current = {
    templateCode: existing.templateCode,
    name: existing.name,
    ...(existing.description !== undefined ? { description: existing.description } : {}),
    engine: existing.engine,
    content: existing.content,
    status: existing.status,
    paperProfileId: existing.paperProfileId,
  };
  const next = {
    templateCode: incoming.templateCode,
    name: incoming.name,
    ...(incoming.description !== undefined ? { description: incoming.description } : {}),
    engine: incoming.engine,
    content: incoming.content,
    status: incoming.status,
    paperProfileId: incoming.paperProfileCode ? localPaperProfileId : undefined,
  };
  return JSON.stringify(current) === JSON.stringify(next);
}

function validateBundle(value: unknown): ControlContentBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Content bundle must be an object');
  }
  const bundle = value as Partial<ControlContentBundle>;
  if (bundle.version !== 1 || !['paper-profile', 'template'].includes(String(bundle.kind))) {
    throw new ValidationError('Unsupported content bundle version or kind');
  }
  if (!bundle.key || typeof bundle.key !== 'string' || bundle.key.length > 256) {
    throw new ValidationError('Content bundle key is invalid');
  }
  if (typeof bundle.overwriteExisting !== 'boolean' || !bundle.publishedBy || typeof bundle.publishedBy !== 'string') {
    throw new ValidationError('Content bundle policy or publisher is invalid');
  }
  if (bundle.kind === 'paper-profile' && !bundle.profile) {
    throw new ValidationError('Paper profile content is missing');
  }
  if (bundle.kind === 'template' && !bundle.template) {
    throw new ValidationError('Template content is missing');
  }
  if (bundle.profile && (!bundle.profile.code?.trim() || !bundle.profile.name?.trim())) {
    throw new ValidationError('Paper profile code and name are required');
  }
  if (bundle.profile) validateProfileContent(bundle.profile);
  if (bundle.template && (!bundle.template.templateCode?.trim() || !bundle.template.name?.trim())) {
    throw new ValidationError('Template code and name are required');
  }
  if (bundle.template) validateTemplateContent(bundle.template);
  assertBundleSize(bundle as ControlContentBundle);
  return bundle as ControlContentBundle;
}

function validateProfileContent(profile: ControlPaperProfileContent): void {
  for (const field of ['widthMm', 'heightMm', 'dpi'] as const) {
    if (!Number.isFinite(profile[field]) || profile[field] <= 0) {
      throw new ValidationError(`Paper profile ${profile.code} has an invalid ${field}`);
    }
  }
  for (const field of ['gapMm', 'marginTopMm', 'marginRightMm', 'marginBottomMm', 'marginLeftMm'] as const) {
    const value = profile[field] ?? 0;
    if (!Number.isFinite(value) || value < 0) throw new ValidationError(`Paper profile ${profile.code} has an invalid ${field}`);
  }
  if (!['portrait', 'landscape'].includes(profile.orientation) || !['mm', 'inch'].includes(profile.unit)) {
    throw new ValidationError(`Paper profile ${profile.code} has an invalid orientation or unit`);
  }
  if (!Array.isArray(profile.fields) || profile.fields.length > 200) {
    throw new ValidationError(`Paper profile ${profile.code} has an invalid fields list`);
  }
}

function validateTemplateContent(template: ControlPrintTemplateContent): void {
  const engines = ['RAW_TEXT', 'DPL', 'ZPL', 'TSPL', 'EPL', 'HTML', 'PDF_LIKE_PREVIEW', 'JSON_LAYOUT'];
  const statuses = ['DRAFT', 'PUBLISHED', 'DISABLED', 'ARCHIVED'];
  if (!engines.includes(template.engine) || !statuses.includes(template.status)) {
    throw new ValidationError(`Template ${template.templateCode} has an invalid engine or status`);
  }
  if (typeof template.content !== 'string' || template.content.length > MAX_CONTROL_CONTENT_BYTES) {
    throw new ValidationError(`Template ${template.templateCode} content is invalid or too large`);
  }
}

function assertBundleSize(bundle: ControlContentBundle): void {
  const bytes = Buffer.byteLength(JSON.stringify(bundle), 'utf8');
  if (bytes > MAX_CONTROL_CONTENT_BYTES) {
    throw new ValidationError(`Content bundle exceeds the ${MAX_CONTROL_CONTENT_BYTES} byte control-channel limit`);
  }
}
