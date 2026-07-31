import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrintJobTerminal, WebhookEndpoint } from '@printerops/domain';
import { readCallbackIntent } from '@printerops/domain';

import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { InMemoryPrintTemplateRepository } from '../infra/repos/in-memory-template.repo.js';
import { InMemoryPaperProfileRepository } from '../infra/repos/in-memory-paper-profile.repo.js';
import { InMemoryPrinterTemplateBindingRepository } from '../infra/repos/in-memory-template-binding.repo.js';
import { InMemoryWebhookEndpointRepository, InMemoryWebhookRoutePolicyRepository } from '../infra/repos/in-memory-webhook.repo.js';
import { InMemoryCallbackDeliveryRepository } from '../infra/repos/in-memory-callback-delivery.repo.js';
import { SimpleTemplateRenderer } from '../infra/template/simple-template-renderer.js';
import { AdapterRegistry, FakePrinterAdapter } from '@printerops/adapters';

import { AcceptExternalJobService } from '../services/accept-external-job.service.js';
import { ResolvePrinterBindingService } from '../services/resolve-printer-binding.service.js';
import { DynamicPrintService } from '../services/dynamic-print.service.js';
import { DynamicIntakeService } from '../services/dynamic-intake.service.js';
import { ExecuteJobService } from '../services/execute-job.service.js';
import { CancelJobService } from '../services/cancel-job.service.js';
import {
  ResultCallbackDispatcher,
  buildResultCallbackPayload,
  RESULT_EVENT_TYPE,
  type CallbackHttpSender,
} from '../services/result-callback-dispatcher.js';
import { DEFAULT_RETRY_POLICY } from '../services/callback-retry-policy.js';

const TEMPLATE = 'TEST_LABEL';
const PROFILE = 'LABEL_100X50';
const PRINTER = 'OFFICE_LASER_01';
const SOURCE = 'medisync';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/* ------------------------------------------------------------------ */
/* fixture                                                             */
/* ------------------------------------------------------------------ */

interface Harness {
  jobRepo: InMemoryJobRepository;
  deliveries: InMemoryCallbackDeliveryRepository;
  eventBus: InMemoryEventBus;
  dispatcher: ResultCallbackDispatcher;
  dynamicPrint: DynamicPrintService;
  dynamicIntake: DynamicIntakeService;
  executeJob: ExecuteJobService;
  cancelJob: CancelJobService;
  endpoints: InMemoryWebhookEndpointRepository;
  httpCalls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }>;
  natsCalls: Array<{ subject: string; body: Record<string, unknown> }>;
  /** Status the fake receiver answers with, per attempt (last value repeats). */
  httpStatuses: number[];
  /** When true the HTTP sender throws (connection failure) instead of replying. */
  httpThrows: { code?: string } | undefined;
  natsThrows: boolean;
  clock: { now: Date };
  policyId: string;
}

