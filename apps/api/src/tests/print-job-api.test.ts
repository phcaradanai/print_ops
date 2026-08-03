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
import { AcceptExternalJobService } from '../services/accept-external-job.service.js';
import { CancelJobService } from '../services/cancel-job.service.js';
import { ExecuteJobService } from '../services/execute-job.service.js';
import { RegisterRunnerService } from '../services/register-runner.service.js';
import { RunnerHeartbeatService } from '../services/runner-heartbeat.service.js';

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
let acceptExternalJob: AcceptExternalJobService;
let cancelJob: CancelJobService;
let executeJob: ExecuteJobService;
let registerRunner: RegisterRunnerService;
let runnerHeartbeat: RunnerHeartbeatService;

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
  acceptExternalJob = new AcceptExternalJobService(jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus);
  cancelJob = new CancelJobService(jobRepo, traceRepo, auditRepo, eventBus);
  executeJob = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registry);
  registerRunner = new RegisterRunnerService(runnerRepo, auditRepo, eventBus);
  runnerHeartbeat = new RunnerHeartbeatService(runnerRepo, eventBus);
});

describe('External Print Job API', () => {
  it('creates a print job successfully via external API', async () => {
    await createPrinter.execute(
      { code: 'LAB_LABEL_01', name: 'Lab Label', protocol: 'fake', connectionUri: 'fake://lab', metadata: {} },
      'setup'
    );

    const result = await acceptExternalJob.execute(
      {
        request_id: 'REQ-20260707-0001',
        source_system: 'integration-service',
        printer_code: 'LAB_LABEL_01',
        payload: { patient: 'test', barcode: '12345' },
        copies: 1,
        priority: 'normal',
      },
      'sa-001'
    );

    expect(result.print_job_id).toBeDefined();
    expect(result.request_id).toBe('REQ-20260707-0001');
    expect(result.status).toBe('QUEUED');
    expect(result.trace_id).toBeDefined();
    expect(result.accepted_at).toBeDefined();
    expect(result.duplicate).toBe(false);
  });

  it('returns existing job on duplicate request_id (idempotency)', async () => {
    await createPrinter.execute(
      { code: 'LAB_LABEL_01', name: 'Lab Label', protocol: 'fake', connectionUri: 'fake://lab', metadata: {} },
      'setup'
    );

    const first = await acceptExternalJob.execute(
      {
        request_id: 'REQ-DUPE-001',
        source_system: 'integration-service',
        printer_code: 'LAB_LABEL_01',
        payload: {},
      },
      'sa-001'
    );

    const second = await acceptExternalJob.execute(
      {
        request_id: 'REQ-DUPE-001',
        source_system: 'integration-service',
        printer_code: 'LAB_LABEL_01',
        payload: {},
      },
      'sa-001'
    );

    expect(second.duplicate).toBe(true);
    expect(second.status).toBe('DUPLICATE_RETURNED');
    expect(second.print_job_id).toBe(first.print_job_id);
    expect(second.existing_job_id).toBe(first.print_job_id);

    // Only one job should exist in the repo
    const all = await jobRepo.findAll();
    expect(all).toHaveLength(1);
  });

  it('different source_system with same request_id creates separate jobs', async () => {
    await createPrinter.execute(
      { code: 'LAB_LABEL_01', name: 'Lab Label', protocol: 'fake', connectionUri: 'fake://lab', metadata: {} },
      'setup'
    );

    const r1 = await acceptExternalJob.execute(
      { request_id: 'REQ-001', source_system: 'system-a', printer_code: 'LAB_LABEL_01', payload: {} },
      'sa-001'
    );
    const r2 = await acceptExternalJob.execute(
      { request_id: 'REQ-001', source_system: 'system-b', printer_code: 'LAB_LABEL_01', payload: {} },
      'sa-002'
    );

    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(false);
    expect(r1.print_job_id).not.toBe(r2.print_job_id);
  });

  it('rejects invalid printer_code', async () => {
    await expect(
      acceptExternalJob.execute(
        { request_id: 'REQ-001', source_system: 'sys', printer_code: 'NONEXISTENT', payload: {} },
        'sa-001'
      )
    ).rejects.toThrow();
  });

  it('rejects copies exceeding printer limit', async () => {
    await createPrinter.execute(
      {
        code: 'LAB_LABEL_01',
        name: 'Lab Label',
        protocol: 'fake',
        connectionUri: 'fake://lab',
        maxCopiesPerJob: 5,
        metadata: {},
      },
      'setup'
    );

    await expect(
      acceptExternalJob.execute(
        {
          request_id: 'REQ-002',
          source_system: 'sys',
          printer_code: 'LAB_LABEL_01',
          payload: {},
          copies: 10,
        },
        'sa-001'
      )
    ).rejects.toThrow(/copies.*limit/i);
  });

  // Regression: the copies check used to be upper-bound only, so the external
  // API accepted -5 / 0 / 2.7 copies, persisted the value verbatim and let the
  // job run to SUCCESS. `copies` decides how many physical pages come out, so
  // a non-positive or fractional value must never reach an adapter.
  it.each([
    ['negative', -5, /at least 1/i],
    ['zero', 0, /at least 1/i],
    ['fractional', 2.7, /whole number/i],
  ])('rejects %s copies', async (label, copies, expected) => {
    await createPrinter.execute(
      {
        code: 'LAB_LABEL_01',
        name: 'Lab Label',
        protocol: 'fake',
        connectionUri: 'fake://lab',
        maxCopiesPerJob: 5,
        metadata: {},
      },
      'setup'
    );

    await expect(
      acceptExternalJob.execute(
        {
          request_id: `REQ-COPIES-${label}`,
          source_system: 'sys',
          printer_code: 'LAB_LABEL_01',
          payload: {},
          copies,
        },
        'sa-001'
      )
    ).rejects.toThrow(expected);
  });

  it('still accepts a valid copies value', async () => {
    await createPrinter.execute(
      {
        code: 'LAB_LABEL_01',
        name: 'Lab Label',
        protocol: 'fake',
        connectionUri: 'fake://lab',
        maxCopiesPerJob: 5,
        metadata: {},
      },
      'setup'
    );

    const result = await acceptExternalJob.execute(
      {
        request_id: 'REQ-COPIES-ok',
        source_system: 'sys',
        printer_code: 'LAB_LABEL_01',
        payload: {},
        copies: 3,
      },
      'sa-001'
    );
    expect(result.duplicate).toBe(false);
    expect(result.print_job_id).toBeTruthy();
  });

  it('rejects invalid template_code', async () => {
    await createPrinter.execute(
      {
        code: 'LAB_LABEL_01',
        name: 'Lab Label',
        protocol: 'fake',
        connectionUri: 'fake://lab',
        allowedTemplates: ['patient-label'],
        metadata: {},
      },
      'setup'
    );

    await expect(
      acceptExternalJob.execute(
        {
          request_id: 'REQ-003',
          source_system: 'sys',
          printer_code: 'LAB_LABEL_01',
          template_code: 'invoice',
          payload: {},
        },
        'sa-001'
      )
    ).rejects.toThrow(/template_code/i);
  });
});

