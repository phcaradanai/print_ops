import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryRunnerRepository } from '../infra/repos/in-memory-runner.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { AdapterRegistry, FakePrinterAdapter } from '@printerops/adapters';

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

  it('refuses to execute a job a runner has already claimed', async () => {
    const printer = await createPrinter.execute(
      { name: 'Claimed Printer', protocol: 'fake', connectionUri: 'fake://claimed', metadata: {} },
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

    // What the Go runner's POST /runners/:id/jobs/next does to a claimed job.
    await jobRepo.update(job.id, { status: 'DISPATCHED', runnerId: 'go-runner' });

    await expect(executeJob.execute(job.id, 'in-process')).rejects.toThrow(/DISPATCHED/);
  });

  it('lets only one of two concurrent executions claim the job', async () => {
    const printer = await createPrinter.execute(
      { name: 'Raced Printer', protocol: 'fake', connectionUri: 'fake://raced', metadata: {} },
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

    // A double-clicked Print button: both calls read QUEUED before either writes.
    const results = await Promise.allSettled([
      executeJob.execute(job.id, 'runner-a'),
      executeJob.execute(job.id, 'runner-b'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('records an unconfirmable print as UNVERIFIED, not FAILED', async () => {
    // The adapter reports PRINT_NOT_VERIFIABLE when no device channel could
    // confirm the page. A page may exist, so the job must not land in a status
    // that invites a blind retry.
    const unverifiableRegistry = new AdapterRegistry();
    unverifiableRegistry.registerAdapter({
      adapterName: 'UnverifiableAdapter',
      protocol: 'fake',
      executeCommand: async () => ({
        success: false,
        errorCode: 'PRINT_NOT_VERIFIABLE',
        message: 'sent, but the printer could not confirm it',
      }),
    } as unknown as FakePrinterAdapter);

    const unverifiableExecuteJob = new ExecuteJobService(
      jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, unverifiableRegistry
    );

    const printer = await createPrinter.execute(
      { name: 'Silent Printer', protocol: 'fake', connectionUri: 'fake://silent', metadata: {} },
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

    const result = await unverifiableExecuteJob.execute(job.id, 'runner-1');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');

    // And it must not be re-runnable, or the operator gets a duplicate page.
    await expect(unverifiableExecuteJob.execute(job.id, 'runner-1')).rejects.toThrow(/UNVERIFIED/);
  });

  it('never stores a global Windows/SNMP signal as physical SUCCESS without exact IPP job proof', async () => {
    const queueOnlyRegistry = new AdapterRegistry();
    queueOnlyRegistry.registerAdapter({
      adapterName: 'WindowsSpoolerAdapter',
      protocol: 'windows_spooler',
      executeCommand: async (command: Parameters<FakePrinterAdapter['executeCommand']>[0]) => {
        await command.onProgress?.({
          stage: 'SPOOLER_ACCEPTED',
          occurredAt: new Date('2026-07-22T12:00:00.000Z'),
          evidence: { spoolerJobIds: ['42'], deviceConfirmed: false },
        });
        return {
          success: true,
          message: 'Windows queue completed and the global device counter advanced',
          raw: {
            spoolerJobIds: ['42'],
            spoolerAcceptedAt: '2026-07-22T12:00:00.000Z',
            pagesBefore: 100,
            pagesAfter: 101,
            deviceConfirmed: true,
          },
        };
      },
    } as unknown as FakePrinterAdapter);

    const queueOnlyExecute = new ExecuteJobService(
      jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, queueOnlyRegistry
    );
    const printer = await createPrinter.execute(
      { name: 'Windows Printer', protocol: 'windows_spooler', connectionUri: 'spooler://runner/Windows%20Printer', metadata: {} },
      'user-1'
    );
    const job = await createJob.execute(
      {
        printerId: printer.id,
        createdBy: 'user-1',
        mimeType: 'text/html',
        copies: 1,
        duplex: false,
        colorMode: 'color',
        metadata: {},
      },
      'user-1'
    );

    const result = await queueOnlyExecute.execute(job.id, 'runner-1');
    expect(result.status).toBe('UNVERIFIED');
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.printerAckAt).toBeUndefined();
    expect(result.spoolerSentAt).toEqual(new Date('2026-07-22T12:00:00.000Z'));
    expect((result.metadata['printEvidence'] as Record<string, unknown>)['spoolerJobIds']).toEqual(['42']);
  });

  it('stores Windows SUCCESS only with exact printer-side IPP job confirmation', async () => {
    const confirmedRegistry = new AdapterRegistry();
    confirmedRegistry.registerAdapter({
      adapterName: 'WindowsSpoolerAdapter',
      protocol: 'windows_spooler',
      executeCommand: async () => ({
        success: true,
        message: 'device counter advanced',
        raw: {
          spoolerJobIds: ['43'],
          pagesBefore: 100,
          pagesAfter: 101,
          deviceConfirmed: true,
          ippJobConfirmed: true,
        },
      }),
    } as unknown as FakePrinterAdapter);

    const confirmedExecute = new ExecuteJobService(
      jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, confirmedRegistry
    );
    const printer = await createPrinter.execute(
      { name: 'Confirmed Printer', protocol: 'windows_spooler', connectionUri: 'spooler://runner/Confirmed%20Printer', metadata: {} },
      'user-1'
    );
    const job = await createJob.execute(
      {
        printerId: printer.id,
        createdBy: 'user-1',
        mimeType: 'text/html',
        copies: 1,
        duplex: false,
        colorMode: 'color',
        metadata: {},
      },
      'user-1'
    );

    const result = await confirmedExecute.execute(job.id, 'runner-1');
    expect(result.status).toBe('SUCCESS');
    expect(result.printerAckAt).toBeDefined();
    expect((result.metadata['printEvidence'] as Record<string, unknown>)['deviceConfirmed']).toBe(true);
  });

  it('keeps a post-spooler exception UNVERIFIED so it cannot be blindly retried', async () => {
    const registryWithPostSubmitCrash = new AdapterRegistry();
    registryWithPostSubmitCrash.registerAdapter({
      adapterName: 'WindowsSpoolerAdapter',
      protocol: 'windows_spooler',
      executeCommand: async (command: Parameters<FakePrinterAdapter['executeCommand']>[0]) => {
        await command.onProgress?.({
          stage: 'SPOOLER_ACCEPTED',
          occurredAt: new Date('2026-07-22T12:30:00.000Z'),
          evidence: { spoolerJobIds: ['88'], deviceConfirmed: false },
        });
        throw new Error('verification process crashed');
      },
    } as unknown as FakePrinterAdapter);
    const guardedExecute = new ExecuteJobService(
      jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registryWithPostSubmitCrash
    );
    const printer = await createPrinter.execute(
      { name: 'Crash After Submit', protocol: 'windows_spooler', connectionUri: 'spooler://runner/Crash%20After%20Submit', metadata: {} },
      'user-1'
    );
    const job = await createJob.execute(
      { printerId: printer.id, createdBy: 'user-1', mimeType: 'text/html', copies: 1, duplex: false, colorMode: 'color', metadata: {} },
      'user-1'
    );

    const result = await guardedExecute.execute(job.id, 'runner-1');

    expect(result.status).toBe('UNVERIFIED');
    expect(result.errorCode).toBe('PRINT_NOT_VERIFIABLE');
    expect(result.errorMessage).toContain('do not auto-retry');
    expect(result.spoolerSentAt).toEqual(new Date('2026-07-22T12:30:00.000Z'));
    await expect(guardedExecute.execute(job.id, 'runner-1')).rejects.toThrow(/UNVERIFIED/);
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
