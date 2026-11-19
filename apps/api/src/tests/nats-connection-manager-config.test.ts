/**
 * Runtime reconfiguration of the NATS intake connection.
 *
 * The server build applies operator-saved settings without restarting the API
 * process, so `applyConfig()` must replace a LIVE connection: drain the old
 * socket and consume loop, open the new one, and never leave the previous
 * connection orphaned or the retry backoff blocking the request.
 *
 * `nats` is mocked: these tests are about lifecycle bookkeeping, not a broker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NatsConnection } from 'nats';
import type { PrintIntakeConfig } from '../infra/nats/print-intake.js';
import { NatsConnectionManager } from '../infra/nats/nats-connection-manager.js';

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock('nats', () => ({
  connect: connectMock,
  AckPolicy: { Explicit: 'explicit' },
  DeliverPolicy: { All: 'all' },
  ReplayPolicy: { Instant: 'instant' },
  nanos: (ms: number) => ms * 1_000_000,
}));

function config(clientId: string, url = 'nats://broker.example:4222'): PrintIntakeConfig {
  return {
    url,
    stream: 'MEDISYNC',
    clientId,
    subject: `medisync.print.intake.${clientId}`,
    durable: `printops-print-intake-${clientId}`,
    dlqPrefix: 'medisync.dlq.',
    maxDeliver: 5,
  };
}

/** A fake broker connection that reports "closed" once it is drained. */
function fakeConnection(cfg: PrintIntakeConfig) {
  let markClosed!: () => void;
  const closed = new Promise<void>((resolve) => { markClosed = resolve; });
  const consumeClose = vi.fn(async () => undefined);
  const messages = {
    close: consumeClose,
    // Never yields a message: the consumer stays parked until close()/drain().
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
  };
  const consumer = { consume: vi.fn(async () => messages) };
  const jsm = {
    consumers: {
      info: vi.fn(async () => ({
        config: {
          durable_name: cfg.durable,
          filter_subject: cfg.subject,
          ack_policy: 'explicit',
          deliver_policy: 'all',
          replay_policy: 'instant',
          max_deliver: cfg.maxDeliver,
          ack_wait: 30_000_000_000,
          deliver_subject: '',
          deliver_group: '',
        },
      })),
      add: vi.fn(),
      update: vi.fn(),
    },
    jetstream: () => ({ consumers: { get: vi.fn(async () => consumer) } }),
  };
  const drain = vi.fn(async () => { markClosed(); });
  const nc = {
    isClosed: () => false,
    drain,
    closed: () => closed,
    publish: vi.fn(),
    jetstreamManager: async () => jsm,
    jetstream: () => ({ consumers: { get: vi.fn(async () => consumer) }, publish: vi.fn() }),
  } as unknown as NatsConnection;
  return { nc, drain, consumeClose };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function manager(cfg: PrintIntakeConfig | undefined): NatsConnectionManager {
  return new NatsConnectionManager(cfg, {
    dynamicPrint: {} as never,
    logger,
  });
}

/** Polls a predicate; the manager only advances through microtasks/promises. */
async function until(predicate: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const running: NatsConnectionManager[] = [];
function track(m: NatsConnectionManager): NatsConnectionManager {
  running.push(m);
  return m;
}

afterEach(async () => {
  connectMock.mockReset();
  for (const m of running.splice(0)) await m.stop();
});

describe('NATS connection manager runtime reconfiguration', () => {
  it('drains the live connection and reconnects on a new configuration', async () => {
    const first = fakeConnection(config('station-a'));
    const second = fakeConnection(config('station-b'));
    connectMock.mockResolvedValueOnce(first.nc).mockResolvedValueOnce(second.nc);

    const m = track(manager(config('station-a')));
    m.start();
    m.start(); // idempotent: a second start must not open a second connection
    await until(() => m.getStatus().intakeReady, 'station-a intake ready');
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(m.getStatus()).toMatchObject({ enabled: true, connected: true, clientId: 'station-a' });

    const status = await m.applyConfig(config('station-b'));

    // The old socket is drained exactly once, before the new one is opened.
    expect(first.drain).toHaveBeenCalledTimes(1);
    expect(first.consumeClose).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      enabled: true,
      clientId: 'station-b',
      subject: 'medisync.print.intake.station-b',
      server: 'nats://broker.example:4222',
    });

    await until(() => m.getStatus().intakeReady && m.getStatus().clientId === 'station-b', 'station-b intake ready');
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(m.getStatus().setupGeneration).toBe(2);

    await m.stop();
    await m.stop(); // idempotent stop: no second drain, no throw
    expect(second.drain).toHaveBeenCalledTimes(1);
    expect(m.getStatus()).toMatchObject({ enabled: true, connected: false, state: 'CONFIGURED' });
    expect(connectMock).toHaveBeenCalledTimes(2);
  });

  it('stops intake and reports DISABLED when the new configuration is disabled', async () => {
    const first = fakeConnection(config('station-a'));
    connectMock.mockResolvedValueOnce(first.nc);

    const m = track(manager(config('station-a')));
    m.start();
    await until(() => m.getStatus().intakeReady, 'intake ready');

    const status = await m.applyConfig(undefined);

    expect(status.enabled).toBe(false);
    expect(status.state).toBe('DISABLED');
    expect(status.connected).toBe(false);
    expect(first.drain).toHaveBeenCalledTimes(1);
    // Disabled means no reconnect loop is left running.
    connectMock.mockResolvedValueOnce(fakeConnection(config('station-a')).nc);
    await m.applyConfig(undefined);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('restarts a disabled manager when settings are enabled again', async () => {
    const later = fakeConnection(config('station-c'));
    connectMock.mockResolvedValueOnce(later.nc);

    const m = track(manager(undefined));
    expect(m.getStatus()).toMatchObject({ enabled: false, state: 'DISABLED' });

    const status = await m.applyConfig(config('station-c'));

    expect(status).toMatchObject({ enabled: true, clientId: 'station-c' });
    await until(() => m.getStatus().intakeReady, 'intake ready after enable');
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('interrupts the reconnect backoff instead of blocking a save or a shutdown', async () => {
    connectMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1'));

    const m = track(manager(config('station-a', 'nats://127.0.0.1:1')));
    m.start();
    // The first retry sleeps 500ms + up to 250ms of jitter before trying again.
    await until(() => m.getStatus().nextRetryAt !== undefined, 'retry backoff scheduled');

    const started = Date.now();
    await m.stop();
    expect(Date.now() - started).toBeLessThan(400);
    expect(m.getStatus()).toMatchObject({ state: 'CONFIGURED', connected: false });
    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
