import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { JobCallbackIntent, PrintJobTerminal, WebhookEndpoint } from '@printerops/domain';
import {
  ACCEPTANCE_CALLBACK_SYSTEM_FIELDS,
  CALLBACK_ENVELOPE_SYSTEM_FIELDS,
  readCallbackIntent,
} from '@printerops/domain';

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
import { ExecuteJobService } from '../services/execute-job.service.js';
import { WebhookCallbackService, resolveTemplate } from '../services/webhook-callback.service.js';
import {
  ResultCallbackDispatcher,
  buildResultCallbackPayload,
  type CallbackHttpSender,
} from '../services/result-callback-dispatcher.js';
import { DEFAULT_RETRY_POLICY } from '../services/callback-retry-policy.js';
import { buildCallbackEnvelope, CALLBACK_ENVELOPE_VERSION } from '../services/callback-payload.js';

const TEMPLATE = 'TEST_LABEL';
const PROFILE = 'LABEL_100X50';
const PRINTER = 'OFFICE_LASER_01';
const SOURCE = 'medisync';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * The complete `$$.field` vocabulary the Webhooks page offers an operator:
 * every acceptance-intake field plus every v2 envelope key (deduplicated,
 * exactly like SYSTEM_FIELD_TOKENS in apps/web). A template exercising every
 * token is the strongest form of the parity invariant: whatever the
 * acceptance callback can resolve, the terminal callback must resolve too —
 * nothing may silently disappear between the two rounds.
 */
const ALL_SYSTEM_FIELDS: readonly string[] = [
  ...new Set([...ACCEPTANCE_CALLBACK_SYSTEM_FIELDS, ...CALLBACK_ENVELOPE_SYSTEM_FIELDS]),
];

function fullVocabularyTemplate(): Record<string, unknown> {
  const template: Record<string, unknown> = {};
  for (const field of ALL_SYSTEM_FIELDS) {
    template[`$$.${field}`] = `$$.${field}`;
  }
  template['label'] = '$.label';
  template['literal'] = 'fixed-value';
  template['nested'] = { keep: 'object-value' };
  return template;
}

/** The intake response shape the ACCEPTANCE callback resolves against. */
const ACCEPTED: Record<string, unknown> = {
  accepted: true,
  print_job_id: 'job-9',
  job_id: 'job-9',
  request_id: 'REQ-9',
  trace_id: 'trace-9',
  source_system: SOURCE,
  created_at: '2026-08-05T09:00:00.000Z',
  queued_at: '2026-08-05T09:00:00.100Z',
  resolved_printer_code: PRINTER,
  resolved_template_code: TEMPLATE,
  status: 'QUEUED',
  duplicate: false,
};

const INTAKE: Record<string, unknown> = { label: 'M9', barcode: '123' };

function terminalEvent(over: Partial<PrintJobTerminal> = {}): PrintJobTerminal {
  return {
    eventId: 'evt-9',
    eventType: 'PrintJobTerminal',
    traceId: 'trace-9',
    correlationId: 'c-9',
    occurredAt: new Date('2026-08-05T09:01:00.000Z'),
    finishedAt: new Date('2026-08-05T09:01:02.000Z'),
    jobId: 'job-9',
    status: 'SUCCESS',
    printerCode: PRINTER,
    runnerId: 'runner-x',
    requestId: 'REQ-9',
    sourceSystem: SOURCE,
    ...over,
  };
}

/** A job as it exists at terminal time, with the stored intake payload. */
function terminalJob() {
  return {
    id: 'job-9',
    requestId: 'REQ-9',
    sourceSystem: SOURCE,
    printerCode: PRINTER,
    templateCode: TEMPLATE,
    resolvedTemplateCode: TEMPLATE,
    receivedAt: new Date('2026-08-05T09:00:00.000Z'),
    createdAt: new Date('2026-08-05T09:00:00.000Z'),
    queuedAt: new Date('2026-08-05T09:00:00.100Z'),
    metadata: { payload: { ...INTAKE } },
  };
}

function intentWithTemplate(template: Record<string, unknown>): JobCallbackIntent {
  return {
    enabled: true,
    trigger: 'PRINT_RESULT',
    transports: ['HTTP'],
    httpUrl: 'https://receiver.example/results',
    endpointId: 'ep-9',
    endpointCode: 'parity',
    payloadTemplate: template,
  };
}

/* ------------------------------------------------------------------ */
/* Unit level: both resolvers agree on the full token vocabulary       */
/* ------------------------------------------------------------------ */