async function buildHarness(): Promise<Harness> {
  const printerRepo = new InMemoryPrinterRepository();
  const jobRepo = new InMemoryJobRepository();
  const traceRepo = new InMemoryTraceRepository();
  const auditRepo = new InMemoryAuditRepository();
  const queue = new InMemoryJobQueue();
  const templateRepo = new InMemoryPrintTemplateRepository();
  const paperRepo = new InMemoryPaperProfileRepository();
  const bindingRepo = new InMemoryPrinterTemplateBindingRepository();
  const endpoints = new InMemoryWebhookEndpointRepository();
  const policies = new InMemoryWebhookRoutePolicyRepository();
  const deliveries = new InMemoryCallbackDeliveryRepository();
  const renderer = new SimpleTemplateRenderer();
  const eventBus = new InMemoryEventBus();

  const registry = new AdapterRegistry();
  registry.registerAdapter(new FakePrinterAdapter({ latencyMs: 0 }));

  await printerRepo.create({
    code: PRINTER, name: 'Office Laser', protocol: 'fake', connectionUri: 'fake://office',
    isActive: true, allowedTemplates: [TEMPLATE], maxCopiesPerJob: 50, metadata: {},
  });
  const paper = await paperRepo.create({
    code: PROFILE, name: 'Label 100x50', widthMm: 100, heightMm: 50,
    marginTopMm: 2, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 2,
    dpi: 203, orientation: 'portrait', unit: 'mm',
  });
  await templateRepo.create({
    templateCode: TEMPLATE, name: 'Test Label', engine: 'RAW_TEXT',
    content: 'TEST {{label}}', paperProfileId: paper.id, status: 'PUBLISHED', createdBy: 'test',
  });
  // No adapter is registered for `raw_tcp_9100`, so executing against this
  // printer drives the real FAILED terminal path (the registry lookup happens
  // inside execute()'s try block, after the job has been claimed).
  await printerRepo.create({
    code: 'BROKEN_PRINTER', name: 'Unreachable', protocol: 'raw_tcp_9100',
    connectionUri: 'tcp://192.0.2.1:9100', isActive: true,
    allowedTemplates: [TEMPLATE], maxCopiesPerJob: 50, metadata: {},
  });
  await bindingRepo.create({
    printerCode: PRINTER, templateCode: TEMPLATE, paperProfileId: paper.id,
    isDefault: true, enabled: true,
  });
  const policy = await policies.create({
    policyCode: 'test-static', name: 'Test Static',
    matchRules: { when: [{ field: 'type', op: 'eq', value: 'test_label' }] },
    printerMapping: { strategy: 'static', printer_code: PRINTER },
    templateMapping: { strategy: 'static', template_code: TEMPLATE },
    payloadMapping: { label: '$.label' },
    priorityMapping: { strategy: 'static', priority: 'normal' },
    enabled: true,
  });

  const acceptExternalJob = new AcceptExternalJobService(
    jobRepo, printerRepo, queue, traceRepo, auditRepo, eventBus,
    templateRepo, paperRepo, renderer, undefined, endpoints,
  );
  const resolver = new ResolvePrinterBindingService(paperRepo, bindingRepo, templateRepo);
  const dynamicPrint = new DynamicPrintService(resolver, acceptExternalJob, undefined, endpoints, templateRepo);
  const dynamicIntake = new DynamicIntakeService(
    endpoints, policies, templateRepo, paperRepo, bindingRepo, jobRepo,
    printerRepo, queue, traceRepo, auditRepo, eventBus, renderer,
  );
  const executeJob = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registry);
  const cancelJob = new CancelJobService(jobRepo, traceRepo, auditRepo, eventBus);

  const harness = {
    jobRepo, deliveries, eventBus, endpoints,
    dynamicPrint, dynamicIntake, executeJob, cancelJob,
    httpCalls: [] as Harness['httpCalls'],
    natsCalls: [] as Harness['natsCalls'],
    httpStatuses: [200],
    httpThrows: undefined as Harness['httpThrows'],
    natsThrows: false,
    clock: { now: new Date('2026-07-27T06:00:00.000Z') },
    policyId: policy.id,
  } as Harness;

  const http: CallbackHttpSender = async (url, body, opts) => {
    harness.httpCalls.push({ url, body, headers: opts.headers });
    if (harness.httpThrows) {
      const err = new Error('connect ECONNREFUSED') as Error & { code?: string };
      err.code = harness.httpThrows.code ?? 'ECONNREFUSED';
      throw err;
    }
    const index = Math.min(harness.httpCalls.length - 1, harness.httpStatuses.length - 1);
    return { status: harness.httpStatuses[index] ?? 200, bodyExcerpt: 'ok' };
  };

  harness.dispatcher = new ResultCallbackDispatcher({
    jobs: jobRepo,
    deliveries,
    http,
    nats: (subject, body) => {
      if (harness.natsThrows) throw new Error('nats publish failed');
      harness.natsCalls.push({ subject, body });
    },
    logger: silentLogger,
    policy: DEFAULT_RETRY_POLICY,
    // Injected clock: retry exhaustion has to be provable in milliseconds, not
    // in the 12 real minutes the production schedule spans.
    now: () => harness.clock.now,
    random: () => 0.5, // deterministic: zero jitter
  });
  harness.dispatcher.register(eventBus);

  return harness;
}

async function makeEndpoint(
  h: Harness,
  over: Partial<WebhookEndpoint> & { endpointCode: string },
): Promise<WebhookEndpoint> {
  return h.endpoints.create({
    name: over.endpointCode,
    sourceSystem: SOURCE,
    authMode: 'NONE',
    enabled: true,
    routePolicyId: h.policyId,
    callbackTransport: 'HTTP',
    callbackOnPrintResult: true,
    ...over,
  } as Parameters<typeof h.endpoints.create>[0]);
}

/** Runs the queued job through the fake printer and lets subscribers finish. */
async function printAndSettle(h: Harness, jobId: string): Promise<void> {
  await h.executeJob.execute(jobId, 'test-runner');
  await h.eventBus.settled();
}

/* ------------------------------------------------------------------ */
/* Phase 2 — terminal event                                            */
/* ------------------------------------------------------------------ */