describe('Fake Printer Job Execution', () => {
  it('fake printer job succeeds with full trace and audit', async () => {
    const printer = await createPrinter.execute(
      { code: 'FAKE_01', name: 'Fake Printer', protocol: 'fake', connectionUri: 'fake://test', metadata: {} },
      'setup'
    );
    const runner = await registerRunner.execute({
      name: 'runner-1', hostname: 'localhost', supportedProtocols: ['fake'], metadata: {},
    });
    const job = await createJob.execute(
      { printerId: printer.id, createdBy: 'user-1', mimeType: 'text/plain', copies: 1, duplex: false, colorMode: 'auto', metadata: {} },
      'user-1'
    );

    expect(job.status).toBe('QUEUED');
    expect(job.receivedAt).toBeDefined();
    expect(job.validatedAt).toBeDefined();
    expect(job.queuedAt).toBeDefined();

    const completed = await executeJob.execute(job.id, runner.id);

    expect(completed.status).toBe('SUCCESS');
    expect(completed.dispatchedAt).toBeDefined();
    expect(completed.finishedAt).toBeDefined();
    expect(completed.latency).toBeDefined();
    expect(completed.adapterUsed).toBe('FakePrinterAdapter');
  });

  it('fake printer job fails and records error in trace', async () => {
    const failRegistry = new AdapterRegistry();
    failRegistry.registerAdapter(new FakePrinterAdapter({ shouldFail: true, latencyMs: 0 }));
    const failExecute = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, failRegistry);

    const printer = await createPrinter.execute(
      { code: 'FAIL_01', name: 'Fail Printer', protocol: 'fake', connectionUri: 'fake://fail', metadata: {} },
      'setup'
    );
    const job = await createJob.execute(
      { printerId: printer.id, createdBy: 'user-1', mimeType: 'text/plain', copies: 1, duplex: false, colorMode: 'auto', metadata: {} },
      'user-1'
    );

    const failed = await failExecute.execute(job.id, 'runner-1');

    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('FAKE_ERROR');
    expect(failed.latency?.totalLatencyMs).toBeDefined();

    const trace = await traceRepo.findByJobId(job.id);
    expect(trace!.status).toBe('FAILED');
    expect(trace!.steps.some((s) => s.stepName === 'adapter_execute' && s.status === 'failed')).toBe(true);
  });
});

