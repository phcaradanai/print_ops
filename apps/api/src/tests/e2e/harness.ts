/**
 * PrintOps end-to-end transport x callback harness.
 *
 * Self-contained: boots the real Fastify app in-process, a real NATS JetStream
 * consumer, a real HTTP webhook receiver and a real NATS callback subscriber,
 * drives the four transport/callback combinations, captures evidence, then
 * shuts everything down and exits. No long-running process is left behind.
 *
 * SAFETY: every job is routed to OFFICE_LASER_01, whose protocol is `fake`.
 * The seeded LAB_LABEL_01 is `windows_spooler` and points at a real EPSON
 * device -- it is deliberately never used here.
 *
 * Run:  npx tsx apps/api/src/tests/e2e/harness.ts
 * Needs a JetStream-enabled NATS on PRINTOPS_E2E_NATS_URL (default :14222).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { connect, type NatsConnection } from 'nats';

const NATS_URL = process.env['PRINTOPS_E2E_NATS_URL'] ?? 'nats://127.0.0.1:14222';
const CLIENT_ID = 'e2eclient';
const SUBJECT_PREFIX = 'medisync.print.intake';
const INTAKE_SUBJECT = `${SUBJECT_PREFIX}.${CLIENT_ID}`;
const CALLBACK_SUBJECT = 'e2e.callback.result';
const STREAM = 'E2ESTREAM';
const ARTIFACTS = resolve(process.cwd(), 'artifacts/e2e');

// buildApp reads all of these at import/boot time.
process.env['NODE_ENV'] = 'test';
process.env['DB_MODE'] = 'memory';
process.env['JWT_SECRET'] = 'e2e-harness-secret-not-a-real-credential';
process.env['PRINTOPS_LOCAL_WORKER'] = 'true';
process.env['PRINTOPS_NATS_URL'] = NATS_URL;
process.env['PRINTOPS_NATS_CLIENT_ID'] = CLIENT_ID;
process.env['PRINTOPS_NATS_SUBJECT_PREFIX'] = SUBJECT_PREFIX;
process.env['PRINTOPS_NATS_STREAM'] = STREAM;
process.env['PRINTOPS_NATS_DURABLE'] = `printops-e2e-${CLIENT_ID}`;

/* ------------------------------------------------------------------ */
/* evidence capture                                                    */
/* ------------------------------------------------------------------ */

interface WebhookCapture {
  at: string;
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  respondedStatus: number;
}
interface NatsCapture {
  at: string;
  subject: string;
  body: unknown;
}
const webhookCaptures: WebhookCapture[] = [];
const natsCaptures: NatsCapture[] = [];
const findings: Record<string, unknown>[] = [];

/** Next HTTP status the webhook receiver should answer with, for failure cells. */
let webhookReplyStatus = 200;

