import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryPrintTemplateRepository } from '../infra/repos/in-memory-template.repo.js';
import { InMemoryPaperProfileRepository } from '../infra/repos/in-memory-paper-profile.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { AdapterRegistry, FakePrinterAdapter } from '@printerops/adapters';
import { SimpleTemplateRenderer } from '../infra/template/simple-template-renderer.js';
import { SandboxService } from '../services/sandbox.service.js';
import { CreatePrintJobService } from '../services/create-print-job.service.js';
import { ExecuteJobService } from '../services/execute-job.service.js';

let printerRepo: InMemoryPrinterRepository;
let jobRepo: InMemoryJobRepository;
let traceRepo: InMemoryTraceRepository;
let auditRepo: InMemoryAuditRepository;
let templateRepo: InMemoryPrintTemplateRepository;
let paperRepo: InMemoryPaperProfileRepository;
let eventBus: InMemoryEventBus;
let queue: InMemoryJobQueue;
let renderer: SimpleTemplateRenderer;
let createJob: CreatePrintJobService;
let executeJob: ExecuteJobService;
let registry: AdapterRegistry;

function makeService() {
  return new SandboxService(templateRepo, paperRepo, renderer, createJob, executeJob);
}

describe('SandboxService', () => {
  beforeEach(async () => {
    printerRepo = new InMemoryPrinterRepository();
    jobRepo = new InMemoryJobRepository();
    traceRepo = new InMemoryTraceRepository();
    auditRepo = new InMemoryAuditRepository();
    templateRepo = new InMemoryPrintTemplateRepository();
    paperRepo = new InMemoryPaperProfileRepository();
    eventBus = new InMemoryEventBus();
    queue = new InMemoryJobQueue();
    renderer = new SimpleTemplateRenderer();

    registry = new AdapterRegistry();
    registry.registerAdapter(new FakePrinterAdapter({ latencyMs: 0 }));
    createJob = new CreatePrintJobService(jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus);
    executeJob = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registry);

    // Seed paper profile
    await paperRepo.create({
      code: 'LABEL_100X50',
      name: 'Label 100x50',
      widthMm: 100,
      heightMm: 50,
      marginTopMm: 2,
      marginRightMm: 2,
      marginBottomMm: 2,
      marginLeftMm: 2,
      dpi: 203,
      orientation: 'portrait',
      unit: 'mm',
    });

    // Seed template
    await templateRepo.create({
      templateCode: 'TEST_LABEL',
      name: 'Test Label',
      engine: 'RAW_TEXT',
      content: 'Hello {{name}}! Barcode: {{barcode}}',
      paperProfileId: (await paperRepo.findAll())[0]!.id,
      status: 'PUBLISHED',
      createdBy: 'seed',
    });
  });

  it('renders a template with all fields resolved', async () => {
    const svc = makeService();
    const result = await svc.run({
      templateCode: 'TEST_LABEL',
      samplePayload: { name: 'Alice', barcode: '12345' },
    });

    expect(result.allFieldsResolved).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.resolvedFields).toContain('name');
    expect(result.resolvedFields).toContain('barcode');
    expect(result.renderedPayload).toBe('Hello Alice! Barcode: 12345');
    expect(result.templateValid).toBe(true);
    expect(result.templateWarnings).toEqual([]);
    expect(result.renderTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.runId).toBeDefined();
    expect(result.warnings).toEqual([]);
  });

  it('flags missing fields when payload is incomplete', async () => {
    const svc = makeService();
    const result = await svc.run({
      templateCode: 'TEST_LABEL',
      samplePayload: { name: 'Bob' },
    });

    expect(result.allFieldsResolved).toBe(false);
    expect(result.missingFields).toContain('barcode');
    expect(result.resolvedFields).toContain('name');
    expect(result.renderedPayload).toBe('Hello Bob! Barcode: ');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('barcode'))).toBe(true);
  });

  it('detects unsafe template content', async () => {
    await templateRepo.create({
      templateCode: 'UNSAFE',
      name: 'Unsafe Template',
      engine: 'HTML',
      content: '<script>alert("xss")</script>{{msg}}',
      paperProfileId: (await paperRepo.findAll())[0]!.id,
      status: 'PUBLISHED',
      createdBy: 'seed',
    });

    const svc = makeService();
    const result = await svc.run({
      templateCode: 'UNSAFE',
      samplePayload: { msg: 'hello' },
    });

    expect(result.templateValid).toBe(false);
    expect(result.templateWarnings.length).toBeGreaterThan(0);
    expect(result.templateWarnings.some((w) => w.includes('script'))).toBe(true);
  });

  it('runs batch across multiple scenarios', async () => {
    const svc = makeService();
    const batch = await svc.runBatch('TEST_LABEL', [
      { samplePayload: { name: 'A', barcode: '1' } },
      { samplePayload: { name: 'B' } }, // missing barcode
      { samplePayload: { name: 'C', barcode: '3' } },
    ]);

    expect(batch.batchId).toBeDefined();
    expect(batch.summary.total).toBe(3);
    expect(batch.summary.passed).toBe(2);
    expect(batch.summary.failed).toBe(1);
    expect(batch.summary.totalRenderTimeMs).toBeGreaterThanOrEqual(0);
    expect(batch.runs.length).toBe(3);
    expect(batch.templateCode).toBe('TEST_LABEL');
  });

  it('rejects batch with zero scenarios', async () => {
    const svc = makeService();
    await expect(svc.runBatch('TEST_LABEL', [])).rejects.toThrow(/at least one scenario/i);
  });

  it('throws NotFoundError for nonexistent template', async () => {
    const svc = makeService();
    await expect(
      svc.run({ templateCode: 'NONEXISTENT', samplePayload: {} }),
    ).rejects.toThrow(/PrintTemplate/);
  });

  it('handles nested field paths in payload', async () => {
    await templateRepo.create({
      templateCode: 'NESTED',
      name: 'Nested Fields',
      engine: 'RAW_TEXT',
      content: 'Patient: {{patient.name}} HN: {{patient.hn}}',
      paperProfileId: (await paperRepo.findAll())[0]!.id,
      status: 'PUBLISHED',
      createdBy: 'seed',
    });

    const svc = makeService();
    const result = await svc.run({
      templateCode: 'NESTED',
      samplePayload: { patient: { name: 'John', hn: 'HN001' } },
    });

    expect(result.allFieldsResolved).toBe(true);
    expect(result.renderedPayload).toBe('Patient: John HN: HN001');
  });

  it('sends test print when testPrint option is set', async () => {
    // Create a printer first
    await printerRepo.create({
      code: 'TEST_PRINTER',
      name: 'Test Printer',
      protocol: 'fake',
      connectionUri: 'fake://test',
      isActive: true,
      metadata: {},
    });

    const svc = makeService();
    const result = await svc.run({
      templateCode: 'TEST_LABEL',
      samplePayload: { name: 'Test', barcode: 'X' },
      testPrint: { printerCode: 'TEST_PRINTER' },
    });

    expect(result.testJobId).toBeDefined();
    expect(result.testPrintSuccess).toBe(true);
    expect(result.testPrintStatus).toBe('SUCCESS');
    expect(result.testPrintError).toBeUndefined();
  });
});
