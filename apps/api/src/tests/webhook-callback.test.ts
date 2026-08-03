import { describe, it, expect } from 'vitest';
import {
  WebhookCallbackService,
  type HttpClient,
  type NatsPublisher,
  type WebhookCallbackLogger,
} from '../services/webhook-callback.service.js';
import type { WebhookEndpoint } from '@printerops/domain';

const logger: WebhookCallbackLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function endpoint(over: Partial<WebhookEndpoint>): WebhookEndpoint {
  return {
    id: 'ep-1', endpointCode: 'dev-intake', name: 'Dev', sourceSystem: 'sys',
    authMode: 'NONE', enabled: true, routePolicyId: 'rp-1',
    callbackTransport: 'NONE', callbackOnPrintResult: false, ...over,
  } as WebhookEndpoint;
}

const ACCEPTED = { request_id: 'REQ-1', print_job_id: 'J1', status: 'QUEUED', trace_id: 'T1', duplicate: false } as Record<string, unknown>;

describe('WebhookCallbackService', () => {
  it('does nothing when transport is NONE', async () => {
    const calls: string[] = [];
    const svc = new WebhookCallbackService(logger, async () => { calls.push('http'); }, () => { calls.push('nats'); });
    await svc.send({ endpoint: endpoint({ callbackTransport: 'NONE' }), intakePayload: {}, result: {} });
    expect(calls).toHaveLength(0);
  });

  it('POSTs a default envelope to a literal HTTP URL', async () => {
    const http: HttpClient = async (url, body) => {
      expect(url).toBe('https://hook.example/cb');
      expect((body as Record<string, unknown>)['request_id']).toBe('REQ-1');
    };
    const svc = new WebhookCallbackService(logger, http, () => { throw new Error('nats must not be used'); });
    await svc.send({
      endpoint: endpoint({ callbackTransport: 'HTTP', callbackUrl: 'https://hook.example/cb' }),
      intakePayload: { request_id: 'REQ-1' },
      result: ACCEPTED,
    });
  });

  it('resolves a dynamic HTTP URL from a $.field path in the payload', async () => {
    let seen = '';
    const svc = new WebhookCallbackService(logger, async (url) => { seen = url; }, () => {});
    await svc.send({
      endpoint: endpoint({ callbackTransport: 'HTTP', callbackUrl: '$.reply_url' }),
      intakePayload: { reply_url: 'https://dyn/cb', request_id: 'R' },
      result: ACCEPTED,
    });
    expect(seen).toBe('https://dyn/cb');
  });

  it('renders the payload template and resolves $.field references', async () => {
    let body: Record<string, unknown> = {};
    const svc = new WebhookCallbackService(logger, async (_u, b) => { body = b as Record<string, unknown>; }, () => {});
    await svc.send({
      endpoint: endpoint({
        callbackTransport: 'HTTP',
        callbackUrl: 'https://h/cb',
        callbackPayloadTemplate: { event: 'print_accepted', hn: '$.hn', id: '$.request_id' },
      }),
      intakePayload: { hn: 'HN123', request_id: 'REQ-9' },
      result: ACCEPTED,
    });
    expect(body['event']).toBe('print_accepted');
    expect(body['hn']).toBe('HN123');
    expect(body['id']).toBe('REQ-9');
  });

  it('interpolates a $.field token inside a templated NATS subject', async () => {
    const published: Array<[string, unknown]> = [];
    const nats: NatsPublisher = (subject, payload) => { published.push([subject, payload]); };
    const svc = new WebhookCallbackService(logger, async () => {}, nats);
    await svc.send({
      endpoint: endpoint({
        callbackTransport: 'NATS',
        callbackNatsSubject: 'medisync.reply.$.branch',
      }),
      intakePayload: { branch: 'b1', request_id: 'R' },
      result: ACCEPTED,
    });
    expect(published[0]?.[0]).toBe('medisync.reply.b1');
  });

  it('resolves a $$.field token from the intake response', async () => {
    let body: Record<string, unknown> = {};
    const svc = new WebhookCallbackService(logger, async (_u, b) => { body = b as Record<string, unknown>; }, () => {});
    await svc.send({
      endpoint: endpoint({
        callbackTransport: 'HTTP',
        callbackUrl: 'https://h/cb',
        callbackPayloadTemplate: { job: '$$.print_job_id', state: '$$.status', dup: '$$.duplicate' },
      }),
      intakePayload: {},
      result: ACCEPTED,
    });
    expect(body['job']).toBe('J1');
    expect(body['state']).toBe('QUEUED');
    expect(body['dup']).toBe(false);
  });

  it('keeps $.field resolving from the intake payload even when the name collides with a system field', async () => {
    // The compatibility case the `$$.` sigil exists for: this endpoint was
    // saved when `$.status` could only mean "what the caller sent". It must
    // keep meaning that.
    let body: Record<string, unknown> = {};
    const svc = new WebhookCallbackService(logger, async (_u, b) => { body = b as Record<string, unknown>; }, () => {});
    await svc.send({
      endpoint: endpoint({
        callbackTransport: 'HTTP',
        callbackUrl: 'https://h/cb',
        callbackPayloadTemplate: { status: '$.status', request_id: '$.request_id' },
      }),
      intakePayload: { status: 'CALLER_SENT_THIS', request_id: 'CALLER-REQ' },
      result: ACCEPTED,
    });
    expect(body['status']).toBe('CALLER_SENT_THIS');
    expect(body['request_id']).toBe('CALLER-REQ');
  });

  it('leaves $.payload.* and $.result.* pointing at the intake payload', async () => {
    // Why `$$.` won a separate sigil rather than a `$.result.` namespace:
    // both of these already resolve for real callers today.
    let body: Record<string, unknown> = {};
    const svc = new WebhookCallbackService(logger, async (_u, b) => { body = b as Record<string, unknown>; }, () => {});
    await svc.send({
      endpoint: endpoint({
        callbackTransport: 'HTTP',
        callbackUrl: 'https://h/cb',
        callbackPayloadTemplate: { label: '$.payload.label', outcome: '$.result.status' },
      }),
      intakePayload: { payload: { label: 'L-1' }, result: { status: 'CALLER_OWNED' } },
      result: ACCEPTED,
    });
    expect(body['label']).toBe('L-1');
    expect(body['outcome']).toBe('CALLER_OWNED');
  });

  it('mixes system fields, intake fields and literals in one template', async () => {
    let body: Record<string, unknown> = {};
    const svc = new WebhookCallbackService(logger, async (_u, b) => { body = b as Record<string, unknown>; }, () => {});
    await svc.send({
      endpoint: endpoint({
        callbackTransport: 'HTTP',
        callbackUrl: 'https://h/cb',
        callbackPayloadTemplate: {
          event_type: 'print.job.accepted',
          request_id: '$$.request_id',
          print_job_id: '$$.print_job_id',
          hn: '$.hn',
          retries: 0,
        },
      }),
      intakePayload: { hn: 'HN123' },
      result: ACCEPTED,
    });
    expect(body).toEqual({
      event_type: 'print.job.accepted',
      request_id: 'REQ-1',
      print_job_id: 'J1',
      hn: 'HN123',
      retries: 0,
    });
  });

  it('resolves an unknown $$.field to undefined rather than the literal token', async () => {
    let body: Record<string, unknown> = {};
    const svc = new WebhookCallbackService(logger, async (_u, b) => { body = b as Record<string, unknown>; }, () => {});
    await svc.send({
      endpoint: endpoint({
        callbackTransport: 'HTTP',
        callbackUrl: 'https://h/cb',
        callbackPayloadTemplate: { nope: '$$.not_a_system_field' },
      }),
      intakePayload: {},
      result: ACCEPTED,
    });
    expect(body['nope']).toBeUndefined();
  });

  it('fans out to BOTH transports', async () => {
    const seen: string[] = [];
    const http: HttpClient = async () => { seen.push('http'); };
    const nats: NatsPublisher = () => { seen.push('nats'); };
    const svc = new WebhookCallbackService(logger, http, nats);
    await svc.send({
      endpoint: endpoint({
        callbackTransport: 'BOTH',
        callbackUrl: 'https://h/cb',
        callbackNatsSubject: 's.reply',
      }),
      intakePayload: { request_id: 'R' },
      result: ACCEPTED,
    });
    expect(seen.sort()).toEqual(['http', 'nats']);
  });
});