describe('PrintJobTerminal event', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });

  it('is emitted exactly once, on the terminal transition only', async () => {
    const seen: PrintJobTerminal[] = [];
    h.eventBus.subscribe<PrintJobTerminal>('PrintJobTerminal', (e) => { seen.push(e); });

    const accepted = await h.dynamicPrint.submit(
      { request_id: 'R-1', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' } },
      'actor',
    );
    // Nothing yet: acceptance and QUEUED are not print results.
    expect(seen).toHaveLength(0);

    await printAndSettle(h, accepted.print_job_id);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe('SUCCESS');
    expect(seen[0]?.jobId).toBe(accepted.print_job_id);
    expect(seen[0]?.requestId).toBe('R-1');
    expect(seen[0]?.sourceSystem).toBe(SOURCE);
  });

  it('is not re-emitted when the same terminal job is executed again', async () => {
    const seen: PrintJobTerminal[] = [];
    h.eventBus.subscribe<PrintJobTerminal>('PrintJobTerminal', (e) => { seen.push(e); });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'R-2', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' } },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);
    await expect(h.executeJob.execute(accepted.print_job_id, 'test-runner')).rejects.toThrow(/cannot be executed again/i);
    expect(seen).toHaveLength(1);
  });

  it('carries CANCELLED for a cancelled job', async () => {
    const seen: PrintJobTerminal[] = [];
    h.eventBus.subscribe<PrintJobTerminal>('PrintJobTerminal', (e) => { seen.push(e); });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'R-3', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' } },
      'actor',
    );
    await h.cancelJob.execute(accepted.print_job_id, 'operator');
    await h.eventBus.settled();
    expect(seen.map((e) => e.status)).toEqual(['CANCELLED']);
  });
});

/* ------------------------------------------------------------------ */
/* Phase 4 — persisted callback intent                                 */
/* ------------------------------------------------------------------ */

