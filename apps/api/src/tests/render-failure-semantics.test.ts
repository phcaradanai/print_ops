import { describe, it, expect, beforeEach } from 'vitest';
import type { PaperProfile, PrintTemplate, TemplateRendererPort } from '@printerops/domain';
import { AppError } from '@printerops/shared';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { InMemoryPrintTemplateRepository } from '../infra/repos/in-memory-template.repo.js';
import { InMemoryPaperProfileRepository } from '../infra/repos/in-memory-paper-profile.repo.js';
import { SimpleTemplateRenderer } from '../infra/template/simple-template-renderer.js';
import { AcceptExternalJobService } from '../services/accept-external-job.service.js';

const TEMPLATE = 'LAB_LABEL_DEFAULT';

class ThrowingRenderer extends SimpleTemplateRenderer {
  override async renderPrintPayload(): Promise<never> {
    throw new Error('bwip-js exploded');
  }
}

describe('render failure semantics on the rendered-document flow (I-2)', () => {
  let jobRepo: InMemoryJobRepository;
  let templateRepo: InMemoryPrintTemplateRepository;
  let paperRepo: InMemoryPaperProfileRepository;
  let paper: PaperProfile;

  function buildService(renderer: TemplateRendererPort): AcceptExternalJobService {
    return new AcceptExternalJobService(
      jobRepo,
      printerRepo,
      new InMemoryJobQueue(),
      new InMemoryTraceRepository(),
      new InMemoryAuditRepository(),
      new InMemoryEventBus(),
      templateRepo,
      paperRepo,
      renderer,
    );
  }

  let printerRepo: InMemoryPrinterRepository;

  beforeEach(async () => {
    printerRepo = new InMemoryPrinterRepository();
    jobRepo = new InMemoryJobRepository();
    templateRepo = new InMemoryPrintTemplateRepository();
    paperRepo = new InMemoryPaperProfileRepository();

    await printerRepo.create({
      code: 'LAB_LABEL_01', name: 'Lab Label', protocol: 'fake', connectionUri: 'fake://lab',
      isActive: true, allowedTemplates: [TEMPLATE], maxCopiesPerJob: 10, metadata: {},
    });
    paper = await paperRepo.create({
      code: 'LABEL_100X50', name: 'Label 100x50', widthMm: 100, heightMm: 50,
      marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2,
      dpi: 203, orientation: 'portrait', unit: 'mm',
    });
  });

  async function createTemplate(patch: Partial<PrintTemplate> = {}): Promise<void> {
    await templateRepo.create({
      templateCode: TEMPLATE, name: 'Lab Label Default', engine: 'RAW_TEXT',
      content: 'LAB {{label}} HN {{hn}}', paperProfileId: paper.id, status: 'PUBLISHED', createdBy: 'seed',
      ...patch,
    });
  }

  const request = {
    request_id: 'REQ-RENDER-1',
    source_system: 'integration-service',
    printer_code: 'LAB_LABEL_01',
    template_code: TEMPLATE,
    payload: { label: 'A' },
  };

  it('rejects with RENDER_FAILED (422) when the renderer throws, creating no job', async () => {
    await createTemplate();
    const service = buildService(new ThrowingRenderer());

    const attempt = service.execute(request, 'test-actor');
    await expect(attempt).rejects.toMatchObject({ code: 'RENDER_FAILED', statusCode: 422 });
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    expect(await jobRepo.findAll({})).toHaveLength(0);
  });

  it('rejects with TEMPLATE_PROFILE_MISSING (422) when the template has no usable paper profile', async () => {
    await createTemplate({ paperProfileId: 'deleted-profile-id' });
    const service = buildService(new SimpleTemplateRenderer());

    await expect(service.execute(request, 'test-actor')).rejects.toMatchObject({
      code: 'TEMPLATE_PROFILE_MISSING',
      statusCode: 422,
    });
    expect(await jobRepo.findAll({})).toHaveLength(0);
  });

  it('still ACCEPTS a job with missing payload fields, carrying warnings with it', async () => {
    await createTemplate();
    const service = buildService(new SimpleTemplateRenderer());

    const result = await service.execute(request, 'test-actor');
    expect(result.duplicate).toBe(false);

    const job = (await jobRepo.findAll({}))[0]!;
    expect(job.renderedPrintPayload).toContain('LAB A');
    expect(job.metadata['renderWarnings']).toEqual(['Missing field: hn']);
  });
});