describe('callback payload parity — acceptance vs terminal resolver', () => {
  const template = fullVocabularyTemplate();
  const intent = intentWithTemplate(template);

  it('resolves every acceptance-resolvable $$.field in the terminal callback (nothing dropped)', () => {
    const round1 = resolveTemplate(template, INTAKE, ACCEPTED, { callbackTransport: 'HTTP' });
    const round2 = buildResultCallbackPayload(terminalEvent(), terminalJob() as never, intent);

    // Every key the acceptance callback produced MUST also exist in the
    // terminal callback. Before the fix, $$.print_job_id / $$.created_at /
    // $$.queued_at / $$.resolved_printer_code / $$.resolved_template_code
    // resolve against the intake response but not against the v2 terminal
    // envelope — the key silently vanished from the second round.
    for (const key of Object.keys(round1)) {
      expect(round2, `'${key}' was dropped from the terminal callback`).toHaveProperty(key);
    }
  });

  it('produces the identical key set in both rounds', () => {
    const round1 = resolveTemplate(template, INTAKE, ACCEPTED, { callbackTransport: 'HTTP' });
    const round2 = buildResultCallbackPayload(terminalEvent(), terminalJob() as never, intent);

    expect(Object.keys(round2).sort()).toEqual(Object.keys(round1).sort());
  });

  it('sends job-level values identically in both rounds', () => {
    const round1 = resolveTemplate(template, INTAKE, ACCEPTED, { callbackTransport: 'HTTP' });
    const round2 = buildResultCallbackPayload(terminalEvent(), terminalJob() as never, intent);

    // Job-identity and intake data must be byte-identical across rounds.
    for (const key of [
      '$$.print_job_id', '$$.job_id', '$$.request_id', '$$.trace_id', '$$.source_system',
      '$$.created_at', '$$.queued_at', '$$.resolved_printer_code', '$$.resolved_template_code',
      '$$.version', '$$.client_id', '$$.duplicate', '$$.printer_code',
      'label', 'literal', 'nested',
    ]) {
      expect(round2[key], `value of '${key}' diverged between rounds`).toEqual(round1[key]);
    }
    // Phase-specific keys must still exist and carry the REAL final values.
    expect(round2['$$.status']).toBe('SUCCESS');
    expect(round2['$$.event_type']).toBe('print.job.completed');
    expect(round2['$$.occurred_at']).toBe('2026-08-05T09:01:02.000Z');
    expect(round2['$$.timeline.terminal_at']).toBe('2026-08-05T09:01:02.000Z');
    expect(round2['$$.timeline.accepted_at']).toBe('2026-08-05T09:00:00.000Z');
    expect(round2['$$.timeline.queued_at']).toBe('2026-08-05T09:00:00.100Z');
  });
});

/* ------------------------------------------------------------------ */
/* End to end: one job through both rounds, same body keys/values      */
/* ------------------------------------------------------------------ */

interface Harness {
  jobRepo: InMemoryJobRepository;
  eventBus: InMemoryEventBus;
  dynamicPrint: DynamicPrintService;
  executeJob: ExecuteJobService;
  endpoints: InMemoryWebhookEndpointRepository;
  httpCalls: Array<{ url: string; body: Record<string, unknown> }>;
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
  const executeJob = new ExecuteJobService(jobRepo, printerRepo, traceRepo, auditRepo, queue, eventBus, registry);

  const harness = {
    jobRepo, eventBus, endpoints, dynamicPrint, executeJob,
    httpCalls: [] as Harness['httpCalls'],
    policyId: policy.id,
  } as Harness;

  // The ACCEPTANCE callback transport — the same body the receiver sees in
  // round 1 (the dispatcher's own http mock captures round 2 below).
  const acceptanceHttp = async (url: string, body: unknown): Promise<void> => {
    harness.httpCalls.push({ url, body: body as Record<string, unknown> });
  };
  dynamicPrint.setCallbackService(new WebhookCallbackService(silentLogger, acceptanceHttp, () => {}));

  const http: CallbackHttpSender = async (url, body) => {
    harness.httpCalls.push({ url, body });
    return { status: 200, bodyExcerpt: 'ok' };
  };
  const dispatcher = new ResultCallbackDispatcher({
    jobs: jobRepo,
    deliveries,
    http,
    logger: silentLogger,
    policy: DEFAULT_RETRY_POLICY,
  });
  dispatcher.register(eventBus);

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
    // Acceptance mode: BOTH rounds must fire for the same job.
    callbackOnPrintResult: false,
    ...over,
  } as Parameters<typeof h.endpoints.create>[0]);
}

