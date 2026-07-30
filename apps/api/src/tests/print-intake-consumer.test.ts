import { describe, expect, it, vi } from 'vitest';
import {
  ConsumerConfigConflictError,
  NatsOperationError,
  PrintIntakeManager,
  ensurePrintIntakeConsumer,
  type ConsumerInfo,
  type JetStreamManagerLike,
  type PrintIntakeConfig,
} from '../infra/nats/print-intake-consumer.js';

const config: PrintIntakeConfig = {
  stream: 'MEDISYNC',
  subjectPrefix: 'print_service.commands.print',
  clientId: 'counterjohn',
};

function fakeJsm(existing?: ConsumerInfo): JetStreamManagerLike & { add: ReturnType<typeof vi.fn> } {
  let current = existing;
  const add = vi.fn(async (_stream: string, next: ConsumerInfo['config']) => {
    current = { config: next };
    return current;
  });
  return {
    streams: { info: vi.fn(async () => ({})) },
    consumers: {
      info: vi.fn(async () => {
        if (!current) throw Object.assign(new Error('consumer not found'), { code: 404 });
        return current;
      }),
      add,
    },
    add: add as unknown as ReturnType<typeof vi.fn>,
  };
}

describe('ensurePrintIntakeConsumer', () => {
  it('creates a missing durable and reuses it on restart', async () => {
    const jsm = fakeJsm();
    const first = await ensurePrintIntakeConsumer(jsm, config);
    const second = await ensurePrintIntakeConsumer(jsm, config);

    expect(first.action).toBe('CREATED');
    expect(second.action).toBe('REUSED');
    expect(jsm.add).toHaveBeenCalledTimes(1);
  });

  it('normalizes server durable-name defaults and preserves delivery state', async () => {
    const existing: ConsumerInfo = {
      config: {
        name: 'printops-print-intake-counterjohn',
        filter_subject: 'print_service.commands.print.counterjohn',
        ack_policy: 'explicit',
        deliver_policy: 'all',
        replay_policy: 'instant',
        max_deliver: -1,
        ack_wait: 30_000_000_000,
      },
      delivered: { stream_seq: 42, consumer_seq: 40 },
      pending: 7,
      ack_floor: { stream_seq: 38, consumer_seq: 38 },
    };
    const jsm = fakeJsm(existing);

    const result = await ensurePrintIntakeConsumer(jsm, config);

    expect(result.action).toBe('REUSED');
    expect(result.consumer).toBe(existing);
    expect(result.consumer.pending).toBe(7);
    expect(result.consumer.ack_floor).toEqual({ stream_seq: 38, consumer_seq: 38 });
    expect(jsm.add).not.toHaveBeenCalled();
  });

  it('updates only safely mutable fields', async () => {
    const existing: ConsumerInfo = {
      config: {
        durable_name: 'printops-print-intake-counterjohn',
        filter_subject: 'print_service.commands.print.counterjohn',
        ack_policy: 'explicit',
        deliver_policy: 'all',
        replay_policy: 'instant',
        max_deliver: 3,
        ack_wait: 5_000_000_000,
      },
    };
    const jsm = fakeJsm(existing);
    const update = vi.fn(async (_stream: string, _durable: string, next: ConsumerInfo['config']) => ({ config: next }));
    jsm.consumers.update = update;

    const result = await ensurePrintIntakeConsumer(jsm, config);

    expect(result.action).toBe('UPDATED');
    expect(update).toHaveBeenCalledWith(
      'MEDISYNC',
      'printops-print-intake-counterjohn',
      expect.objectContaining({ max_deliver: -1, ack_wait: 30_000_000_000 }),
    );
  });

  it('reports exact unsafe configuration differences', async () => {
    const jsm = fakeJsm({
      config: {
        durable_name: 'printops-print-intake-counterjohn',
        filter_subject: 'medisync.print.intake.counterjohn',
        ack_policy: 'explicit',
        deliver_policy: 'all',
        replay_policy: 'instant',
        max_deliver: -1,
        ack_wait: 30_000_000_000,
      },
    });

    await expect(ensurePrintIntakeConsumer(jsm, config)).rejects.toMatchObject({
      code: 'CONSUMER_CONFIG_CONFLICT',
      stream: 'MEDISYNC',
      durable: 'printops-print-intake-counterjohn',
      differences: [{ field: 'filter_subject', expected: config.subjectPrefix + '.counterjohn', actual: 'medisync.print.intake.counterjohn' }],
    });
    expect(jsm.add).not.toHaveBeenCalled();
  });

  it('rejects an existing push consumer for the required pull mode', async () => {
    const jsm = fakeJsm({
      config: {
        durable_name: 'printops-print-intake-counterjohn',
        filter_subject: 'print_service.commands.print.counterjohn',
        ack_policy: 'explicit',
        deliver_policy: 'all',
        replay_policy: 'instant',
        max_deliver: -1,
        ack_wait: 30_000_000_000,
        deliver_subject: '_INBOX.push',
      },
    });

    await expect(ensurePrintIntakeConsumer(jsm, config)).rejects.toMatchObject({
      code: 'CONSUMER_CONFIG_CONFLICT',
      differences: expect.arrayContaining([
        { field: 'deliver_subject', expected: undefined, actual: '_INBOX.push' },
      ]),
    });
  });

  it('reuses a consumer won by another process during a create race', async () => {
    const compatible: ConsumerInfo = {
      config: {
        durable_name: 'printops-print-intake-counterjohn',
        filter_subject: 'print_service.commands.print.counterjohn',
        ack_policy: 'explicit',
        deliver_policy: 'all',
        replay_policy: 'instant',
        max_deliver: -1,
        ack_wait: 30_000_000_000,
      },
    };
    const info = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 404 }))
      .mockResolvedValueOnce(compatible);
    const add = vi.fn().mockRejectedValue(Object.assign(new Error('consumer already exists'), { api_error_code: 10013 }));
    const jsm: JetStreamManagerLike = {
      streams: { info: vi.fn(async () => ({})) },
      consumers: { info, add },
    };

    const result = await ensurePrintIntakeConsumer(jsm, config);

    expect(result.action).toBe('REUSED');
    expect(info).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('single-flights setup and binds only one loop', async () => {
    const jsm = fakeJsm();
    let releaseBind!: () => void;
    const bind = vi.fn(() => new Promise<void>((resolve) => { releaseBind = resolve; }));
    const manager = new PrintIntakeManager({ jsm, bind });

    const first = manager.setup(config);
    const second = manager.setup(config);
    await vi.waitFor(() => expect(jsm.add).toHaveBeenCalledTimes(1));
    releaseBind();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(bind).toHaveBeenCalledTimes(1);
    expect(manager.diagnostics.consumeLoopActive).toBe(true);
  });

  it('invalidates an older setup generation when settings change', async () => {
    let releaseFirst!: () => void;
    const firstStreamLookup = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const consumers = new Map<string, ConsumerInfo>();
    const add = vi.fn(async (_stream: string, next: ConsumerInfo['config']) => {
      const durable = next.durable_name!;
      const consumer = { config: next };
      consumers.set(durable, consumer);
      return consumer;
    });
    const jsm: JetStreamManagerLike = {
      streams: {
        info: vi.fn()
          .mockImplementationOnce(async () => await firstStreamLookup)
          .mockResolvedValue({}),
      },
      consumers: {
        info: vi.fn(async (_stream: string, durable: string) => {
          const consumer = consumers.get(durable);
          if (!consumer) throw Object.assign(new Error('missing'), { code: 404 });
          return consumer;
        }),
        add,
      },
    };
    const bind = vi.fn(async () => undefined);
    const manager = new PrintIntakeManager({ jsm, bind });
    const changedConfig = { ...config, clientId: 'countermary' };

    const oldSetup = manager.setup(config);
    const newSetup = manager.setup(changedConfig);
    releaseFirst();

    await expect(oldSetup).resolves.toBeUndefined();
    await expect(newSetup).resolves.toMatchObject({
      durable: 'printops-print-intake-countermary',
      action: 'CREATED',
    });
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith(
      expect.anything(),
      changedConfig,
    );
    expect(manager.diagnostics.setupGeneration).toBe(2);
  });

  it('test connection never creates a production consumer', async () => {
    const jsm = fakeJsm();
    const manager = new PrintIntakeManager({ jsm, bind: vi.fn() });

    const result = await manager.testConnection(config);

    expect(result.consumerExists).toBe(false);
    expect(jsm.add).not.toHaveBeenCalled();
  });

  it('test connection reuses compatibility checks without mutating an existing consumer', async () => {
    const jsm = fakeJsm({
      config: {
        durable_name: 'printops-print-intake-counterjohn',
        filter_subject: 'print_service.commands.print.counterjohn',
        ack_policy: 'explicit',
        deliver_policy: 'all',
        replay_policy: 'instant',
        max_deliver: -1,
        ack_wait: 30_000_000_000,
      },
    });
    const update = vi.fn();
    jsm.consumers.update = update;
    const manager = new PrintIntakeManager({ jsm, bind: vi.fn() });

    const result = await manager.testConnection(config);

    expect(result).toMatchObject({ valid: true, consumerExists: true });
    expect(jsm.add).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves the original NATS stage and error codes', async () => {
    const original = Object.assign(new Error('permission denied'), {
      code: '403',
      api_error_code: 10035,
    });
    const jsm: JetStreamManagerLike = {
      streams: { info: vi.fn().mockRejectedValue(original) },
      consumers: {
        info: vi.fn(),
        add: vi.fn(),
      },
    };

    const error = await ensurePrintIntakeConsumer(jsm, config).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NatsOperationError);
    expect(error).toMatchObject({
      stage: 'STREAM_LOOKUP',
      code: '403',
      apiErrorCode: 10035,
      message: 'permission denied',
      cause: original,
    });
  });

  it('does not update or delete conflicting consumers', async () => {
    const update = vi.fn();
    const jsm = fakeJsm({ config: { filter_subject: 'other.subject' } });
    jsm.consumers.update = update;

    await expect(ensurePrintIntakeConsumer(jsm, config)).rejects.toBeInstanceOf(ConsumerConfigConflictError);
    expect(update).not.toHaveBeenCalled();
    expect(jsm.add).not.toHaveBeenCalled();
  });
});
