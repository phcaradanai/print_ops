import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { CreatePrinterService } from '../services/create-printer.service.js';
import { AcceptExternalJobService } from '../services/accept-external-job.service.js';

let printerRepo: InMemoryPrinterRepository;
let jobRepo: InMemoryJobRepository;
let traceRepo: InMemoryTraceRepository;
let auditRepo: InMemoryAuditRepository;
let eventBus: InMemoryEventBus;
let queue: InMemoryJobQueue;
let createPrinter: CreatePrinterService;
let acceptExternalJob: AcceptExternalJobService;

const SA_ID = 'sa-test';

beforeEach(async () => {
  printerRepo = new InMemoryPrinterRepository();
  jobRepo = new InMemoryJobRepository();
  traceRepo = new InMemoryTraceRepository();
  auditRepo = new InMemoryAuditRepository();
  eventBus = new InMemoryEventBus();
  queue = new InMemoryJobQueue();

  createPrinter = new CreatePrinterService(printerRepo, eventBus, auditRepo);
  acceptExternalJob = new AcceptExternalJobService(jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus);

  await createPrinter.execute(
    { code: 'LAB_01', name: 'Lab Printer', protocol: 'fake', connectionUri: 'fake://lab', maxCopiesPerJob: 10, allowedTemplates: [], metadata: {} },
    'admin'
  );
});

describe('GET /api/v1/print-jobs (JobRepository.findAll)', () => {
  it('returns all jobs when no filters applied', async () => {
    await acceptExternalJob.execute({ request_id: 'req-1', printer_code: 'LAB_01', payload: {}, source_system: 'test' }, SA_ID);
    await acceptExternalJob.execute({ request_id: 'req-2', printer_code: 'LAB_01', payload: {}, source_system: 'test' }, SA_ID);

    const jobs = await jobRepo.findAll();
    expect(jobs).toHaveLength(2);
  });

  it('filters by status', async () => {
    await acceptExternalJob.execute({ request_id: 'req-3', printer_code: 'LAB_01', payload: {}, source_system: 'test' }, SA_ID);

    const all = await jobRepo.findAll();
    expect(all).toHaveLength(1);
    const jobStatus = all[0]!.status;

    // Filter by the actual status of the job — only that one should match
    const filtered = await jobRepo.findAll({ status: jobStatus });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.status).toBe(jobStatus);

    // A different status should return none
    const printing = await jobRepo.findAll({ status: 'PRINTING' });
    expect(printing).toHaveLength(0);
  });

  it('respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await acceptExternalJob.execute({ request_id: `req-page-${i}`, printer_code: 'LAB_01', payload: {}, source_system: 'test' }, SA_ID);
    }

    const page1 = await jobRepo.findAll({ limit: 3, offset: 0 });
    const page2 = await jobRepo.findAll({ limit: 3, offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(2);
    const ids1 = new Set(page1.map((j) => j.id));
    const ids2 = new Set(page2.map((j) => j.id));
    expect([...ids1].some((id) => ids2.has(id))).toBe(false);
  });

  it('returns empty array when no jobs exist', async () => {
    const jobs = await jobRepo.findAll();
    expect(jobs).toHaveLength(0);
  });
});
