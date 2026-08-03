import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Job, PrintJobTerminal } from '@printerops/domain';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryCallbackDeliveryRepository } from '../infra/repos/in-memory-callback-delivery.repo.js';
import { CreatePrintJobService } from '../services/create-print-job.service.js';
import { v1RunnerJobRoutes } from '../routes/v1/runner-jobs.routes.js';
import {
  ResultCallbackDispatcher,
  type CallbackHttpSender,
} from '../services/result-callback-dispatcher.js';
import { CALLBACK_INTENT_METADATA_KEY } from '@printerops/domain';

/**
 * The Go runner's terminal path.
 *
 * This is the site that actually ships: the E2E harness runs with
 * PRINTOPS_LOCAL_WORKER=true and therefore exercises ExecuteJobService, not
 * this route. Emitting PrintJobTerminal from only ExecuteJobService would make
 * every other test pass while a real Go-runner deployment never fired a single
 * result callback — so this suite drives the HTTP route directly.
 *
 * It is also the ONLY place `enforceWindowsSpoolerConfirmation` can downgrade
 * SUCCESS to UNVERIFIED, which is the status this codebase most needs to carry
 * through a callback intact.
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

interface Fixture {
  app: FastifyInstance;
  jobRepo: InMemoryJobRepository;
  eventBus: InMemoryEventBus;
  deliveries: InMemoryCallbackDeliveryRepository;
  httpCalls: Array<{ url: string; body: Record<string, unknown> }>;
  terminalEvents: PrintJobTerminal[];
  createDispatchedJob(printerCode: string, withCallback: boolean): Promise<Job>;
}

async function buildFixture(): Promise<Fixture> {
  const printerRepo = new InMemoryPrinterRepository();
  const jobRepo = new InMemoryJobRepository();
  const traceRepo = new InMemoryTraceRepository();
  const auditRepo = new InMemoryAuditRepository();
  const queue = new InMemoryJobQueue();
  const eventBus = new InMemoryEventBus();
  const deliveries = new InMemoryCallbackDeliveryRepository();
  const createJob = new CreatePrintJobService(jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus);

  await printerRepo.create({
    code: 'SPOOLER_PRINTER', name: 'Windows Spooler', protocol: 'windows_spooler',
    connectionUri: 'spooler://host/Printer', isActive: true, maxCopiesPerJob: 10, metadata: {},
  });
  await printerRepo.create({
    code: 'FAKE_PRINTER', name: 'Fake', protocol: 'fake',
    connectionUri: 'fake://x', isActive: true, maxCopiesPerJob: 10, metadata: {},
  });

  const httpCalls: Fixture['httpCalls'] = [];
  const http: CallbackHttpSender = async (url, body) => {
    httpCalls.push({ url, body });
    return { status: 200 };
  };

  const dispatcher = new ResultCallbackDispatcher({
    jobs: jobRepo,
    deliveries,
    http,
    logger: silentLogger,
  });
  dispatcher.register(eventBus);

  const terminalEvents: PrintJobTerminal[] = [];
  eventBus.subscribe<PrintJobTerminal>('PrintJobTerminal', (e) => { terminalEvents.push(e); });

  const app = Fastify();
  // The route guards on app.authenticate; a no-op stands in for JWT here since
  // the subject under test is terminal-event emission, not auth.
  app.decorate('authenticate', async () => {});
  await app.register(async (v1) => {
    await v1RunnerJobRoutes(v1, {
      jobs: jobRepo, printers: printerRepo, traces: traceRepo,
      audit: auditRepo, events: eventBus,
    });
  }, { prefix: '/api/v1' });
  await app.ready();

  let seq = 0;
  const createDispatchedJob = async (printerCode: string, withCallback: boolean): Promise<Job> => {
    seq += 1;
    const job = await createJob.execute(
      {
        printerId: '', printerCode, createdBy: 'test', mimeType: 'text/plain',
        copies: 1, duplex: false, colorMode: 'auto',
        requestId: `RUNNER-REQ-${seq}`, sourceSystem: 'medisync',
        metadata: withCallback
          ? {
              [CALLBACK_INTENT_METADATA_KEY]: {
                enabled: true,
                trigger: 'PRINT_RESULT',
                transports: ['HTTP'],
                endpointCode: 'runner-results',
                httpUrl: 'https://receiver.example/results',
              },
            }
          : {},
      },
      'test',
    );
    // The runner result route only applies to a DISPATCHED/PRINTING job.
    const claimed = await jobRepo.claim(job.id, ['QUEUED'], { status: 'DISPATCHED', dispatchedAt: new Date() });
    return claimed!;
  };

  return { app, jobRepo, eventBus, deliveries, httpCalls, terminalEvents, createDispatchedJob };
}

async function postResult(
  f: Fixture,
  job: Job,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; json: Record<string, unknown> }> {
  const res = await f.app.inject({
    method: 'POST',
    url: `/api/v1/runners/runner-01/jobs/${job.id}/result`,
    payload: { job_id: job.id, runner_id: 'runner-01', ...body },
  });
  await f.eventBus.settled();
  return { statusCode: res.statusCode, json: res.json() as Record<string, unknown> };
}

describe('Go runner result route emits PrintJobTerminal', () => {
  let f: Fixture;
  beforeEach(async () => { f = await buildFixture(); });

  it('delivers a SUCCESS result callback', async () => {
    const job = await f.createDispatchedJob('FAKE_PRINTER', true);
    const res = await postResult(f, job, { status: 'SUCCESS', executor: 'fake' });

    expect(res.statusCode).toBe(200);
    expect(f.terminalEvents.map((e) => e.status)).toEqual(['SUCCESS']);
    expect(f.httpCalls).toHaveLength(1);
    expect(f.httpCalls[0]!.body['print_status']).toBe('SUCCESS');
    expect(f.httpCalls[0]!.body['runner_id']).toBe('runner-01');
  });

  it('delivers a FAILED result callback with the runner error code', async () => {
    const job = await f.createDispatchedJob('FAKE_PRINTER', true);
    await postResult(f, job, {
      status: 'FAILED',
      executor: 'fake',
      safe_message: 'The selected printer was offline.',
      evidence: { error_code: 'PRINTER_OFFLINE' },
    });

    expect(f.terminalEvents.map((e) => e.status)).toEqual(['FAILED']);
    expect(f.httpCalls[0]!.body['print_status']).toBe('FAILED');
    expect(f.httpCalls[0]!.body['error']).toEqual({
      code: 'PRINTER_OFFLINE',
      message: 'The selected printer was offline.',
    });
  });

  it('carries UNVERIFIED when the Windows spooler gate downgrades a SUCCESS', async () => {
    // The runner claims SUCCESS, but supplies no exact printer-side IPP proof.
    // enforceWindowsSpoolerConfirmation downgrades it — and the callback MUST
    // say UNVERIFIED, not FAILED and not SUCCESS. A page may physically exist:
    // "FAILED" invites a duplicate reprint, "SUCCESS" hides a real ambiguity.
    const job = await f.createDispatchedJob('SPOOLER_PRINTER', true);
    await postResult(f, job, {
      status: 'SUCCESS',
      executor: 'windows-spooler',
      evidence: { device_confirmed: true }, // no ipp_job_confirmed
    });

    expect((await f.jobRepo.findById(job.id))?.status).toBe('UNVERIFIED');
    expect(f.terminalEvents.map((e) => e.status)).toEqual(['UNVERIFIED']);
    expect(f.httpCalls[0]!.body['print_status']).toBe('UNVERIFIED');
    expect(f.httpCalls[0]!.body['error']).toMatchObject({ code: 'PRINT_NOT_VERIFIABLE' });

    const [delivery] = await f.deliveries.findAll({ printJobId: job.id });
    expect(delivery?.printStatus).toBe('UNVERIFIED');
    expect(delivery?.deliveryStatus).toBe('DELIVERED');
  });

  it('emits nothing when a late duplicate result is rejected with 409', async () => {
    const job = await f.createDispatchedJob('FAKE_PRINTER', true);
    await postResult(f, job, { status: 'SUCCESS', executor: 'fake' });
    const second = await postResult(f, job, { status: 'FAILED', executor: 'fake' });

    // The conditional claim rejects the late report, so no second terminal
    // event and — critically — no second callback contradicting the first.
    expect(second.statusCode).toBe(409);
    expect(f.terminalEvents).toHaveLength(1);
    expect(f.httpCalls).toHaveLength(1);
    expect(await f.deliveries.findAll({ printJobId: job.id })).toHaveLength(1);
  });

  it('emits the terminal event but sends nothing when the job has no callback intent', async () => {
    const job = await f.createDispatchedJob('FAKE_PRINTER', false);
    await postResult(f, job, { status: 'SUCCESS', executor: 'fake' });

    expect(f.terminalEvents).toHaveLength(1);
    expect(f.httpCalls).toHaveLength(0);
    expect(await f.deliveries.findAll({ printJobId: job.id })).toHaveLength(0);
  });
});