describe('callback payload parity — one job end to end', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });

  it('sends the same template keys and job-level values in the acceptance and the terminal callback', async () => {
    await makeEndpoint(h, {
      endpointCode: 'parity-e2e',
      callbackUrl: 'https://receiver.example/results',
      callbackPayloadTemplate: fullVocabularyTemplate(),
    });

    const accepted = await h.dynamicPrint.submit(
      {
        request_id: 'R-PARITY',
        source_system: SOURCE,
        code_template: TEMPLATE,
        code_profile: PROFILE,
        payload: { label: 'M9', barcode: '123' },
        endpoint_code: 'parity-e2e',
      },
      'actor',
    );

    // Round 1: the acceptance callback (fire-and-forget from submit).
    await vi.waitFor(() => expect(h.httpCalls.length).toBe(1));
    const round1 = h.httpCalls[0]!.body;

    // Round 2: print through the fake adapter -> terminal event -> dispatcher.
    await h.executeJob.execute(accepted.print_job_id, 'test-runner');
    await h.eventBus.settled();
    await vi.waitFor(() => expect(h.httpCalls.length).toBe(2));
    const round2 = h.httpCalls[1]!.body;

    // The two rounds of the SAME job must carry the SAME keys.
    expect(Object.keys(round2).sort()).toEqual(Object.keys(round1).sort());

    // Every job-level value must be byte-identical between rounds.
    for (const key of [
      '$$.print_job_id', '$$.job_id', '$$.request_id', '$$.trace_id', '$$.source_system',
      '$$.created_at', '$$.queued_at', '$$.resolved_printer_code', '$$.resolved_template_code',
      '$$.version', '$$.client_id', '$$.duplicate', '$$.printer_code',
      'label', 'literal', 'nested',
    ]) {
      expect(round2[key], `'${key}' diverged between the two callbacks`).toEqual(round1[key]);
    }

    // Phase-specific keys: present in both, real final values in round 2.
    expect(round1['$$.status']).toBe('QUEUED');
    expect(round2['$$.status']).toBe('SUCCESS');
    expect(round1['$$.event_type']).toBe('print.job.accepted');
    expect(round2['$$.event_type']).toBe('print.job.completed');
  });

  it('keeps the payload template snapshot on the job so the terminal round can resolve it', async () => {
    const template = fullVocabularyTemplate();
    await makeEndpoint(h, {
      endpointCode: 'parity-snapshot',
      callbackUrl: 'https://receiver.example/results',
      callbackPayloadTemplate: template,
    });

    const accepted = await h.dynamicPrint.submit(
      {
        request_id: 'R-SNAP',
        source_system: SOURCE,
        code_template: TEMPLATE,
        code_profile: PROFILE,
        payload: { label: 'M9' },
        endpoint_code: 'parity-snapshot',
      },
      'actor',
    );

    const job = await h.jobRepo.findById(accepted.print_job_id);
    const intent = readCallbackIntent(job?.metadata);
    expect(intent?.payloadTemplate).toEqual(template);
    // And the terminal payload is actually shaped by it.
    const round2 = buildResultCallbackPayload(
      terminalEvent({ jobId: accepted.print_job_id, requestId: 'R-SNAP', printerCode: PRINTER }),
      {
        ...(job as unknown as Record<string, unknown>),
        printerCode: PRINTER,
        resolvedTemplateCode: TEMPLATE,
        templateCode: TEMPLATE,
      } as never,
      intent as JobCallbackIntent,
    );
    expect(round2['$$.job_id']).toBe(accepted.print_job_id);
    expect(round2['$$.print_job_id']).toBe(accepted.print_job_id);
    expect(round2['label']).toBe('M9');
  });
});

/* ------------------------------------------------------------------ */
/* Envelope sanity: the fixed (template-less) envelope keeps its shape  */
/* ------------------------------------------------------------------ */

describe('callback payload parity — default envelope unchanged', () => {
  it('still carries job_id (the v2 key) when no template is configured', () => {
    const event = terminalEvent();
    const payload = buildResultCallbackPayload(
      event,
      terminalJob() as never,
      intentWithTemplate({}), // empty template -> fixed envelope path
    );
    expect(payload['job_id']).toBe('job-9');
    expect(payload['print_job_id']).toBeUndefined();
    expect(payload['version']).toBe(CALLBACK_ENVELOPE_VERSION);
  });

  it('acceptance envelope builds the same key vocabulary', () => {
    const envelope = buildCallbackEnvelope({
      eventId: 'e',
      eventType: 'print.job.accepted',
      occurredAt: '2026-08-05T09:00:00.100Z',
      requestId: 'REQ-9',
      jobId: 'job-9',
      sourceSystem: SOURCE,
      status: 'QUEUED',
      timeline: { acceptedAt: '2026-08-05T09:00:00.000Z', queuedAt: '2026-08-05T09:00:00.100Z' },
      transports: ['HTTP'],
    });
    expect(envelope['job_id']).toBe('job-9');
    expect(envelope['status']).toBe('QUEUED');
  });
});