function record(entry: Record<string, unknown>): void {
  findings.push({ at: new Date().toISOString(), ...entry });
  console.log(`[cell] ${JSON.stringify(entry)}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Polls until `check` returns truthy or the budget expires. */
async function waitFor<T>(label: string, check: () => T | Promise<T>, ms = 8000): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) {
      console.warn(`[wait] timed out waiting for ${label}`);
      return undefined;
    }
    await sleep(120);
  }
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });

  // --- 1. webhook receiver -----------------------------------------
  const receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      try { body = JSON.parse(raw); } catch { /* keep raw */ }
      const status = webhookReplyStatus;
      webhookCaptures.push({
        at: new Date().toISOString(),
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
        respondedStatus: status,
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  const receiverPort = (receiver.address() as { port: number }).port;
  const WEBHOOK_URL = `http://127.0.0.1:${receiverPort}/callbacks/print`;
  console.log(`[setup] webhook receiver on ${WEBHOOK_URL}`);

  // --- 2. NATS: stream + callback subscriber ------------------------
  const nc: NatsConnection = await connect({ servers: NATS_URL, name: 'e2e-harness' });
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.add({ name: STREAM, subjects: [`${SUBJECT_PREFIX}.>`, 'medisync.dlq.>'] });
  } catch {
    await jsm.streams.update(STREAM, { subjects: [`${SUBJECT_PREFIX}.>`, 'medisync.dlq.>'] } as never);
  }
  console.log(`[setup] JetStream stream ${STREAM} ready`);

  const sub = nc.subscribe(`${CALLBACK_SUBJECT}.>`);
  void (async () => {
    for await (const m of sub) {
      let body: unknown;
      try { body = m.json(); } catch { body = m.string(); }
      natsCaptures.push({ at: new Date().toISOString(), subject: m.subject, body });
    }
  })();
  const dlqSub = nc.subscribe('medisync.dlq.>');
  const dlqCaptures: NatsCapture[] = [];
  void (async () => {
    for await (const m of dlqSub) {
      let body: unknown;
      try { body = m.json(); } catch { body = m.string(); }
      dlqCaptures.push({ at: new Date().toISOString(), subject: m.subject, body });
    }
  })();

  // --- 3. boot the real app ----------------------------------------
  const { buildApp } = await import('../../app.js');
  const built = await buildApp();
  const app = built.app;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  const BASE = `http://127.0.0.1:${addr.port}`;
  console.log(`[setup] API on ${BASE}`);
  // give the print-intake consumer time to attach to the stream
  await sleep(2500);

  const apiKey = built.DEV_API_KEY;

  const json = async (
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    let body: unknown;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };

  // --- 4. admin token + safe fake-printer route policy --------------
  // NOTE: authRoutes is registered on the UNPREFIXED plugin, so login is
  // /auth/login -- not /api/v1/auth/login like every other route.
  const login = await json('/auth/login', {
    method: 'POST',
    body: { email: 'admin@printerops.local', password: 'e2e-local-dev-password' },
  });
  const token = (login.body as { token?: string; accessToken?: string })?.token
    ?? (login.body as { accessToken?: string })?.accessToken;
  if (!token) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  const auth = { authorization: `Bearer ${token}` };

  // Route EVERYTHING at OFFICE_LASER_01 (protocol `fake`). Never LAB_LABEL_01.
  const policy = await json('/api/v1/webhook-route-policies', {
    method: 'POST',
    headers: auth,
    body: {
      policyCode: 'e2e-fake-static',
      name: 'E2E Fake Static',
      matchRules: { when: [{ field: 'type', op: 'eq', value: 'e2e_label' }] },
      printerMapping: { strategy: 'static', printer_code: 'OFFICE_LASER_01' },
      templateMapping: { strategy: 'static', template_code: 'TEST_LABEL' },
      payloadMapping: { label: '$.label', barcode: '$.barcode' },
      priorityMapping: { strategy: 'static', priority: 'normal' },
      enabled: true,
    },
  });
  const policyId = (policy.body as { id?: string })?.id;
  if (!policyId) throw new Error(`policy create failed: ${policy.status} ${JSON.stringify(policy.body)}`);

  const mkEndpoint = async (
    code: string,
    transport: 'HTTP' | 'NATS' | 'BOTH',
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await json('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: auth,
      body: {
        endpointCode: code,
        name: code,
        sourceSystem: `e2e-${code}`,
        authMode: 'NONE',
        enabled: true,
        routePolicyId: policyId,
        callbackTransport: transport,
        callbackUrl: WEBHOOK_URL,
        callbackNatsSubject: `${CALLBACK_SUBJECT}.${code}`,
        callbackOnPrintResult: true,
        ...extra,
      },
    });
    const id = (res.body as { id?: string })?.id;
    if (!id) throw new Error(`endpoint ${code} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return id;
  };

  const epHttp = await mkEndpoint('e2e-http', 'HTTP');
  const epNats = await mkEndpoint('e2e-nats', 'NATS');
  // Endpoints referenced by `endpoint_code` from the NATS envelope. Their
  // sourceSystem MUST equal the envelope's source_system — the ownership check
  // rejects anything else before printing.
  await mkEndpoint('e2e-natsin-http', 'HTTP', { sourceSystem: 'e2e-nats-intake' });
  await mkEndpoint('e2e-natsin-nats', 'NATS', {
    sourceSystem: 'e2e-nats-intake',
    callbackNatsSubject: `${CALLBACK_SUBJECT}.natsin`,
  });
  // Acceptance-only endpoint: proves the toggle works in BOTH directions.
  await mkEndpoint('e2e-accept-only', 'HTTP', { callbackOnPrintResult: false });
  console.log(`[setup] endpoints ready http=${epHttp} nats=${epNats}`);

  const deliveriesFor = async (jobId: string): Promise<Record<string, unknown>[]> => {
    const res = await json(`/api/v1/callback-deliveries?printJobId=${encodeURIComponent(jobId)}`, { headers: auth });
    return Array.isArray(res.body) ? (res.body as Record<string, unknown>[]) : [];
  };

  const stamp = Date.now();
  const jobState = async (requestId: string, sourceSystem: string): Promise<Record<string, unknown> | undefined> => {
    const res = await json(
      `/api/v1/print-jobs/by-request-id/${encodeURIComponent(requestId)}?source_system=${encodeURIComponent(sourceSystem)}`,
      { headers: { 'x-api-key': apiKey } },
    );
    return res.status === 200 ? (res.body as Record<string, unknown>) : undefined;
  };

  /** Waits for a job to leave the pre-terminal states. */
  const waitTerminal = async (requestId: string, sourceSystem: string): Promise<Record<string, unknown> | undefined> =>
    waitFor(`terminal ${requestId}`, async () => {
      const job = await jobState(requestId, sourceSystem);
      if (!job) return undefined;
      const status = String(job['status'] ?? '');
      return ['SUCCESS', 'FAILED', 'CANCELLED'].includes(status) ? job : undefined;
    }, 15000);

  /* ================================================================ */
  /* CELL 1 - API intake -> fake print -> HTTP webhook callback        */
  /* ================================================================ */
  {
    const requestId = `e2e-api-webhook-${stamp}`;
    const before = webhookCaptures.length;
    const res = await json('/api/v1/intake/e2e-http', {
      method: 'POST',
      body: { request_id: requestId, type: 'e2e_label', label: 'CELL1', barcode: '1111' },
    });
    const cb = await waitFor('cell1 webhook', () => webhookCaptures.length > before, 6000);
    const job = await waitTerminal(requestId, 'e2e-e2e-http');
    const payload = webhookCaptures[webhookCaptures.length - 1]?.body as Record<string, unknown> | undefined;
    record({
      cell: 'API->print->WEBHOOK', requestId,
      acceptStatus: res.status,
      acceptBody: res.body,
      callbackReceived: !!cb,
      callbackPayload: payload,
      callbackEventType: payload?.['event_type'],
      callbackPrintStatus: payload?.['print_status'],
      finalJobStatus: job?.['status'],
      // The core assertion: the callback reports the TERMINAL status, not the
      // QUEUED acceptance status it used to carry.
      reportsTerminalStatus: payload?.['print_status'] === job?.['status'],
      deliveries: job?.['id'] ? await deliveriesFor(String(job['id'])) : [],
    });
  }

  /* ================================================================ */
  /* CELL 2 - API intake -> fake print -> NATS callback                */
  /* ================================================================ */
  {
    const requestId = `e2e-api-nats-${stamp}`;
    const before = natsCaptures.length;
    const res = await json('/api/v1/intake/e2e-nats', {
      method: 'POST',
      body: { request_id: requestId, type: 'e2e_label', label: 'CELL2', barcode: '2222' },
    });
    const cb = await waitFor('cell2 nats callback', () => natsCaptures.length > before, 6000);
    const job = await waitTerminal(requestId, 'e2e-e2e-nats');
    const capture = natsCaptures[natsCaptures.length - 1];
    const payload = capture?.body as Record<string, unknown> | undefined;
    record({
      cell: 'API->print->NATS', requestId,
      acceptStatus: res.status,
      acceptBody: res.body,
      callbackReceived: !!cb,
      callbackPayload: capture,
      callbackPrintStatus: payload?.['print_status'],
      finalJobStatus: job?.['status'],
      reportsTerminalStatus: payload?.['print_status'] === job?.['status'],
      deliveries: job?.['id'] ? await deliveriesFor(String(job['id'])) : [],
    });
  }

  /* ================================================================ */
  /* CELL 3/4 - NATS intake -> fake print -> (webhook | NATS) callback */
  /* ================================================================ */
  const js = nc.jetstream();
  const publishIntake = async (requestId: string, label: string, endpointCode?: string): Promise<void> => {
    await js.publish(INTAKE_SUBJECT, JSON.stringify({
      target_client_id: CLIENT_ID,
      request_id: requestId,
      source_system: 'e2e-nats-intake',
      code_template: 'TEST_LABEL',
      code_profile: 'ignored-when-printer-code-set',
      printer_code: 'OFFICE_LASER_01',
      payload: { label, barcode: '3333', reply_to: `${CALLBACK_SUBJECT}.natsin` },
      copies: 1,
      priority: 'normal',
      // The backward-compatible extension: omitted by every pre-existing
      // publisher, and the only way a NATS-originated print can report a result.
      ...(endpointCode ? { endpoint_code: endpointCode } : {}),
    }));
  };

  {
    const requestId = `e2e-nats-webhook-${stamp}`;
    const wBefore = webhookCaptures.length;
    await publishIntake(requestId, 'CELL3', 'e2e-natsin-http');
    const job = await waitTerminal(requestId, 'e2e-nats-intake');
    await sleep(2500); // generous window for any late callback
    const newCaptures = webhookCaptures.slice(wBefore);
    record({
      cell: 'NATS->print->WEBHOOK', requestId,
      jobCreated: !!job,
      finalJobStatus: job?.['status'],
      webhookCallbacksSeen: newCaptures.length,
      callbackPayload: newCaptures[newCaptures.length - 1]?.body,
      deliveries: job?.['id'] ? await deliveriesFor(String(job['id'])) : [],
    });
  }

  {
    const requestId = `e2e-nats-nats-${stamp}`;
    const nBefore = natsCaptures.length;
    await publishIntake(requestId, 'CELL4', 'e2e-natsin-nats');
    const job = await waitTerminal(requestId, 'e2e-nats-intake');
    await sleep(2500);
    const newCaptures = natsCaptures.slice(nBefore);
    record({
      cell: 'NATS->print->NATS', requestId,
      jobCreated: !!job,
      finalJobStatus: job?.['status'],
      natsCallbacksSeen: newCaptures.length,
      callbackPayload: newCaptures[newCaptures.length - 1],
      deliveries: job?.['id'] ? await deliveriesFor(String(job['id'])) : [],
    });
  }

  /* --- NATS intake with NO endpoint_code: unchanged, no callback ---- */
  {
    const requestId = `e2e-nats-nocb-${stamp}`;
    const wBefore = webhookCaptures.length;
    const nBefore = natsCaptures.length;
    await publishIntake(requestId, 'NOCB');
    const job = await waitTerminal(requestId, 'e2e-nats-intake');
    await sleep(2000);
    record({
      cell: 'NATS->print->NO-CALLBACK (backward compatibility)', requestId,
      finalJobStatus: job?.['status'],
      webhookCallbacksSeen: webhookCaptures.length - wBefore,
      natsCallbacksSeen: natsCaptures.length - nBefore,
    });
  }

  /* --- NATS intake with an endpoint_code owned by another system ---- */
  {
    const requestId = `e2e-nats-badep-${stamp}`;
    const dlqBefore = dlqCaptures.length;
    // e2e-http belongs to source_system 'e2e-e2e-http', not 'e2e-nats-intake'.
    await publishIntake(requestId, 'BADEP', 'e2e-http');
    await sleep(2500);
    const job = await jobState(requestId, 'e2e-nats-intake');
    record({
      cell: 'NATS->REJECT (endpoint_code owned by another client)', requestId,
      jobCreated: !!job,
      dlqMessages: dlqCaptures.length - dlqBefore,
    });
  }

  /* ================================================================ */
  /* Callback timing: was the callback sent BEFORE the print finished? */
  /* ================================================================ */
  {
    const requestId = `e2e-timing-${stamp}`;
    const before = webhookCaptures.length;
    await json('/api/v1/intake/e2e-http', {
      method: 'POST',
      body: { request_id: requestId, type: 'e2e_label', label: 'TIMING', barcode: '9999' },
    });
    await waitFor('timing webhook', () => webhookCaptures.length > before, 6000);
    const cbPayload = webhookCaptures[webhookCaptures.length - 1]?.body as Record<string, unknown> | undefined;
    const job = await waitTerminal(requestId, 'e2e-e2e-http');
    record({
      cell: 'CALLBACK-TIMING', requestId,
      statusInCallbackPayload: cbPayload?.['print_status'],
      finalJobStatusAfterPrint: job?.['status'],
      callbackReportsTerminalState: cbPayload?.['print_status'] === job?.['status'],
    });
  }

  /* --- callbackOnPrintResult=false: acceptance only, no result --------- */
  {
    const requestId = `e2e-acceptonly-${stamp}`;
    const before = webhookCaptures.length;
    await json('/api/v1/intake/e2e-accept-only', {
      method: 'POST',
      body: { request_id: requestId, type: 'e2e_label', label: 'ACCEPTONLY', barcode: '8888' },
    });
    await waitFor('accept-only webhook', () => webhookCaptures.length > before, 6000);
    const acceptancePayload = webhookCaptures[webhookCaptures.length - 1]?.body as Record<string, unknown> | undefined;
    const job = await waitTerminal(requestId, 'e2e-e2e-accept-only');
    await sleep(2000);
    record({
      cell: 'CALLBACK-DISABLED (acceptance only)', requestId,
      callbacksSeen: webhookCaptures.length - before,
      acceptanceEventType: acceptancePayload?.['event_type'],
      acceptanceStatus: acceptancePayload?.['status'],
      finalJobStatus: job?.['status'],
      // Exactly one callback, and it is explicitly labelled as acceptance.
      resultCallbackSuppressed: webhookCaptures.length - before === 1,
      deliveries: job?.['id'] ? await deliveriesFor(String(job['id'])) : [],
    });
  }

  /* ================================================================ */
  /* Idempotency: same request_id twice, and across transports         */
  /* ================================================================ */
  {
    const requestId = `e2e-dupe-http-${stamp}`;
    const first = await json('/api/v1/intake/e2e-http', {
      method: 'POST', body: { request_id: requestId, type: 'e2e_label', label: 'D1', barcode: '4444' },
    });
    await sleep(400);
    const second = await json('/api/v1/intake/e2e-http', {
      method: 'POST', body: { request_id: requestId, type: 'e2e_label', label: 'D1', barcode: '4444' },
    });
    record({
      cell: 'IDEMPOTENCY-http-twice', requestId,
      firstStatus: first.status, firstBody: first.body,
      secondStatus: second.status, secondBody: second.body,
      sameJobId: (first.body as Record<string, unknown>)?.['print_job_id']
        === (second.body as Record<string, unknown>)?.['print_job_id'],
    });
  }
  {
    // Same request_id via the NATS transport twice.
    const requestId = `e2e-dupe-nats-${stamp}`;
    await publishIntake(requestId, 'D2');
    await sleep(1500);
    await publishIntake(requestId, 'D2');
    await sleep(2000);
    const all = await json(`/api/v1/print-jobs?limit=200`, { headers: { 'x-api-key': apiKey } });
    const items = Array.isArray(all.body) ? all.body : ((all.body as { items?: unknown[] })?.items ?? []);
    const matching = (items as Record<string, unknown>[]).filter((j) => j['requestId'] === requestId);
    record({
      cell: 'IDEMPOTENCY-nats-twice', requestId,
      jobsCreated: matching.length,
      statuses: matching.map((j) => j['status']),
    });
  }
  {
    // Cross-transport: NATS intake then the dedicated API print path, same id.
    const requestId = `e2e-dupe-cross-${stamp}`;
    await publishIntake(requestId, 'D3');
    await sleep(1500);
    const viaApi = await json('/api/v1/print-jobs', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: {
        request_id: requestId,
        source_system: 'e2e-nats-intake',
        printer_code: 'OFFICE_LASER_01',
        template_code: 'TEST_LABEL',
        payload: { label: 'D3', barcode: '5555' },
        copies: 1,
      },
    });
    record({
      cell: 'IDEMPOTENCY-cross-transport', requestId,
      apiStatus: viaApi.status,
      apiBody: viaApi.body,
    });
  }

  /* ================================================================ */
  /* Negative cases                                                    */
  /* ================================================================ */
  {
    const cases: { name: string; path: string; headers?: Record<string, string>; body: unknown }[] = [
      { name: 'missing request_id', path: '/api/v1/intake/e2e-http', body: { type: 'e2e_label', label: 'X' } },
      { name: 'unknown endpoint code', path: '/api/v1/intake/does-not-exist', body: { request_id: `n1-${stamp}`, type: 'e2e_label' } },
      { name: 'no route match', path: '/api/v1/intake/e2e-http', body: { request_id: `n2-${stamp}`, type: 'not_matching' } },
      { name: 'print-jobs unauthenticated', path: '/api/v1/print-jobs', body: { request_id: `n3-${stamp}`, source_system: 's', printer_code: 'OFFICE_LASER_01', template_code: 'TEST_LABEL', payload: {} } },
      { name: 'print-jobs bad api key', path: '/api/v1/print-jobs', headers: { 'x-api-key': 'wrong-key' }, body: { request_id: `n4-${stamp}`, source_system: 's', printer_code: 'OFFICE_LASER_01', template_code: 'TEST_LABEL', payload: {} } },
      { name: 'unknown printer', path: '/api/v1/print-jobs', headers: { 'x-api-key': apiKey }, body: { request_id: `n5-${stamp}`, source_system: 'e2e', printer_code: 'NO_SUCH_PRINTER', template_code: 'TEST_LABEL', payload: {} } },
      { name: 'unknown template', path: '/api/v1/print-jobs', headers: { 'x-api-key': apiKey }, body: { request_id: `n6-${stamp}`, source_system: 'e2e', printer_code: 'OFFICE_LASER_01', template_code: 'NO_SUCH_TEMPLATE', payload: {} } },
      { name: 'negative copies', path: '/api/v1/print-jobs', headers: { 'x-api-key': apiKey }, body: { request_id: `n7-${stamp}`, source_system: 'e2e', printer_code: 'OFFICE_LASER_01', template_code: 'TEST_LABEL', payload: {}, copies: -5 } },
      { name: 'oversized payload', path: '/api/v1/intake/e2e-http', body: { request_id: `n8-${stamp}`, type: 'e2e_label', blob: 'x'.repeat(70000) } },
    ];
    for (const c of cases) {
      const res = await json(c.path, { method: 'POST', headers: c.headers, body: c.body });
      record({ cell: 'NEGATIVE', name: c.name, status: res.status, body: res.body });
    }
  }

  /* --- NATS negative: bad target_client_id should dead-letter ------- */
  {
    const dlqBefore = dlqCaptures.length;
    await js.publish(INTAKE_SUBJECT, JSON.stringify({
      target_client_id: 'someone-else',
      request_id: `n9-${stamp}`,
      source_system: 'e2e',
      printer_code: 'OFFICE_LASER_01',
      code_template: 'TEST_LABEL',
      code_profile: 'x',
      payload: {},
    }));
    await sleep(2000);
    record({ cell: 'NEGATIVE-nats', name: 'wrong target_client_id', dlqMessages: dlqCaptures.length - dlqBefore });
  }
  {
    const dlqBefore = dlqCaptures.length;
    await js.publish(INTAKE_SUBJECT, 'this is not json');
    await sleep(2000);
    record({ cell: 'NEGATIVE-nats', name: 'malformed json', dlqMessages: dlqCaptures.length - dlqBefore });
  }

  /* --- Webhook receiver returning 500 ------------------------------ */
  {
    webhookReplyStatus = 500;
    const requestId = `e2e-cb500-${stamp}`;
    const before = webhookCaptures.length;
    await json('/api/v1/intake/e2e-http', {
      method: 'POST', body: { request_id: requestId, type: 'e2e_label', label: 'CB500', barcode: '6666' },
    });
    await waitFor('cb500', () => webhookCaptures.length > before, 6000);
    const job = await waitTerminal(requestId, 'e2e-e2e-http');
    // The first backoff is ~5s (±20% jitter); wait past it so the retry sweep
    // has had a real chance to fire a second attempt.
    await sleep(9000);
    const attempts = webhookCaptures.length - before;
    webhookReplyStatus = 200;
    const deliveries = job?.['id'] ? await deliveriesFor(String(job['id'])) : [];
    const log = await json(
      `/api/v1/webhook-endpoints/callback-log?limit=50&printJobId=${encodeURIComponent(String(job?.['id'] ?? ''))}`,
      { headers: auth },
    );
    record({
      cell: 'CALLBACK-FAILURE-500', requestId,
      finalJobStatus: job?.['status'],
      deliveryAttemptsObserved: attempts,
      retried: attempts > 1,
      // The point of the whole exercise: print SUCCESS, delivery NOT delivered.
      deliveries,
      attemptLogFilteredByJob: log.body,
    });

    // Let the retry sweep deliver it now that the receiver answers 200 again.
    // The SECOND backoff is ~30s (±20%) plus up to one 5s sweep interval, so
    // anything shorter than this proves nothing.
    await sleep(45000);
    record({
      cell: 'CALLBACK-RECOVERY-AFTER-500', requestId,
      deliveries: job?.['id'] ? await deliveriesFor(String(job['id'])) : [],
      totalWebhookAttempts: webhookCaptures.length - before,
    });
  }

  /* --- Trace + audit completeness for a good job -------------------- */
  {
    const requestId = `e2e-trace-${stamp}`;
    const res = await json('/api/v1/intake/e2e-http', {
      method: 'POST', body: { request_id: requestId, type: 'e2e_label', label: 'TRACE', barcode: '7777' },
    });
    const jobId = (res.body as { print_job_id?: string })?.print_job_id;
    await waitTerminal(requestId, 'e2e-e2e-http');
    const trace = await json(`/api/v1/print-jobs/${jobId}/trace`, { headers: { 'x-api-key': apiKey } });
    const job = await jobState(requestId, 'e2e-e2e-http');
    record({
      cell: 'TRACE-AUDIT', requestId, jobId,
      finalStatus: job?.['status'],
      traceStatus: trace.status,
      traceSteps: (trace.body as { steps?: { stepName?: string; status?: string }[] })?.steps?.map((s) => `${s.stepName}:${s.status}`),
    });
  }

  /* ================================================================ */
  /* teardown + artifacts                                              */
  /* ================================================================ */
  const report = {
    generatedAt: new Date().toISOString(),
    natsUrl: NATS_URL,
    intakeSubject: INTAKE_SUBJECT,
    callbackSubject: `${CALLBACK_SUBJECT}.>`,
    printerUsed: 'OFFICE_LASER_01 (protocol=fake)',
    findings,
    webhookCaptures,
    natsCaptures,
    dlqCaptures,
  };
  writeFileSync(resolve(ARTIFACTS, 'e2e-report.json'), JSON.stringify(report, null, 2));
  console.log(`\n[done] wrote ${resolve(ARTIFACTS, 'e2e-report.json')}`);
  console.log(`[done] webhook captures=${webhookCaptures.length} nats captures=${natsCaptures.length} dlq=${dlqCaptures.length}`);

  await app.close();
  receiver.close();
  await nc.drain().catch(() => {});
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[harness] FAILED', err);
  process.exit(1);
});
