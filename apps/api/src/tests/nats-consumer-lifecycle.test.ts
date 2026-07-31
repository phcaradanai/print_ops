import { AckPolicy, DeliverPolicy, ReplayPolicy, nanos } from 'nats';
import { describe, expect, it, vi } from 'vitest';
import {
  ConsumerConfigConflictError,
  ensurePrintIntakeConsumer,
} from '../infra/nats/nats-connection-manager.js';
import type { PrintIntakeConfig } from '../infra/nats/print-intake.js';

const config: PrintIntakeConfig = {
  url: 'nats://broker.example:4222',
  stream: 'MEDISYNC',
  clientId: 'station-a',
  subject: 'medisync.print.intake.station-a',
  durable: 'printops-print-intake-station-a',
  dlqPrefix: 'medisync.dlq.',
  maxDeliver: 5,
};

function consumerInfo(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      durable_name: config.durable,
      filter_subject: config.subject,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      max_deliver: config.maxDeliver,
      ack_wait: nanos(30_000),
      ...overrides,
    },
  };
}

function manager(options: {
  info?: ReturnType<typeof vi.fn>;
  add?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
} = {}) {
  const handle = { consume: vi.fn() };
  return {
    handle,
    jsm: {
      consumers: {
        info: options.info ?? vi.fn().mockResolvedValue(consumerInfo()),
        add: options.add ?? vi.fn(),
        update: options.update ?? vi.fn(),
      },
      jetstream: () => ({
        consumers: { get: vi.fn().mockResolvedValue(handle) },
      }),
    },
  };
}

describe('active NATS durable-consumer lifecycle', () => {
  it('reuses a compatible durable without creating a second consumer', async () => {
    const fixture = manager();

    const result = await ensurePrintIntakeConsumer(fixture.jsm as never, config);

    expect(result.action).toBe('REUSED');
    expect(fixture.jsm.consumers.add).not.toHaveBeenCalled();
    expect(fixture.jsm.consumers.update).not.toHaveBeenCalled();
  });

  it('rejects a durable bound to another subject instead of silently stealing it', async () => {
    const fixture = manager({
      info: vi.fn().mockResolvedValue(consumerInfo({
        filter_subject: 'medisync.print.intake.station-b',
      })),
    });

    await expect(ensurePrintIntakeConsumer(fixture.jsm as never, config))
      .rejects.toBeInstanceOf(ConsumerConfigConflictError);
    expect(fixture.jsm.consumers.update).not.toHaveBeenCalled();
  });

  it('recovers a cross-process create race by re-reading and reusing the winner', async () => {
    const info = vi.fn()
      .mockRejectedValueOnce({ code: '10014' })
      .mockResolvedValueOnce(consumerInfo());
    const fixture = manager({
      info,
      add: vi.fn().mockRejectedValue({ api_error_code: 10013 }),
    });

    const result = await ensurePrintIntakeConsumer(fixture.jsm as never, config);

    expect(result.action).toBe('REUSED');
    expect(info).toHaveBeenCalledTimes(2);
    expect(fixture.jsm.consumers.add).toHaveBeenCalledTimes(1);
  });

  it('updates only delivery tuning while retaining consumer identity and subject', async () => {
    const update = vi.fn().mockResolvedValue(consumerInfo());
    const fixture = manager({
      info: vi.fn().mockResolvedValue(consumerInfo({ max_deliver: 2 })),
      update,
    });

    const result = await ensurePrintIntakeConsumer(fixture.jsm as never, config);

    expect(result.action).toBe('UPDATED');
    expect(update).toHaveBeenCalledWith(config.stream, config.durable, {
      max_deliver: config.maxDeliver,
      ack_wait: nanos(30_000),
    });
  });
});
