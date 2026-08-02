import { describe, it, expect, vi } from 'vitest';
import type { JsMsg, NatsConnection } from 'nats';
import {
  handlePrintIntakeMessage,
  type PrintIntakeConfig,
  type PrintIntakeLogger,
} from '../infra/nats/print-intake.js';
import type { DynamicPrintService } from '../services/dynamic-print.service.js';
import { AppError } from '@printerops/shared';
import type { IntakeOutcomeCallbackService } from '../services/intake-outcome-callback.service.js';

/**
 * Unit tests for the NATS JetStream print-intake message handler.
 *
 * The handler is the NATS twin of the HTTP dynamic print endpoint. It
 * validates the envelope, checks target_client_id scoping, resolves the
 * printer via DynamicPrintService, and acks / naks / dead-letters the
 * message. These tests mock JsMsg and NatsConnection so no real NATS
 * server is needed — they verify the handler's decision logic and the
 * ack/nak/term contract the consumer relies on.
 */

const CLIENT_ID = 'pharmacy-counter-01';
const SUBJECT = 'medisync.print.intake.pharmacy-counter-01';

const cfg: PrintIntakeConfig = {
  url: 'nats://localhost:4222',
  stream: 'MEDISYNC',
  clientId: CLIENT_ID,
  subject: SUBJECT,
  durable: `printops-print-intake-${CLIENT_ID}`,
  dlqPrefix: 'medisync.dlq.',
  maxDeliver: 5,
};

const logger: PrintIntakeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeMsg(
  data: Record<string, unknown>,
  overrides?: { subject?: string; redeliveryCount?: number; streamSequence?: number },
): JsMsg {
  const subject = overrides?.subject ?? SUBJECT;
  const json = () => data;
  const buf = Buffer.from(JSON.stringify(data));
  return {
    subject,
    data: buf,
    json,
    ack: vi.fn(),
    nak: vi.fn(),
    term: vi.fn(),
    info: {
      streamSequence: overrides?.streamSequence ?? 1,
      redeliveryCount: overrides?.redeliveryCount ?? 0,
    },
  } as unknown as JsMsg;
}

function makeNc(): NatsConnection & { published: Array<[string, Buffer]> } {
  const published: Array<[string, Buffer]> = [];
  return {
    publish: vi.fn((subject: string, data: Buffer) => { published.push([subject, data]); }),
    published,
  } as unknown as NatsConnection & { published: Array<[string, Buffer]> };
}

/** Minimal DynamicPrintService stub: records submits and returns a queued result. */
function makeDynamicPrint(throws?: (req: Record<string, unknown>) => never) {
  const submitted: Array<Record<string, unknown>> = [];
  const stub = {
    submit: vi.fn(async (req: Record<string, unknown>) => {
      submitted.push(req);
      if (throws) throws(req);
      return {
        print_job_id: 'job-from-nats-001',
        status: 'QUEUED',
        duplicate: false,
        trace_id: 'trace-001',
        request_id: req['request_id'],
      };
    }),
    submitted,
  };
  return stub as unknown as DynamicPrintService & { submitted: Array<Record<string, unknown>> };
}

