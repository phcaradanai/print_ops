import { describe, expect, it, afterEach } from 'vitest';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryCallbackDeliveryRepository } from '../infra/repos/in-memory-callback-delivery.repo.js';
import {
  ResultCallbackDispatcher,
  callbackNatsModeFromEnv,
  type CallbackNatsSender,
} from '../services/result-callback-dispatcher.js';
import { NatsNoStreamError } from '../infra/nats/nats-connection-manager.js';
import { resolveEndpointCallbackIntent } from '../services/callback-intent.service.js';
import type { WebhookEndpoint, WebhookEndpointRepositoryPort } from '@printerops/domain';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function endpointRepoWith(endpoint: Partial<WebhookEndpoint>): WebhookEndpointRepositoryPort {
  const full = {
    id: 'ep-1',
    endpointCode: 'cb',
    name: 'Callback',
    sourceSystem: 'medisync',
    authMode: 'NONE',
    enabled: true,
    callbackTransport: 'NATS',
    callbackOnPrintResult: true,
    callbackNatsSubject: 'results.medisync',
    ...endpoint,
  } as WebhookEndpoint;
  return {
    findByCode: async (code: string) => (code === full.endpointCode ? full : undefined),
    findAll: async () => [full],
  } as unknown as WebhookEndpointRepositoryPort;
}

async function seedDelivery(
  deliveries: InMemoryCallbackDeliveryRepository,
  jobs: InMemoryJobRepository,
): Promise<string> {
  const job = await jobs.create({
    id: 'job-dedupe-1',
    traceId: 'trace-1',
    correlationId: 'corr-1',
    printerId: 'printer-1',
    createdBy: 'test',
    mimeType: 'text/plain',
    copies: 1,
    duplex: false,
    colorMode: 'auto',
    metadata: {},
  });
  const { delivery } = await deliveries.createIfAbsent({
    eventId: 'evt-dedupe-1',
    printJobId: job.id,
    transport: 'NATS',
    target: 'results.medisync',
    trigger: 'PRINT_RESULT',
    deliveryStatus: 'PENDING',
    maxAttempts: 5,
    printStatus: 'SUCCESS',
    payload: { event_id: 'evt-dedupe-1', status: 'SUCCESS' },
  });
  return delivery.id;
}

describe('NATS result callbacks over JetStream (N-1)', () => {
  afterEach(() => {
    delete process.env['PRINTOPS_CALLBACK_NATS_MODE'];
  });

  it('defaults to JETSTREAM and honours an explicit CORE opt-out', () => {
    expect(callbackNatsModeFromEnv({})).toBe('JETSTREAM');
    expect(callbackNatsModeFromEnv({ PRINTOPS_CALLBACK_NATS_MODE: 'CORE' })).toBe('CORE');
    expect(callbackNatsModeFromEnv({ PRINTOPS_CALLBACK_NATS_MODE: 'core' })).toBe('CORE');
    // Anything unrecognised keeps the safe, agreed default rather than guessing.
    expect(callbackNatsModeFromEnv({ PRINTOPS_CALLBACK_NATS_MODE: 'nonsense' })).toBe('JETSTREAM');
  });

  it('snapshots the mode onto the job intent at accept time', async () => {
    process.env['PRINTOPS_CALLBACK_NATS_MODE'] = 'CORE';
    const intent = await resolveEndpointCallbackIntent(
      endpointRepoWith({}),
      'cb',
      'medisync',
      {},
    );
    // The stored intent, not the live env var, decides how an in-flight
    // callback is delivered.
    expect(intent?.natsMode).toBe('CORE');
  });

  it('sends event_id as the dedupe key and records ACKNOWLEDGED on a PubAck', async () => {
    const jobs = new InMemoryJobRepository();
    const deliveries = new InMemoryCallbackDeliveryRepository();
    const calls: Array<{ msgId: string; mode: string }> = [];
    const nats: CallbackNatsSender = async (_subject, _body, opts) => {
      calls.push({ msgId: opts.msgId, mode: opts.mode });
      return { acknowledged: true, stream: 'RESULTS', sequence: 7 };
    };

    const dispatcher = new ResultCallbackDispatcher({ jobs, deliveries, nats, logger: silentLogger });
    const deliveryId = await seedDelivery(deliveries, jobs);
    const result = await dispatcher.attempt(deliveryId);

    expect(calls).toEqual([{ msgId: 'evt-dedupe-1', mode: 'JETSTREAM' }]);
    expect(result?.deliveryStatus).toBe('DELIVERED');
    expect(result?.guarantee).toBe('ACKNOWLEDGED');
  });

  it('retries a missing stream rather than silently downgrading to a Core publish', async () => {
    const jobs = new InMemoryJobRepository();
    const deliveries = new InMemoryCallbackDeliveryRepository();
    const nats: CallbackNatsSender = async () => {
      throw new NatsNoStreamError('results.medisync');
    };

    const dispatcher = new ResultCallbackDispatcher({ jobs, deliveries, nats, logger: silentLogger });
    const deliveryId = await seedDelivery(deliveries, jobs);
    const result = await dispatcher.attempt(deliveryId);

    // Retryable: the receiving side provisioning its stream is exactly the kind
    // of fix that happens without restarting PrintOps.
    expect(result?.deliveryStatus).toBe('RETRY_SCHEDULED');
    expect(result?.lastErrorCode).toBe('NATS_NO_STREAM');
    expect(result?.guarantee).not.toBe('ACKNOWLEDGED');
    expect(result?.lastErrorMessage).toContain('PRINTOPS_CALLBACK_NATS_MODE=CORE');
  });

  it('re-sends the SAME dedupe key on every retry', async () => {
    const jobs = new InMemoryJobRepository();
    const deliveries = new InMemoryCallbackDeliveryRepository();
    const msgIds: string[] = [];
    let failNext = true;
    const nats: CallbackNatsSender = async (_subject, _body, opts) => {
      msgIds.push(opts.msgId);
      if (failNext) {
        failNext = false;
        throw new Error('broker unavailable');
      }
      return { acknowledged: true };
    };

    const clock = { now: new Date('2026-08-03T00:00:00Z') };
    const dispatcher = new ResultCallbackDispatcher({
      jobs,
      deliveries,
      nats,
      logger: silentLogger,
      now: () => clock.now,
      random: () => 0.5,
    });
    const deliveryId = await seedDelivery(deliveries, jobs);

    await dispatcher.attempt(deliveryId);
    clock.now = new Date(clock.now.getTime() + 60_000);
    const recovered = await dispatcher.attempt(deliveryId);

    expect(msgIds).toEqual(['evt-dedupe-1', 'evt-dedupe-1']);
    expect(recovered?.deliveryStatus).toBe('DELIVERED');
    expect(recovered?.guarantee).toBe('ACKNOWLEDGED');
  });
});