describe('Trace and Audit', () => {
  it('trace contains all lifecycle steps', async () => {
    const printer = await createPrinter.execute(
      { code: 'TRACE_01', name: 'Trace Printer', protocol: 'fake', connectionUri: 'fake://trace', metadata: {} },
      'setup'
    );
    const runner = await registerRunner.execute({
      name: 'runner-trace', hostname: 'localhost', supportedProtocols: ['fake'], metadata: {},
    });
    const job = await createJob.execute(
      { printerId: printer.id, createdBy: 'user-1', mimeType: 'text/plain', copies: 1, duplex: false, colorMode: 'auto', metadata: {} },
      'user-1'
    );

    await executeJob.execute(job.id, runner.id);

    const trace = await traceRepo.findByJobId(job.id);
    expect(trace).toBeDefined();
    expect(trace!.steps.length).toBeGreaterThanOrEqual(4);
    const stepNames = trace!.steps.map((s) => s.stepName);
    expect(stepNames).toContain('job_accepted');
    expect(stepNames).toContain('job_validated');
    expect(stepNames).toContain('job_dispatched');
    expect(stepNames).toContain('adapter_execute');
  });

  it('audit log is created for job creation and success', async () => {
    const printer = await createPrinter.execute(
      { code: 'AUDIT_01', name: 'Audit Printer', protocol: 'fake', connectionUri: 'fake://audit', metadata: {} },
      'setup'
    );
    const runner = await registerRunner.execute({
      name: 'runner-audit', hostname: 'localhost', supportedProtocols: ['fake'], metadata: {},
    });
    const job = await createJob.execute(
      { printerId: printer.id, createdBy: 'user-1', mimeType: 'text/plain', copies: 1, duplex: false, colorMode: 'auto', metadata: {} },
      'user-1'
    );

    await executeJob.execute(job.id, runner.id);

    const logs = await auditRepo.findAll({ resourceType: 'job', resourceId: job.id });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.some((l) => l.action === 'job.created')).toBe(true);
    expect(logs.some((l) => l.action === 'job.succeeded')).toBe(true);
  });
});

describe('Latency Metrics', () => {
  it('populates all fast-path timing fields after execution', async () => {
    const printer = await createPrinter.execute(
      { code: 'LATENCY_01', name: 'Latency Printer', protocol: 'fake', connectionUri: 'fake://latency', metadata: {} },
      'setup'
    );
    const runner = await registerRunner.execute({
      name: 'runner-latency', hostname: 'localhost', supportedProtocols: ['fake'], metadata: {},
    });
    const job = await createJob.execute(
      { printerId: printer.id, createdBy: 'user-1', mimeType: 'text/plain', copies: 1, duplex: false, colorMode: 'auto', metadata: {} },
      'user-1'
    );

    const completed = await executeJob.execute(job.id, runner.id);

    expect(completed.receivedAt).toBeDefined();
    expect(completed.validatedAt).toBeDefined();
    expect(completed.queuedAt).toBeDefined();
    expect(completed.dispatchedAt).toBeDefined();
    expect(completed.finishedAt).toBeDefined();
    expect(completed.latency?.validationMs).toBeGreaterThanOrEqual(0);
    expect(completed.latency?.queueWaitMs).toBeGreaterThanOrEqual(0);
    expect(completed.latency?.dispatchMs).toBeGreaterThanOrEqual(0);
    expect(completed.latency?.runnerExecMs).toBeGreaterThanOrEqual(0);
    expect(completed.latency?.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('Job Cancellation', () => {
  it('cancels a QUEUED job successfully', async () => {
    const printer = await createPrinter.execute(
      { code: 'CANCEL_01', name: 'Cancel Printer', protocol: 'fake', connectionUri: 'fake://cancel', metadata: {} },
      'setup'
    );
    const job = await createJob.execute(
      { printerId: printer.id, createdBy: 'user-1', mimeType: 'text/plain', copies: 1, duplex: false, colorMode: 'auto', metadata: {} },
      'user-1'
    );
    expect(job.status).toBe('QUEUED');

    const cancelled = await cancelJob.execute(job.id, 'user-1');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.finishedAt).toBeDefined();

    const trace = await traceRepo.findByJobId(job.id);
    expect(trace!.steps.some((s) => s.stepName === 'job_cancelled')).toBe(true);
  });

  it('cannot cancel a SUCCESS job', async () => {
    const printer = await createPrinter.execute(
      { code: 'CANCEL_02', name: 'Cancel Printer 2', protocol: 'fake', connectionUri: 'fake://cancel2', metadata: {} },
      'setup'
    );
    const runner = await registerRunner.execute({
      name: 'runner-cancel', hostname: 'localhost', supportedProtocols: ['fake'], metadata: {},
    });
    const job = await createJob.execute(
      { printerId: printer.id, createdBy: 'user-1', mimeType: 'text/plain', copies: 1, duplex: false, colorMode: 'auto', metadata: {} },
      'user-1'
    );
    await executeJob.execute(job.id, runner.id);

    await expect(cancelJob.execute(job.id, 'user-1')).rejects.toThrow(/Cannot cancel/i);
  });
});

describe('Runner Heartbeat', () => {
  it('heartbeat updates runner last heartbeat timestamp', async () => {
    const runner = await registerRunner.execute({
      name: 'runner-hb', hostname: 'localhost', supportedProtocols: ['fake'], metadata: {},
    });

    await runnerHeartbeat.execute(runner.id);

    const updated = await runnerRepo.findById(runner.id);
    expect(updated?.lastHeartbeatAt).toBeDefined();
    expect(updated?.status).toBe('online');
  });
});
