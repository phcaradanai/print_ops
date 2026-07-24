import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IntakeAttemptRepositoryPort } from '@printerops/domain';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { InMemoryPrintTemplateRepository } from '../infra/repos/in-memory-template.repo.js';
import { InMemoryPaperProfileRepository } from '../infra/repos/in-memory-paper-profile.repo.js';
import { InMemoryPrinterTemplateBindingRepository } from '../infra/repos/in-memory-template-binding.repo.js';

import { AcceptExternalJobService } from '../services/accept-external-job.service.js';
import { ResolvePrinterBindingService } from '../services/resolve-printer-binding.service.js';
import { DynamicPrintService } from '../services/dynamic-print.service.js';

let printerRepo: InMemoryPrinterRepository;
let jobRepo: InMemoryJobRepository;
let traceRepo: InMemoryTraceRepository;
let auditRepo: InMemoryAuditRepository;
let eventBus: InMemoryEventBus;
let queue: InMemoryJobQueue;
let templateRepo: InMemoryPrintTemplateRepository;
let paperRepo: InMemoryPaperProfileRepository;
let bindingRepo: InMemoryPrinterTemplateBindingRepository;

let resolver: ResolvePrinterBindingService;
let dynamicPrint: DynamicPrintService;
let intakeLog: { record: ReturnType<typeof vi.fn> } & IntakeAttemptRepositoryPort;

const TEMPLATE = 'LAB_LABEL_DEFAULT';
const PROFILE = 'LABEL_100X50';

beforeEach(async () => {
  printerRepo = new InMemoryPrinterRepository();
  jobRepo = new InMemoryJobRepository();
  traceRepo = new InMemoryTraceRepository();
  auditRepo = new InMemoryAuditRepository();
  eventBus = new InMemoryEventBus();
  queue = new InMemoryJobQueue();
  templateRepo = new InMemoryPrintTemplateRepository();
  paperRepo = new InMemoryPaperProfileRepository();
  bindingRepo = new InMemoryPrinterTemplateBindingRepository();

  intakeLog = { record: vi.fn(async (input) => ({ ...input, id: 'attempt-1', occurredAt: new Date() })), findAll: vi.fn(async () => []) } as unknown as typeof intakeLog;
  const acceptExternalJob = new AcceptExternalJobService(
    jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus,
    undefined, undefined, undefined, intakeLog,
  );
  resolver = new ResolvePrinterBindingService(paperRepo, bindingRepo, templateRepo);
  dynamicPrint = new DynamicPrintService(resolver, acceptExternalJob, intakeLog);

  await printerRepo.create({
    code: 'LAB_LABEL_01', name: 'Lab Label', protocol: 'fake', connectionUri: 'fake://lab',
    isActive: true, allowedTemplates: [TEMPLATE], maxCopiesPerJob: 10, metadata: {},
  });
  const paper = await paperRepo.create({
    code: PROFILE, name: 'Label 100x50', widthMm: 100, heightMm: 50,
    marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2,
    dpi: 203, orientation: 'portrait', unit: 'mm',
  });
  await templateRepo.create({
    templateCode: TEMPLATE, name: 'Lab Label Default', engine: 'RAW_TEXT',
    content: 'LAB {{label}}', paperProfileId: paper.id, status: 'PUBLISHED', createdBy: 'seed',
  });
  await bindingRepo.create({
    printerCode: 'LAB_LABEL_01', templateCode: TEMPLATE, paperProfileId: paper.id,
    isDefault: true, enabled: true,
  });
});

describe('ResolvePrinterBindingService', () => {
  it('resolves (template + profile) to the bound printer', async () => {
    const resolved = await resolver.resolve(TEMPLATE, PROFILE);
    expect(resolved.printerCode).toBe('LAB_LABEL_01');
    expect(resolved.paperProfileCode).toBe(PROFILE);
  });

  it('404s for an unknown paper profile', async () => {
    await expect(resolver.resolve(TEMPLATE, 'NOPE')).rejects.toThrow();
  });

  it('404s when no enabled binding matches the profile', async () => {
    const other = await paperRepo.create({
      code: 'LABEL_80X50', name: 'Label 80x50', widthMm: 80, heightMm: 50,
      marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2,
      dpi: 203, orientation: 'portrait', unit: 'mm',
    });
    // profile exists but no binding ties this template to it
    await expect(resolver.resolve(TEMPLATE, other.code)).rejects.toThrow();
  });

  it('prefers the isDefault binding among multiple candidates', async () => {
    await printerRepo.create({
      code: 'LAB_LABEL_02', name: 'Lab Label 2', protocol: 'fake', connectionUri: 'fake://lab2',
      isActive: true, allowedTemplates: [TEMPLATE], maxCopiesPerJob: 10, metadata: {},
    });
    const paper = await paperRepo.findByCode(PROFILE);
    await bindingRepo.create({
      printerCode: 'LAB_LABEL_02', templateCode: TEMPLATE, paperProfileId: paper!.id,
      isDefault: false, enabled: true,
    });
    const resolved = await resolver.resolve(TEMPLATE, PROFILE);
    expect(resolved.printerCode).toBe('LAB_LABEL_01');
  });
});

