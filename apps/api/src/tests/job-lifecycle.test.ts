import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryRunnerRepository } from '../infra/repos/in-memory-runner.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { AdapterRegistry, FakePrinterAdapter } from '@printerops/adapters';
import { generateId } from '@printerops/shared';

import { CreatePrinterService } from '../services/create-printer.service.js';
import { CreatePrintJobService } from '../services/create-print-job.service.js';
import { ExecuteJobService } from '../services/execute-job.service.js';
import { RegisterRunnerService } from '../services/register-runner.service.js';

describe('Job Lifecycle: create → queued → running → success', () => {
  let printerRepo: InMemoryPrinterRepository;
  let jobRepo: InMemoryJobRepository;
  let traceRepo: InMemoryTraceRepository;
  let auditRepo: InMemoryAuditRepository;
  let runnerRepo: InMemoryRunnerRepository;
  let eventBus: InMemoryEventBus;
  let queue: InMemoryJobQueue;
  let registry: AdapterRegistry;

  let createPrinter: CreatePrinterService;
  let createJob: CreatePrintJobService;
  let executeJob: ExecuteJobService;
  let registerRunner: RegisterRunnerService;

  beforeEach(() => {
    printerRepo = new InMemoryPrinterRepository();
    jobRepo = new InMemoryJobRepository();
    traceRepo = new InMemoryTraceRepository();
    auditRepo = new InMemoryAuditRepository();
    runnerRepo = new InMemoryRunnerRepository();
    eventBus = new InMemoryEventBus();
    queue = new InMemoryJobQueue();
    registry = new AdapterRegistry();
    registry.registerAdapter(new FakePrinterAdapter({ latencyMs: 0 }));

    createPrinter = new CreatePrinterService(printerRepo, eventBus, auditRepo);
    createJob = new CreatePrintJobService(jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus);
    executeJob = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registry);
    registerRunner = new RegisterRunnerService(runnerRepo, auditRepo, eventBus);
  });

  it('completes PENDING → QUEUED → RUNNING → SUCCESS lifecycle', async () => {
    const printer = await createPrinter.execute(
      {
        name: 'Test Printer',
        protocol: 'fake',
        connectionUri: 'fake://test',
        metadata: {},
      },
      'user-1'
    );

    const runner = await registerRunner.execute({
      name: 'runner-1',
      hostname: 'localhost',
      supportedProtocols: ['fake'],
      metadata: {},
    });

    const job = await createJob.execute(
      {
        printerId: printer.id,
        createdBy: 'user-1',
        mimeType: 'application/pdf',
        copies: 1,
        duplex: false,
        colorMode: 'monochrome',
        metadata: {},
      },
      'user-1'
    );

    expect(job.status).toBe('QUEUED');

    const completed = await executeJob.execute(job.id, runner.id);
    expect(completed.status).toBe('SUCCESS');
    expect(completed.finishedAt).toBeDefined();

    const trace = await traceRepo.findByJobId(job.id);
    expect(trace).toBeDefined();
    expect(trace!.status).toBe('SUCCESS');
    expect(trace!.steps.length).toBeGreaterThanOrEqual(2);

    const auditLogs = await auditRepo.findAll({ resourceType: 'job', resourceId: job.id });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
    expect(auditLogs.some((l) => l.action === 'job.succeeded')).toBe(true);
  });

  it('transitions to FAILED when FakeAdapter is configured to fail', async () => {
    const failRegistry = new AdapterRegistry();
    failRegistry.registerAdapter(new FakePrinterAdapter({ shouldFail: true, latencyMs: 0 }));

    const failExecuteJob = new ExecuteJobService(
      jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, failRegistry
    );

    const printer = await createPrinter.execute(
      { name: 'Failing Printer', protocol: 'fake', connectionUri: 'fake://fail', metadata: {} },
      'user-1'
    );

    const job = await createJob.execute(
      {
        printerId: printer.id,
        createdBy: 'user-1',
        mimeType: 'application/pdf',
        copies: 1,
        duplex: false,
        colorMode: 'monochrome',
        metadata: {},
      },
      'user-1'
    );

    const failed = await failExecuteJob.execute(job.id, 'runner-1');
    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('FAKE_ERROR');

    const trace = await traceRepo.findByJobId(job.id);
    expect(trace!.status).toBe('FAILED');
  });
});
