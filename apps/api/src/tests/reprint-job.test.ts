import { describe, expect, it, vi } from 'vitest';
import type {
  AuditRepositoryPort,
  Job,
  JobRepositoryPort,
  PaperProfile,
  PaperProfileRepositoryPort,
  PrintTemplate,
  PrintTemplateRepositoryPort,
  TemplateRendererPort,
} from '@printerops/domain';
import { ReprintJobService } from '../services/reprint-job.service.js';
import type { CreatePrintJobService } from '../services/create-print-job.service.js';

function originalJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'original-job',
    printerId: 'printer-1',
    printerCode: 'PRINTER',
    templateCode: 'LABEL',
    createdBy: 'source',
    requestId: 'request-1',
    status: 'FAILED',
    priority: 50,
    priorityLabel: 'normal',
    traceId: 'trace-1',
    correlationId: 'correlation-1',
    mimeType: 'text/html',
    copies: 1,
    duplex: false,
    colorMode: 'auto',
    retryCount: 0,
    maxRetries: 3,
    metadata: { payload: { patient: 'P001' } },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(original: Job) {
  const created = originalJob({
    id: 'reprint-job',
    requestId: 'reprint-request',
    status: 'QUEUED',
    renderedPrintPayload: '<p>P001</p>',
  });
  const jobs = {
    findById: vi.fn().mockResolvedValue(original),
  } as unknown as JobRepositoryPort;
  const createJob = {
    execute: vi.fn().mockResolvedValue(created),
  } as unknown as CreatePrintJobService;
  const audit = {
    create: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditRepositoryPort;
  const template = {
    templateCode: 'LABEL',
    status: 'PUBLISHED',
    paperProfileId: 'paper-1',
  } as PrintTemplate;
  const paper = { id: 'paper-1' } as PaperProfile;
  const templates = {
    findByCode: vi.fn().mockResolvedValue(template),
  } as unknown as PrintTemplateRepositoryPort;
  const papers = {
    findById: vi.fn().mockResolvedValue(paper),
  } as unknown as PaperProfileRepositoryPort;
  const renderer = {
    renderPrintPayload: vi.fn().mockResolvedValue({
      renderedPrintPayload: '<p>P001</p>',
      warnings: [],
      renderTimeMs: 1,
    }),
  } as unknown as TemplateRendererPort;

  return {
    service: new ReprintJobService(jobs, createJob, audit, templates, papers, renderer),
    createJob,
    renderer,
    template,
    paper,
  };
}

describe('ReprintJobService print content', () => {
  it('re-renders an older job that saved payload but no printable bytes', async () => {
    const original = originalJob();
    const h = buildService(original);

    await h.service.execute(original.id, {
      copies: 1,
      printerId: original.printerId,
      reason: 'operator requested another copy',
      confirmedDuplicateRisk: true,
    }, 'operator');

    expect(h.renderer.renderPrintPayload).toHaveBeenCalledWith(
      h.template,
      { patient: 'P001' },
      h.paper,
    );
    expect(h.createJob.execute).toHaveBeenCalledWith(
      expect.objectContaining({ renderedPrintPayload: '<p>P001</p>' }),
      'operator',
    );
  });

  it('rejects before queueing when neither content nor recovery data exists', async () => {
    const original = originalJob({ templateCode: undefined, metadata: {} });
    const h = buildService(original);

    await expect(h.service.execute(original.id, {
      copies: 1,
      printerId: original.printerId,
      reason: 'operator requested another copy',
      confirmedDuplicateRisk: true,
    }, 'operator')).rejects.toThrow(/cannot be re-rendered/);
    expect(h.createJob.execute).not.toHaveBeenCalled();
  });

  it('reuses existing printable bytes without rendering again', async () => {
    const original = originalJob({ renderedPrintPayload: '<p>stored</p>' });
    const h = buildService(original);

    await h.service.execute(original.id, {
      copies: 1,
      printerId: original.printerId,
      reason: 'operator requested another copy',
      confirmedDuplicateRisk: true,
    }, 'operator');

    expect(h.renderer.renderPrintPayload).not.toHaveBeenCalled();
    expect(h.createJob.execute).toHaveBeenCalledWith(
      expect.objectContaining({ renderedPrintPayload: '<p>stored</p>' }),
      'operator',
    );
  });
});