describe('DynamicPrintService', () => {
  it('creates a queued job resolving the printer from template + profile', async () => {
    const res = await dynamicPrint.submit(
      {
        request_id: 'REQ-DYN-001', source_system: 'integration-service',
        code_template: TEMPLATE, code_profile: PROFILE,
        payload: { label: 'hi' }, copies: 1,
      },
      'sa-1',
    );
    expect(res.status).toBe('QUEUED');
    expect(res.duplicate).toBe(false);
    const job = await jobRepo.findById(res.print_job_id);
    expect(job?.printerCode ?? job?.printerId).toBeDefined();
    expect((job?.metadata as Record<string, unknown>)?.code_profile).toBe(PROFILE);
  });

  it('is idempotent on request_id (same source_system)', async () => {
    const first = await dynamicPrint.submit(
      { request_id: 'REQ-DYN-DUP', source_system: 'sys', code_template: TEMPLATE, code_profile: PROFILE, payload: {} },
      'sa-1',
    );
    const second = await dynamicPrint.submit(
      { request_id: 'REQ-DYN-DUP', source_system: 'sys', code_template: TEMPLATE, code_profile: PROFILE, payload: {} },
      'sa-1',
    );
    expect(second.duplicate).toBe(true);
    expect(second.print_job_id).toBe(first.print_job_id);
    expect(await jobRepo.findAll()).toHaveLength(1);
  });

  it('honours an explicit printer_code override (skips binding resolution)', async () => {
    const res = await dynamicPrint.submit(
      {
        request_id: 'REQ-DYN-OVR', source_system: 'sys', code_template: TEMPLATE,
        code_profile: 'ANY_UNRESOLVABLE', printer_code: 'LAB_LABEL_01', payload: {},
      },
      'sa-1',
    );
    expect(res.status).toBe('QUEUED');
  });

  it('rejects a missing request_id', async () => {
    await expect(
      dynamicPrint.submit(
        { request_id: '', source_system: 'sys', code_template: TEMPLATE, code_profile: PROFILE, payload: {} },
        'sa-1',
      ),
    ).rejects.toThrow();
  });

  it('enforces the SA allowlist against the RESOLVED (binding) printer', async () => {
    // The binding resolves to LAB_LABEL_01, which is NOT in the allowlist.
    await expect(
      dynamicPrint.submit(
        { request_id: 'REQ-ACL-1', source_system: 'sys', code_template: TEMPLATE, code_profile: PROFILE, payload: {} },
        'sa-1',
        { allowedPrinterCodes: ['SOME_OTHER_PRINTER'] },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await jobRepo.findAll()).toHaveLength(0);
  });

  it('enforces the SA allowlist against an explicit printer_code', async () => {
    await expect(
      dynamicPrint.submit(
        {
          request_id: 'REQ-ACL-2', source_system: 'sys', code_template: TEMPLATE,
          code_profile: PROFILE, printer_code: 'LAB_LABEL_01', payload: {},
        },
        'sa-1',
        { allowedPrinterCodes: ['SOME_OTHER_PRINTER'] },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows when the resolved printer is in the allowlist', async () => {
    const res = await dynamicPrint.submit(
      { request_id: 'REQ-ACL-3', source_system: 'sys', code_template: TEMPLATE, code_profile: PROFILE, payload: {} },
      'sa-1',
      { allowedPrinterCodes: ['LAB_LABEL_01'] },
    );
    expect(res.status).toBe('QUEUED');
  });
});

describe('intake attempt logging', () => {
  it('records an accepted attempt on a clean submit', async () => {
    await dynamicPrint.submit(
      { request_id: 'REQ-LOG-001', source_system: 'sys', code_template: TEMPLATE, code_profile: PROFILE, payload: {} },
      'sa-1',
      { source: 'api' },
    );
    expect(intakeLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'api', outcome: 'accepted', requestId: 'REQ-LOG-001' }),
    );
  });

  it('records a duplicate attempt as outcome "duplicate", not "accepted"', async () => {
    const req = { request_id: 'REQ-LOG-DUP', source_system: 'sys', code_template: TEMPLATE, code_profile: PROFILE, payload: {} };
    await dynamicPrint.submit(req, 'sa-1');
    intakeLog.record.mockClear();
    await dynamicPrint.submit(req, 'sa-1');
    expect(intakeLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'duplicate', requestId: 'REQ-LOG-DUP' }),
    );
  });

  it('records a rejected attempt with the SA-allowlist reason, before ever reaching AcceptExternalJobService', async () => {
    await expect(
      dynamicPrint.submit(
        { request_id: 'REQ-LOG-403', source_system: 'sys', code_template: TEMPLATE, code_profile: PROFILE, payload: {} },
        'sa-1',
        { allowedPrinterCodes: ['SOME_OTHER_PRINTER'], source: 'nats' },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(intakeLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nats',
        outcome: 'rejected',
        requestId: 'REQ-LOG-403',
        reason: expect.stringContaining('not allowed for this service account'),
      }),
    );
  });

  it('records a rejected attempt when the (template + profile) cannot be resolved to a printer', async () => {
    await expect(
      dynamicPrint.submit(
        { request_id: 'REQ-LOG-404', source_system: 'sys', code_template: TEMPLATE, code_profile: 'NOPE', payload: {} },
        'sa-1',
      ),
    ).rejects.toThrow();
    // Binding resolution fails inside DynamicPrintService itself (before ever
    // reaching AcceptExternalJobService) — still exactly one record call.
    expect(intakeLog.record).toHaveBeenCalledTimes(1);
    expect(intakeLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'rejected', requestId: 'REQ-LOG-404' }),
    );
  });
});