describe('callback intent persistence', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });

  it('resolves a $.field destination at accept time and stores the literal', async () => {
    // The whole reason the intent exists: at terminal time the intake payload
    // that `$.reply_url` points into is gone.
    await makeEndpoint(h, {
      endpointCode: 'dyn', callbackTransport: 'HTTP', callbackUrl: '$.reply_url',
    });
    const accepted = await h.dynamicPrint.submit(
      {
        request_id: 'R-INTENT', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE,
        payload: { label: 'A', reply_url: 'https://receiver.example/results' },
        endpoint_code: 'dyn',
      },
      'actor',
    );
    const job = await h.jobRepo.findById(accepted.print_job_id);
    const intent = readCallbackIntent(job?.metadata);
    expect(intent?.enabled).toBe(true);
    expect(intent?.httpUrl).toBe('https://receiver.example/results');
    expect(intent?.transports).toEqual(['HTTP']);
  });

  it('still sends the final result when the legacy callbackOnPrintResult flag is off', async () => {
    await makeEndpoint(h, {
      endpointCode: 'off', callbackTransport: 'HTTP',
      callbackUrl: 'https://receiver.example/r', callbackOnPrintResult: false,
    });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'R-OFF', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' }, endpoint_code: 'off' },
      'actor',
    );
    const job = await h.jobRepo.findById(accepted.print_job_id);
    const intent = readCallbackIntent(job?.metadata);
    expect(intent?.enabled).toBe(true);

    await printAndSettle(h, accepted.print_job_id);
    expect(h.httpCalls).toHaveLength(1);
    expect(await h.deliveries.findAll({ printJobId: accepted.print_job_id })).toHaveLength(1);
  });

  it('rejects an endpoint_code belonging to another source system, before printing', async () => {
    await makeEndpoint(h, { endpointCode: 'other', callbackUrl: 'https://r/e' });
    await expect(
      h.dynamicPrint.submit(
        { request_id: 'R-X', source_system: 'someone-else', code_template: TEMPLATE, code_profile: PROFILE, payload: {}, endpoint_code: 'other' },
        'actor',
      ),
    ).rejects.toMatchObject({ code: 'CALLBACK_ENDPOINT_FORBIDDEN', statusCode: 403 });
    expect(await h.jobRepo.findByRequestId('R-X', 'someone-else')).toBeUndefined();
  });

  it('rejects an unknown endpoint_code', async () => {
    await expect(
      h.dynamicPrint.submit(
        { request_id: 'R-Y', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: {}, endpoint_code: 'nope' },
        'actor',
      ),
    ).rejects.toMatchObject({ code: 'CALLBACK_ENDPOINT_NOT_FOUND', statusCode: 422 });
  });

  it('rejects a callback destination the SSRF guard refuses', async () => {
    await makeEndpoint(h, { endpointCode: 'ssrf', callbackUrl: '$.reply_url' });
    await expect(
      h.dynamicPrint.submit(
        {
          request_id: 'R-SSRF', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE,
          payload: { reply_url: 'http://169.254.169.254/latest/meta-data/' },
          endpoint_code: 'ssrf',
        },
        'actor',
      ),
    ).rejects.toMatchObject({ code: 'CALLBACK_DESTINATION_REJECTED' });
  });

  it('leaves callers that send no endpoint_code completely unaffected', async () => {
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'R-NONE', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' } },
      'actor',
    );
    const job = await h.jobRepo.findById(accepted.print_job_id);
    expect(readCallbackIntent(job?.metadata)).toBeUndefined();
    await printAndSettle(h, accepted.print_job_id);
    expect(h.httpCalls).toHaveLength(0);
  });

  it('automatically uses the single callback endpoint for the source system', async () => {
    await makeEndpoint(h, {
      endpointCode: 'source-default',
      callbackTransport: 'NATS',
      callbackNatsSubject: 'results.default',
    });
    const accepted = await h.dynamicPrint.submit(
      {
        request_id: 'AUTO-ENDPOINT',
        source_system: SOURCE,
        code_template: TEMPLATE,
        code_profile: PROFILE,
        payload: { label: 'A' },
      },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);
    expect(h.natsCalls).toEqual([
      expect.objectContaining({ subject: 'results.default' }),
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Phase 5 — the four input x callback paths                           */
/* ------------------------------------------------------------------ */

describe('E2E matrix: {API, NATS} intake x {HTTP, NATS} callback', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });

  it('API intake -> print -> HTTP webhook delivers a TERMINAL result', async () => {
    await makeEndpoint(h, { endpointCode: 'api-http', callbackTransport: 'HTTP', callbackUrl: 'https://receiver.example/results' });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'M1', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'M1' }, endpoint_code: 'api-http' },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);

    expect(h.httpCalls).toHaveLength(1);
    const body = h.httpCalls[0]!.body;
    // The defect this replaces: the old callback said QUEUED regardless of the
    // eventual outcome.
    expect(body['print_status']).toBe('SUCCESS');
    expect(body['event_type']).toBe(RESULT_EVENT_TYPE);
    expect(body['request_id']).toBe('M1');
    expect(body['job_id']).toBe(accepted.print_job_id);
    expect(body['version']).toBe(1);

    const [delivery] = await h.deliveries.findAll({ printJobId: accepted.print_job_id });
    expect(delivery?.deliveryStatus).toBe('DELIVERED');
    expect(delivery?.guarantee).toBe('ACKNOWLEDGED');
    expect(delivery?.attemptCount).toBe(1);
  });

  it('API intake -> print -> NATS publishes a TERMINAL result, labelled BEST_EFFORT', async () => {
    await makeEndpoint(h, { endpointCode: 'api-nats', callbackTransport: 'NATS', callbackNatsSubject: 'results.medisync' });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'M2', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'M2' }, endpoint_code: 'api-nats' },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);

    expect(h.natsCalls).toHaveLength(1);
    expect(h.natsCalls[0]!.subject).toBe('results.medisync');
    expect(h.natsCalls[0]!.body['print_status']).toBe('SUCCESS');

    const [delivery] = await h.deliveries.findAll({ printJobId: accepted.print_job_id });
    // A Core publish that did not throw proves the bytes left this process and
    // nothing more. Reporting ACKNOWLEDGED here would be a lie.
    expect(delivery?.guarantee).toBe('BEST_EFFORT');
    expect(delivery?.deliveryStatus).toBe('DELIVERED');
  });

  it('NATS intake (endpoint_code in the envelope) -> print -> HTTP webhook', async () => {
    await makeEndpoint(h, { endpointCode: 'nats-http', callbackTransport: 'HTTP', callbackUrl: 'https://receiver.example/results' });
    // Exactly what the NATS consumer forwards from the envelope.
    const accepted = await h.dynamicPrint.submit(
      {
        request_id: 'M3', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE,
        printer_code: PRINTER, payload: { label: 'M3' }, endpoint_code: 'nats-http',
      },
      'nats:medisync:client:c1',
    );
    await printAndSettle(h, accepted.print_job_id);
    expect(h.httpCalls).toHaveLength(1);
    expect(h.httpCalls[0]!.body['print_status']).toBe('SUCCESS');
  });

  it('NATS intake -> print -> NATS callback', async () => {
    await makeEndpoint(h, { endpointCode: 'nats-nats', callbackTransport: 'NATS', callbackNatsSubject: '$.reply_to' });
    const accepted = await h.dynamicPrint.submit(
      {
        request_id: 'M4', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE,
        printer_code: PRINTER, payload: { label: 'M4', reply_to: 'medisync.results.c1' },
        endpoint_code: 'nats-nats',
      },
      'nats:medisync:client:c1',
    );
    await printAndSettle(h, accepted.print_job_id);
    expect(h.natsCalls.map((c) => c.subject)).toEqual(['medisync.results.c1']);
    expect(h.natsCalls[0]!.body['print_status']).toBe('SUCCESS');
  });

  it('fans out to BOTH transports from one endpoint', async () => {
    await makeEndpoint(h, {
      endpointCode: 'both', callbackTransport: 'BOTH',
      callbackUrl: 'https://receiver.example/results', callbackNatsSubject: 'results.both',
    });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'M5', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'M5' }, endpoint_code: 'both' },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);
    expect(h.httpCalls).toHaveLength(1);
    expect(h.natsCalls).toHaveLength(1);
    expect(await h.deliveries.findAll({ printJobId: accepted.print_job_id })).toHaveLength(2);
  });

  it('delivers a FAILED print result, not just successes', async () => {
    await makeEndpoint(h, { endpointCode: 'fail', callbackUrl: 'https://receiver.example/results' });
    const accepted = await h.dynamicPrint.submit(
      {
        request_id: 'M6', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE,
        // BROKEN_PRINTER's protocol has no registered adapter, so
        // getAdapterForPrinter() throws INSIDE execute()'s try block — the job
        // still claims, still reaches a terminal state, and still reports.
        printer_code: 'BROKEN_PRINTER', payload: { label: 'M6' }, endpoint_code: 'fail',
      },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);

    const job = await h.jobRepo.findById(accepted.print_job_id);
    expect(job?.status).toBe('FAILED');

    expect(h.httpCalls).toHaveLength(1);
    const body = h.httpCalls[0]!.body;
    expect(body['print_status']).toBe('FAILED');
    expect(body['error']).toMatchObject({ code: 'EXECUTION_ERROR' });

    const [delivery] = await h.deliveries.findAll({ printJobId: accepted.print_job_id });
    // Print FAILED, callback DELIVERED — the two statuses are independent.
    expect(delivery?.printStatus).toBe('FAILED');
    expect(delivery?.deliveryStatus).toBe('DELIVERED');
  });

  it('delivers a CANCELLED print result', async () => {
    await makeEndpoint(h, { endpointCode: 'cancel', callbackUrl: 'https://receiver.example/results' });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'M8', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'M8' }, endpoint_code: 'cancel' },
      'actor',
    );
    await h.cancelJob.execute(accepted.print_job_id, 'operator');
    await h.eventBus.settled();

    expect(h.httpCalls).toHaveLength(1);
    expect(h.httpCalls[0]!.body['print_status']).toBe('CANCELLED');
    expect(h.httpCalls[0]!.body['error']).toMatchObject({ code: 'JOB_CANCELLED' });
  });

  it('separates print status from callback status', async () => {
    // print SUCCESS + callback FAILED must be representable and visible.
    await makeEndpoint(h, { endpointCode: 'split', callbackUrl: 'https://receiver.example/results' });
    h.httpStatuses = [400];
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'M7', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'M7' }, endpoint_code: 'split' },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);

    const job = await h.jobRepo.findById(accepted.print_job_id);
    const [delivery] = await h.deliveries.findAll({ printJobId: accepted.print_job_id });
    expect(job?.status).toBe('SUCCESS');
    expect(delivery?.deliveryStatus).toBe('FAILED');
    expect(delivery?.printStatus).toBe('SUCCESS');
  });
});

