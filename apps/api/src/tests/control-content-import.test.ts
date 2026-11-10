import { describe, expect, it } from 'vitest';
import type { ControlCommandProgress } from '@printerops/domain';
import { ConflictError } from '@printerops/shared';
import { InMemoryPaperProfileRepository } from '../infra/repos/in-memory-paper-profile.repo.js';
import { InMemoryPrintTemplateRepository } from '../infra/repos/in-memory-template.repo.js';
import { ControlContentSyncService } from '../services/control-content-sync.service.js';

async function sourceContent() {
  const profiles = new InMemoryPaperProfileRepository();
  const templates = new InMemoryPrintTemplateRepository();
  const profile = await profiles.create({
    code: 'CLIENT_50X30',
    name: 'Client label 50 by 30',
    widthMm: 50,
    heightMm: 30,
    marginTopMm: 1,
    marginRightMm: 1,
    marginBottomMm: 1,
    marginLeftMm: 1,
    dpi: 203,
    orientation: 'portrait',
    unit: 'mm',
    fields: [],
  });
  await templates.create({
    templateCode: 'CLIENT_LABEL',
    name: 'Client label template',
    engine: 'ZPL',
    content: '^XA^FO20,20^FD{{label}}^FS^XZ',
    status: 'PUBLISHED',
    paperProfileId: profile.id,
    createdBy: 'client-admin',
  });
  return { profiles, templates, profile };
}

describe('Web Control client content import', () => {
  it('lists client metadata and imports a pulled template as an editable draft with its profile', async () => {
    const source = await sourceContent();
    const sourceService = new ControlContentSyncService(source.profiles, source.templates);
    const index = await sourceService.createClientContentIndex();

    expect(index.profiles).toMatchObject([{ code: 'CLIENT_50X30', widthMm: 50, heightMm: 30, dpi: 203 }]);
    expect(index.templates).toMatchObject([{ templateCode: 'CLIENT_LABEL', paperProfileCode: 'CLIENT_50X30', status: 'PUBLISHED' }]);

    const bundle = await sourceService.createClientContentBundle('template', 'CLIENT_LABEL');
    const targetProfiles = new InMemoryPaperProfileRepository();
    const targetTemplates = new InMemoryPrintTemplateRepository();
    const targetService = new ControlContentSyncService(targetProfiles, targetTemplates);
    const result = await targetService.importClientBundle(bundle, {
      importedBy: 'operator@hospital.local',
      code: 'CLIENT_LABEL_COPY',
    });

    expect(result).toMatchObject({
      sourceCode: 'CLIENT_LABEL',
      importedCode: 'CLIENT_LABEL_COPY',
      profile: 'created',
      template: 'created',
    });
    const importedTemplate = await targetTemplates.findByCode('CLIENT_LABEL_COPY');
    const importedProfile = await targetProfiles.findByCode('CLIENT_50X30');
    expect(importedTemplate).toMatchObject({ status: 'DRAFT', createdBy: 'operator@hospital.local' });
    expect(importedTemplate?.paperProfileId).toBe(importedProfile?.id);
  });

  it('reports truthful step progress for each synchronized content item', async () => {
    const source = await sourceContent();
    const sourceService = new ControlContentSyncService(source.profiles, source.templates);
    const bundle = await sourceService.createClientContentBundle('template', 'CLIENT_LABEL');
    const targetProfiles = new InMemoryPaperProfileRepository();
    const targetTemplates = new InMemoryPrintTemplateRepository();
    const targetService = new ControlContentSyncService(targetProfiles, targetTemplates);
    const progress: ControlCommandProgress[] = [];

    await targetService.applyBundle(bundle, (update) => { progress.push(update); });

    expect(progress).toMatchObject([
      { current: 0, total: 2, percent: 0, mode: 'steps', phase: 'syncing-profile', item: 'Client label 50 by 30' },
      { current: 1, total: 2, percent: 50, mode: 'steps', phase: 'syncing-template', item: 'Client label template' },
      { current: 2, total: 2, percent: 100, mode: 'steps', phase: 'completed' },
    ]);
  });

  it('never overwrites a matching central code and allows importing the client item under a new code', async () => {
    const source = await sourceContent();
    const sourceService = new ControlContentSyncService(source.profiles, source.templates);
    const bundle = await sourceService.createClientContentBundle('paper-profile', 'CLIENT_50X30');
    const targetProfiles = new InMemoryPaperProfileRepository();
    const targetTemplates = new InMemoryPrintTemplateRepository();
    const centralProfile = await targetProfiles.create({
      code: 'CLIENT_50X30',
      name: 'Central profile',
      widthMm: 80,
      heightMm: 50,
      marginTopMm: 0,
      marginRightMm: 0,
      marginBottomMm: 0,
      marginLeftMm: 0,
      dpi: 203,
      orientation: 'portrait',
      unit: 'mm',
      fields: [],
    });
    const targetService = new ControlContentSyncService(targetProfiles, targetTemplates);

    await expect(targetService.importClientBundle(bundle, { importedBy: 'operator@hospital.local' }))
      .rejects.toBeInstanceOf(ConflictError);
    expect(await targetProfiles.findById(centralProfile.id)).toMatchObject({ name: 'Central profile', widthMm: 80 });

    const copied = await targetService.importClientBundle(bundle, {
      importedBy: 'operator@hospital.local',
      code: 'CLIENT_50X30_COPY',
    });
    expect(copied.importedCode).toBe('CLIENT_50X30_COPY');
    expect(await targetProfiles.findByCode('CLIENT_50X30_COPY')).toMatchObject({ widthMm: 50, name: 'Client label 50 by 30' });
  });
});