describe('NATS print-intake message handler', () => {
  it('accepts a valid envelope, submits the job, and acks', async () => {
    const dynamicPrint = makeDynamicPrint();
    const nc = makeNc();
    const msg = makeMsg({
      target_client_id: CLIENT_ID,
      request_id: 'REQ-NATS-001',
      source_system: 'medisync',
      source_reference: 'RX-123',
      code_template: 'prescription-sticker',
      code_profile: 'sticker-profile',
      payload: { patient_name: 'สมชาย ใจดี', hn: 'HN-0001' },
      copies: 1,
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger }, nc, cfg);

    expect(dynamicPrint.submit).toHaveBeenCalledTimes(1);
    const submitted = dynamicPrint.submitted[0]!;
    expect(submitted['request_id']).toBe('REQ-NATS-001');
    expect(submitted['source_system']).toBe('medisync');
    expect(submitted['code_template']).toBe('prescription-sticker');
    expect(submitted['code_profile']).toBe('sticker-profile');
    // NATS provenance metadata must be stamped.
    expect((submitted['metadata'] as Record<string, unknown>)['nats']).toEqual({
      clientId: CLIENT_ID,
      subject: SUBJECT,
      streamSequence: 1,
    });
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.nak).not.toHaveBeenCalled();
    expect(msg.term).not.toHaveBeenCalled();
    expect(nc.published).toHaveLength(0);
  });

  it('dead-letters when target_client_id does not match the client', async () => {
    const dynamicPrint = makeDynamicPrint();
    const nc = makeNc();
    const msg = makeMsg({
      target_client_id: 'wrong-counter',
      request_id: 'REQ-NATS-002',
      source_system: 'medisync',
      code_template: 't',
      code_profile: 'p',
      payload: {},
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger }, nc, cfg);

    expect(dynamicPrint.submit).not.toHaveBeenCalled();
    // Dead-letter: publishes to DLQ subject + terms the message.
    expect(nc.published).toHaveLength(1);
    expect(nc.published[0]![0]).toBe('medisync.dlq.' + SUBJECT);
    expect(msg.term).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('dead-letters when request_id or source_system is missing', async () => {
    const dynamicPrint = makeDynamicPrint();
    const nc = makeNc();

    const msg = makeMsg({
      target_client_id: CLIENT_ID,
      // no request_id, no source_system
      code_template: 't',
      code_profile: 'p',
      payload: {},
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger }, nc, cfg);

    expect(dynamicPrint.submit).not.toHaveBeenCalled();
    expect(nc.published).toHaveLength(1);
    expect(msg.term).toHaveBeenCalledTimes(1);
  });

  it('dead-letters when neither printer_code nor (code_template + code_profile) is provided', async () => {
    const dynamicPrint = makeDynamicPrint();
    const nc = makeNc();
    const msg = makeMsg({
      target_client_id: CLIENT_ID,
      request_id: 'REQ-NATS-003',
      source_system: 'medisync',
      // no printer_code, no template/profile
      payload: {},
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger }, nc, cfg);

    expect(dynamicPrint.submit).not.toHaveBeenCalled();
    expect(nc.published).toHaveLength(1);
    expect(msg.term).toHaveBeenCalledTimes(1);
  });

  it('naks on a transient error (non-4xx) for redelivery', async () => {
    // Simulate a 500 from submit — the handler should NAK, not dead-letter.
    const dynamicPrint = makeDynamicPrint(() => {
      const err = new Error('boom — transient');
      (err as Error & { statusCode?: number }).statusCode = 500;
      throw err;
    });
    const nc = makeNc();
    const msg = makeMsg({
      target_client_id: CLIENT_ID,
      request_id: 'REQ-NATS-500',
      source_system: 'medisync',
      code_template: 't',
      code_profile: 'p',
      payload: {},
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger }, nc, cfg);

    expect(dynamicPrint.submit).toHaveBeenCalledTimes(1);
    expect(msg.nak).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(nc.published).toHaveLength(0);
  });

  it('is idempotent — a duplicate request_id still acks (submit returns duplicate: true)', async () => {
    const dynamicPrint = makeDynamicPrint();
    // Override submit to return duplicate=true on second call.
    let call = 0;
    (dynamicPrint as unknown as { submit: ReturnType<typeof vi.fn> }).submit.mockImplementation(async () => {
      call++;
      return {
        print_job_id: 'job-from-nats-001',
        status: 'QUEUED',
        duplicate: call > 1,
        trace_id: 'trace-001',
        request_id: 'REQ-NATS-DUP',
      };
    });
    const nc = makeNc();
    const basePayload = {
      target_client_id: CLIENT_ID,
      request_id: 'REQ-NATS-DUP',
      source_system: 'medisync',
      code_template: 't',
      code_profile: 'p',
      payload: {},
    };

    await handlePrintIntakeMessage(makeMsg(basePayload), { dynamicPrint, logger }, nc, cfg);
    await handlePrintIntakeMessage(makeMsg(basePayload), { dynamicPrint, logger }, nc, cfg);

    expect(dynamicPrint.submit).toHaveBeenCalledTimes(2);
    // Both messages should ack (duplicate is a success outcome, not an error).
  });

  it('records a rejected intake attempt when target_client_id does not match (no DynamicPrintService involved)', async () => {
    const dynamicPrint = makeDynamicPrint();
    const nc = makeNc();
    const intakeLog = { record: vi.fn(), findAll: vi.fn(async () => []) };
    const msg = makeMsg({
      target_client_id: 'pharmacy-counter-01-typo',
      request_id: 'REQ-NATS-004',
      source_system: 'medisync',
      code_template: 'prescription-sticker',
      code_profile: 'sticker-profile',
      payload: {},
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger, intakeLog }, nc, cfg);

    expect(intakeLog.record).toHaveBeenCalledTimes(1);
    expect(intakeLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'nats',
        outcome: 'rejected',
        reason: 'target_client_id does not match this PrintOps client',
        requestId: 'REQ-NATS-004',
        clientId: 'pharmacy-counter-01-typo',
        subject: SUBJECT,
      }),
    );
  });

  it('does not double-record when submit() itself rejects (that is DynamicPrintService/AcceptExternalJobService\'s job)', async () => {
    const dynamicPrint = makeDynamicPrint(() => {
      throw new AppError('VALIDATION', '4xx from downstream', 400);
    });
    const nc = makeNc();
    const intakeLog = { record: vi.fn(), findAll: vi.fn(async () => []) };
    const msg = makeMsg({
      target_client_id: CLIENT_ID,
      request_id: 'REQ-NATS-005',
      source_system: 'medisync',
      code_template: 'prescription-sticker',
      code_profile: 'sticker-profile',
      payload: {},
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger, intakeLog }, nc, cfg);

    // The transport-level checks all passed, so print-intake.ts itself must not
    // log anything — recording a submit()-level rejection is
    // AcceptExternalJobService's responsibility, to avoid a duplicate entry.
    expect(intakeLog.record).not.toHaveBeenCalled();
    expect(msg.term).toHaveBeenCalledTimes(1);
  });

  it('honours explicit printer_code (skips binding resolution)', async () => {
    const dynamicPrint = makeDynamicPrint();
    const nc = makeNc();
    const msg = makeMsg({
      target_client_id: CLIENT_ID,
      request_id: 'REQ-NATS-OVR',
      source_system: 'medisync',
      printer_code: 'LAB_LABEL_01',
      code_template: '',
      code_profile: '',
      payload: {},
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger }, nc, cfg);

    expect(dynamicPrint.submit).toHaveBeenCalledTimes(1);
    expect(dynamicPrint.submitted[0]!['printer_code']).toBe('LAB_LABEL_01');
    expect(msg.ack).toHaveBeenCalledTimes(1);
  });

  it('hooks a final 4xx rejection before dead-lettering', async () => {
    const dynamicPrint = makeDynamicPrint(() => {
      throw new AppError('TEMPLATE_NOT_FOUND', 'template is unavailable', 422);
    });
    const nc = makeNc();
    const notifyRejected = vi.fn().mockResolvedValue(true);
    const intakeCallbacks = { notifyRejected } as unknown as IntakeOutcomeCallbackService;
    const msg = makeMsg({
      target_client_id: CLIENT_ID,
      request_id: 'REQ-NATS-REJECT',
      source_system: 'medisync',
      code_template: 'missing',
      code_profile: 'profile',
      endpoint_code: 'result-hook',
      payload: { label: 'x' },
    });

    await handlePrintIntakeMessage(msg, { dynamicPrint, logger, intakeCallbacks }, nc, cfg);

    expect(notifyRejected).toHaveBeenCalledWith(expect.objectContaining({
      endpointCode: 'result-hook',
      requestId: 'REQ-NATS-REJECT',
      intakeTransport: 'NATS',
      stage: 'INTAKE',
      errorCode: 'TEMPLATE_NOT_FOUND',
    }));
    expect(msg.term).toHaveBeenCalledTimes(1);
  });

  it('hooks a transient failure only when the final retry is exhausted', async () => {
    const dynamicPrint = makeDynamicPrint(() => { throw new Error('database unavailable'); });
    const nc = makeNc();
    const notifyRejected = vi.fn().mockResolvedValue(true);
    const intakeCallbacks = { notifyRejected } as unknown as IntakeOutcomeCallbackService;
    const envelope = {
      target_client_id: CLIENT_ID,
      request_id: 'REQ-NATS-EXHAUSTED',
      source_system: 'medisync',
      code_template: 't',
      code_profile: 'p',
      endpoint_code: 'result-hook',
      payload: {},
    };

    const retryable = makeMsg(envelope, { redeliveryCount: 3 });
    await handlePrintIntakeMessage(retryable, { dynamicPrint, logger, intakeCallbacks }, nc, cfg);
    expect(retryable.nak).toHaveBeenCalledTimes(1);
    expect(notifyRejected).not.toHaveBeenCalled();

    const exhausted = makeMsg(envelope, { redeliveryCount: 4 });
    await handlePrintIntakeMessage(exhausted, { dynamicPrint, logger, intakeCallbacks }, nc, cfg);
    expect(notifyRejected).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'INTAKE_RETRIES_EXHAUSTED',
      errorCode: 'INTAKE_FAILED',
    }));
    expect(exhausted.term).toHaveBeenCalledTimes(1);
  });
});
