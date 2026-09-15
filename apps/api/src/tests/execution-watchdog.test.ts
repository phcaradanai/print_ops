import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PrintCommand, PrinterAdapterResult } from '@printerops/domain';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { AdapterRegistry } from '@printerops/adapters';

import { CreatePrinterService } from '../services/create-printer.service.js';
import { CreatePrintJobService } from '../services/create-print-job.service.js';
import { ExecuteJobService } from '../services/execute-job.service.js';

/** Adapter that never resolves — simulates a wedged PowerShell/WebView2 call.
 *  Optionally reports SPOOLER_ACCEPTED first and exposes the captured
 *  onProgress so a test can fire a LATE progress event after the watchdog. */
class HangingAdapter {
  readonly protocol = 'fake';
  readonly adapterName = 'HangingAdapter';
  capturedOnProgress: PrintCommand['onProgress'];

  constructor(private readonly acceptIntoSpooler: boolean) {}

  async executeCommand(command: PrintCommand): Promise<PrinterAdapterResult> {
    this.capturedOnProgress = command.onProgress;
    if (this.acceptIntoSpooler && command.onProgress) {
      await command.onProgress({
        stage: 'SPOOLER_ACCEPTED',
        occurredAt: new Date(),
        evidence: { spoolerJobId: 42 },
      });
    }
    return new Promise<never>(() => {});
  }

  async getStatus(): Promise<never> {
    throw new Error('not used');
  }
}

describe('execution watchdog → TIMEOUT semantics (I-4)', () => {
  let jobRepo: InMemoryJobRepository;
  let eventBus: InMemoryEventBus;
  let executeJob: ExecuteJobService;
  let createJob: CreatePrintJobService;
  let printerId: string;
  let registry: AdapterRegistry;
  let adapter: HangingAdapter;

  async function setup(acceptIntoSpooler: boolean): Promise<void> {
    const printerRepo = new InMemoryPrinterRepository();
    jobRepo = new InMemoryJobRepository();
    const traceRepo = new InMemoryTraceRepository();
    const auditRepo = new InMemoryAuditRepository();
    eventBus = new InMemoryEventBus();
    const queue = new InMemoryJobQueue();
    registry = new AdapterRegistry();
    adapter = new HangingAdapter(acceptIntoSpooler);
    registry.registerAdapter(adapter as unknown as Parameters<AdapterRegistry['registerAdapter']>[0]);

    const createPrinter = new CreatePrinterService(printerRepo, eventBus, auditRepo);
    createJob = new CreatePrintJobService(jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus);
    executeJob = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registry);

    const printer = await createPrinter.execute(
      { name: 'Hanging Printer', protocol: 'fake', connectionUri: 'fake://hang', metadata: {} },
      'user-1',
    );
    printerId = printer.id;
  }

  async function makeJob(): Promise<string> {
    const job = await createJob.execute(
      { printerId, createdBy: 'user-1', mimeType: 'text/plain', copies: 1, duplex: false, colorMode: 'auto', metadata: {} },
      'user-1',
    );
    return job.id;
  }

  beforeEach(() => {
    process.env['PRINTOPS_EXECUTE_TIMEOUT_MS'] = '80';
  });

  afterEach(() => {
    delete process.env['PRINTOPS_EXECUTE_TIMEOUT_MS'];
  });

  it('fails with EXECUTION_TIMEOUT when the adapter hangs BEFORE the spooler accepted', async () => {
    await setup(false);
    const jobId = await makeJob();

    const result = await executeJob.execute(jobId, 'runner-1');
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('EXECUTION_TIMEOUT');
  });

  it('times out as TIMEOUT (may-have-printed) when the spooler accepted but no verdict came back', async () => {
    await setup(true);
    const jobId = await makeJob();

    const terminalEvents: Array<{ status: string }> = [];
    eventBus.subscribe('PrintJobTerminal', (event) => {
      terminalEvents.push(event as unknown as { status: string });
    });

    const result = await executeJob.execute(jobId, 'runner-1');
    expect(result.status).toBe('TIMEOUT');
    expect(result.errorCode).toBe('PRINT_RESULT_TIMEOUT');
    expect(terminalEvents.map((event) => event.status)).toContain('TIMEOUT');

    // TIMEOUT is in the may-have-printed class: re-executing must be refused.
    await expect(executeJob.execute(jobId, 'runner-1')).rejects.toThrow(/cannot be executed again/);
  });

  it('ignores a LATE progress write from the abandoned adapter call', async () => {
    await setup(true);
    const jobId = await makeJob();

    const result = await executeJob.execute(jobId, 'runner-1');
    expect(result.status).toBe('TIMEOUT');

    // The wedged adapter finally reports progress — long after the verdict.
    await adapter.capturedOnProgress?.({
      stage: 'SPOOLER_ACCEPTED',
      occurredAt: new Date(),
      evidence: { late: true },
    });
    const after = await jobRepo.findById(jobId);
    expect(after?.status).toBe('TIMEOUT');
  });

  it('does not interfere with an adapter that answers in time', async () => {
    await setup(false);
    // Replace the hanging adapter's executeCommand with an immediate success.
    adapter.executeCommand = async () => ({ success: true, message: 'ok' }) as PrinterAdapterResult;
    const jobId = await makeJob();

    const result = await executeJob.execute(jobId, 'runner-1');
    expect(result.status).toBe('SUCCESS');
  });
});