/* ------------------------------------------------------------------ */
/* Phase 7 — HTTP retry                                                */
/* ------------------------------------------------------------------ */

describe('HTTP callback retry', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });

  async function submitAndPrint(requestId: string): Promise<string> {
    await makeEndpoint(h, { endpointCode: `ep-${requestId}`, callbackUrl: 'https://receiver.example/results' });
    const accepted = await h.dynamicPrint.submit(
      { request_id: requestId, source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: requestId }, endpoint_code: `ep-${requestId}` },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);
    return accepted.print_job_id;
  }

  it('schedules a retry after a 500 and delivers on the next attempt', async () => {
    h.httpStatuses = [500, 200];
    const jobId = await submitAndPrint('RT-1');

    let [delivery] = await h.deliveries.findAll({ printJobId: jobId });
    expect(delivery?.deliveryStatus).toBe('RETRY_SCHEDULED');
    expect(delivery?.attemptCount).toBe(1);
    expect(delivery?.lastHttpStatus).toBe(500);
    expect(delivery?.nextAttemptAt?.getTime()).toBe(h.clock.now.getTime() + 5_000);

    // Advance the injected clock instead of sleeping 5 real seconds.
    h.clock.now = new Date(h.clock.now.getTime() + 5_000);
    await h.dispatcher.sweep();

    [delivery] = await h.deliveries.findAll({ printJobId: jobId });
    expect(delivery?.deliveryStatus).toBe('DELIVERED');
    expect(delivery?.attemptCount).toBe(2);
    expect(h.httpCalls).toHaveLength(2);
  });

  it('retries a connection failure', async () => {
    h.httpThrows = { code: 'ECONNREFUSED' };
    const jobId = await submitAndPrint('RT-2');
    const [delivery] = await h.deliveries.findAll({ printJobId: jobId });
    expect(delivery?.deliveryStatus).toBe('RETRY_SCHEDULED');
    expect(delivery?.lastErrorCode).toBe('ECONNREFUSED');
  });

  it('does NOT retry a permanent 400 and fails immediately', async () => {
    h.httpStatuses = [400];
    const jobId = await submitAndPrint('RT-3');
    const [delivery] = await h.deliveries.findAll({ printJobId: jobId });
    expect(delivery?.deliveryStatus).toBe('FAILED');
    expect(delivery?.attemptCount).toBe(1);
    expect(delivery?.nextAttemptAt).toBeUndefined();
    expect(h.httpCalls).toHaveLength(1);
  });

  it('exhausts the budget and reports FAILED after maxAttempts', async () => {
    h.httpStatuses = [503];
    const jobId = await submitAndPrint('RT-4');

    for (let i = 0; i < 10; i += 1) {
      h.clock.now = new Date(h.clock.now.getTime() + 15 * 60_000);
      const swept = await h.dispatcher.sweep();
      if (swept === 0) break;
    }
    const [delivery] = await h.deliveries.findAll({ printJobId: jobId });
    expect(delivery?.deliveryStatus).toBe('FAILED');
    expect(delivery?.attemptCount).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    expect(h.httpCalls).toHaveLength(DEFAULT_RETRY_POLICY.maxAttempts);
  });

  it('re-sends the same event_id on every attempt so a receiver can dedupe', async () => {
    h.httpStatuses = [500, 200];
    const jobId = await submitAndPrint('RT-5');
    h.clock.now = new Date(h.clock.now.getTime() + 5_000);
    await h.dispatcher.sweep();

    expect(h.httpCalls).toHaveLength(2);
    expect(h.httpCalls[0]!.body['event_id']).toBe(h.httpCalls[1]!.body['event_id']);
    expect(h.httpCalls[0]!.headers['X-PrintOps-Event-Id']).toBe(h.httpCalls[1]!.headers['X-PrintOps-Event-Id']);
    // Still ONE delivery record — attempts belong to it, they are not new
    // deliveries.
    expect(await h.deliveries.findAll({ printJobId: jobId })).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Phase 17 — callback idempotency + restart recovery                  */
/* ------------------------------------------------------------------ */

describe('callback idempotency and recovery', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });

  it('a duplicate terminal event produces exactly one delivery and one callback', async () => {
    await makeEndpoint(h, { endpointCode: 'idem', callbackUrl: 'https://receiver.example/results' });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'ID-1', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' }, endpoint_code: 'idem' },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);
    expect(h.httpCalls).toHaveLength(1);

    // Replay the same terminal event — an EventBus redelivery, a NATS
    // redelivery, or a restart replaying history.
    const job = (await h.jobRepo.findById(accepted.print_job_id))!;
    await h.dispatcher.handleTerminal({
      eventId: 'a-completely-different-event-id',
      eventType: 'PrintJobTerminal',
      traceId: job.traceId,
      correlationId: job.correlationId,
      occurredAt: new Date(),
      jobId: job.id,
      status: 'SUCCESS',
    });

    // Deduped on (jobId, transport, target), NOT on eventId — which is a fresh
    // value per publish and would have let this through.
    expect(h.httpCalls).toHaveLength(1);
    expect(await h.deliveries.findAll({ printJobId: job.id })).toHaveLength(1);
  });

  it('re-arms a delivery a crashed process left DELIVERING', async () => {
    await makeEndpoint(h, { endpointCode: 'crash', callbackUrl: 'https://receiver.example/results' });
    h.httpThrows = { code: 'ECONNRESET' };
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'ID-2', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' }, endpoint_code: 'crash' },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);

    const [delivery] = await h.deliveries.findAll({ printJobId: accepted.print_job_id });
    // Simulate the crash window: status stuck in DELIVERING, invisible to both
    // the subscriber (already ran) and the retry sweep (only sees
    // RETRY_SCHEDULED).
    await h.deliveries.update(delivery!.id, { deliveryStatus: 'DELIVERING', nextAttemptAt: undefined });
    expect(await h.dispatcher.sweep()).toBe(0);

    const recovered = await h.dispatcher.recoverInFlight();
    expect(recovered).toBe(1);

    h.httpThrows = undefined;
    h.httpStatuses = [200];
    expect(await h.dispatcher.sweep()).toBe(1);
    const [after] = await h.deliveries.findAll({ printJobId: accepted.print_job_id });
    expect(after?.deliveryStatus).toBe('DELIVERED');
  });

  it('does not break print idempotency', async () => {
    await makeEndpoint(h, { endpointCode: 'dupe', callbackUrl: 'https://receiver.example/results' });
    const first = await h.dynamicPrint.submit(
      { request_id: 'DUP-1', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' }, endpoint_code: 'dupe' },
      'actor',
    );
    const second = await h.dynamicPrint.submit(
      { request_id: 'DUP-1', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' }, endpoint_code: 'dupe' },
      'actor',
    );
    expect(second.duplicate).toBe(true);
    expect(second.print_job_id).toBe(first.print_job_id);

    await printAndSettle(h, first.print_job_id);
    expect(h.httpCalls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Phase 6 — payload contract                                          */
/* ------------------------------------------------------------------ */

describe('result callback payload', () => {
  it('preserves UNVERIFIED instead of flattening it into FAILED', () => {
    // "Could not confirm" is not "did not print". Telling an integrator FAILED
    // here invites a duplicate reprint of a label that may already exist.
    const payload = buildResultCallbackPayload(
      {
        eventId: 'evt-1', eventType: 'PrintJobTerminal', traceId: 't', correlationId: 'c',
        occurredAt: new Date('2026-07-27T06:00:00Z'), jobId: 'job-1', status: 'UNVERIFIED',
        errorCode: 'PRINT_NOT_VERIFIABLE', errorMessage: 'no device confirmation',
      },
      { id: 'job-1', requestId: 'R', sourceSystem: SOURCE, printerCode: PRINTER, metadata: {} } as never,
      { enabled: true, trigger: 'PRINT_RESULT', transports: ['HTTP'] },
    );
    expect(payload['print_status']).toBe('UNVERIFIED');
    expect(payload['error']).toEqual({ code: 'PRINT_NOT_VERIFIABLE', message: 'no device confirmation' });
  });

  it('carries a null error on success and a versioned envelope', () => {
    const payload = buildResultCallbackPayload(
      {
        eventId: 'evt-2', eventType: 'PrintJobTerminal', traceId: 'trace-1', correlationId: 'c',
        occurredAt: new Date('2026-07-27T06:00:00Z'), jobId: 'job-2', status: 'SUCCESS',
      },
      { id: 'job-2', requestId: 'R2', sourceSystem: SOURCE, printerCode: PRINTER, metadata: {} } as never,
      { enabled: true, trigger: 'PRINT_RESULT', transports: ['NATS'], natsMode: 'CORE' },
    );
    expect(payload['version']).toBe(1);
    expect(payload['event_type']).toBe('print.job.completed');
    expect(payload['error']).toBeNull();
    expect(payload['trace_id']).toBe('trace-1');
    expect(payload['delivery']).toEqual({ transports: ['NATS'], nats_mode: 'CORE' });
    // No print payload: a callback is a notification, not a copy of the label.
    expect(Object.keys(payload)).not.toContain('payload');
    expect(Object.keys(payload)).not.toContain('rendered_print_payload');
  });
});

/* ------------------------------------------------------------------ */
/* Phase 15 — unknown template                                         */
/* ------------------------------------------------------------------ */

describe('unknown template_code', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });

  it('is rejected with 422 and creates no job, even when printer_code is explicit', async () => {
    // The hole: an explicit printer_code skipped binding resolution, which was
    // the only place code_template was ever checked — so the job printed
    // unrendered.
    await expect(
      h.dynamicPrint.submit(
        {
          request_id: 'T-1', source_system: SOURCE, code_template: 'NO_SUCH_TEMPLATE',
          code_profile: PROFILE, printer_code: PRINTER, payload: { label: 'A' },
        },
        'actor',
      ),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND', statusCode: 422 });
    expect(await h.jobRepo.findByRequestId('T-1', SOURCE)).toBeUndefined();
  });

  it('still accepts a known template on the explicit-printer path', async () => {
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'T-2', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, printer_code: PRINTER, payload: { label: 'A' } },
      'actor',
    );
    expect(accepted.duplicate).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Phase 3 — production subscriber registration                        */
/* ------------------------------------------------------------------ */

describe('production subscriber wiring', () => {
  it('registers on the bus and is driven by a real published event', async () => {
    const h = await buildHarness();
    await makeEndpoint(h, { endpointCode: 'wired', callbackUrl: 'https://receiver.example/results' });
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'W-1', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' }, endpoint_code: 'wired' },
      'actor',
    );
    // No direct dispatcher call anywhere below — only executeJob, which
    // publishes. This is the loop that had no non-test subscriber before.
    await printAndSettle(h, accepted.print_job_id);
    expect(h.httpCalls).toHaveLength(1);
  });

  it('isolates a throwing subscriber instead of turning it into a crash', async () => {
    const errors: unknown[] = [];
    const bus = new InMemoryEventBus({ onHandlerError: (_e, err) => errors.push(err) });
    bus.subscribe('JobSucceeded', () => { throw new Error('boom'); });
    bus.subscribe('JobSucceeded', async () => { throw new Error('async boom'); });
    bus.publish({
      eventId: 'e', eventType: 'JobSucceeded', traceId: 't', correlationId: 'c',
      occurredAt: new Date(), jobId: 'j', durationMs: 1,
    });
    await bus.settled();
    expect(errors).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* Phase 9 — NATS delivery semantics                                   */
/* ------------------------------------------------------------------ */

describe('NATS callback delivery mode', () => {
  it('retries a failed publish and never claims subscriber delivery', async () => {
    const h = await buildHarness();
    await makeEndpoint(h, { endpointCode: 'nats-fail', callbackTransport: 'NATS', callbackNatsSubject: 'results.x' });
    h.natsThrows = true;
    const accepted = await h.dynamicPrint.submit(
      { request_id: 'N-1', source_system: SOURCE, code_template: TEMPLATE, code_profile: PROFILE, payload: { label: 'A' }, endpoint_code: 'nats-fail' },
      'actor',
    );
    await printAndSettle(h, accepted.print_job_id);

    let [delivery] = await h.deliveries.findAll({ printJobId: accepted.print_job_id });
    expect(delivery?.deliveryStatus).toBe('RETRY_SCHEDULED');

    h.natsThrows = false;
    h.clock.now = new Date(h.clock.now.getTime() + 5_000);
    await h.dispatcher.sweep();
    [delivery] = await h.deliveries.findAll({ printJobId: accepted.print_job_id });
    expect(delivery?.deliveryStatus).toBe('DELIVERED');
    // Even on success the guarantee stays BEST_EFFORT — Core NATS cannot prove
    // a subscriber received anything.
    expect(delivery?.guarantee).toBe('BEST_EFFORT');
  });
});

/* ------------------------------------------------------------------ */
/* Phase 13 — the DynamicIntake (webhook) path                         */
/* ------------------------------------------------------------------ */

describe('webhook intake path', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });

  it('sends the terminal result and suppresses the acceptance notification', async () => {
    const accepted: Array<Record<string, unknown>> = [];
    h.dynamicIntake.setCallbackService({
      send: async (ctx: { result: Record<string, unknown> }) => { accepted.push(ctx.result); return { transport: 'HTTP' }; },
    } as never);
    await makeEndpoint(h, { endpointCode: 'intake-http', callbackUrl: 'https://receiver.example/results' });

    const res = await h.dynamicIntake.execute({
      endpointCode: 'intake-http',
      headers: {},
      body: { request_id: 'WI-1', type: 'test_label', label: 'A' },
    });
    // callbackOnPrintResult: true means "notify me on the RESULT instead of at
    // acceptance", so nothing fires here.
    expect(accepted).toHaveLength(0);

    await printAndSettle(h, res.print_job_id);
    expect(h.httpCalls).toHaveLength(1);
    expect(h.httpCalls[0]!.body['print_status']).toBe('SUCCESS');
  });

  it('sends one final result when the legacy callbackOnPrintResult flag is off', async () => {
    const sent: Array<Record<string, unknown>> = [];
    h.dynamicIntake.setCallbackService({
      send: async (ctx: { result: Record<string, unknown> }) => { sent.push(ctx.result); return { transport: 'HTTP' }; },
    } as never);
    await makeEndpoint(h, {
      endpointCode: 'intake-accept', callbackUrl: 'https://receiver.example/results',
      callbackOnPrintResult: false,
    });
    const res = await h.dynamicIntake.execute({
      endpointCode: 'intake-accept',
      headers: {},
      body: { request_id: 'WI-2', type: 'test_label', label: 'A' },
    });
    expect(sent).toHaveLength(0);

    await printAndSettle(h, res.print_job_id);
    expect(h.httpCalls).toHaveLength(1);
    expect(h.httpCalls[0]!.body['print_status']).toBe('SUCCESS');
  });
});
