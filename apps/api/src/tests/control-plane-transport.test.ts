import { AckPolicy, DeliverPolicy, ReplayPolicy, nanos } from 'nats';
import type { ConsumerInfo, JsMsg, NatsConnection } from 'nats';
import { describe, expect, it, vi } from 'vitest';
import {
  ControlPlaneConsumerConfigConflictError,
  ControlPlanePubAckError,
  controlPlaneTransportConfigFromEnv,
  parseControlPlaneTransportConfig,
  startControlPlaneTransport,
} from '../infra/nats/control-plane-transport.js';
import type { ControlPlaneTransportOptions } from '../infra/nats/control-plane-transport.js';

const deviceConfig = {
  role: 'device' as const,
  url: 'nats://localhost:4222',
  stream: 'CONTROL',
  deviceId: 'device_01',
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function consumerInfo(
  stream: string,
  durable: string,
  filterSubject: string,
  overrides: Record<string, unknown> = {},
): ConsumerInfo {
  return {
    stream_name: stream,
    name: durable,
    config: {
      durable_name: durable,
      filter_subject: filterSubject,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      ack_wait: nanos(30_000),
      max_deliver: -1,
      ...overrides,
    },
  } as unknown as ConsumerInfo;
}

interface FakeMessageStream extends AsyncIterable<JsMsg> {
  close(): Promise<void>;
  push(message: JsMsg): void;
}

function createMessageStream(): FakeMessageStream {
  const queued: JsMsg[] = [];
  let waiter: ((result: IteratorResult<JsMsg>) => void) | undefined;
  let closed = false;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          const message = queued.shift();
          if (message) return Promise.resolve({ done: false, value: message });
          if (closed) return Promise.resolve({ done: true, value: undefined });
          return new Promise<IteratorResult<JsMsg>>((resolve) => { waiter = resolve; });
        },
        return() {
          closed = true;
          waiter?.({ done: true, value: undefined });
          waiter = undefined;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
    async close() {
      closed = true;
      waiter?.({ done: true, value: undefined });
      waiter = undefined;
    },
    push(message) {
      if (closed) throw new Error('message stream is closed');
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve({ done: false, value: message });
      } else {
        queued.push(message);
      }
    },
  };
}

function createFakeConnection(existingConsumers = new Map<string, ConsumerInfo>()) {
  const streamsByDurable = new Map<string, FakeMessageStream>();
  const consumerAttached = deferred();
  let closed = false;
  let closeConnection!: (error: void | Error) => void;
  const closedPromise = new Promise<void | Error>((resolve) => { closeConnection = resolve; });

  const streams = {
    info: vi.fn(async (name: string) => ({ config: { name, subjects: ['printops.>'] } })),
    add: vi.fn(),
  };
  const consumers = {
    info: vi.fn(async (stream: string, durable: string) => {
      const info = existingConsumers.get(`${stream}/${durable}`);
      if (!info) throw Object.assign(new Error('consumer not found'), { code: 404 });
      return info;
    }),
    add: vi.fn(async (stream: string, config: Record<string, unknown>) => {
      const durable = String(config['durable_name']);
      const info = consumerInfo(stream, durable, String(config['filter_subject']), config);
      existingConsumers.set(`${stream}/${durable}`, info);
      return info;
    }),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const manager = { streams, consumers };
  const jetstream = {
    publish: vi.fn(async () => ({ stream: 'CONTROL', seq: 1, duplicate: false })),
    consumers: {
      get: vi.fn(async (_stream: string, durable: string) => {
        consumerAttached.resolve();
        const messages = createMessageStream();
        streamsByDurable.set(durable, messages);
        return { consume: vi.fn(async () => messages) };
      }),
    },
  };
  const corePublish = vi.fn();
  const connection = {
    jetstreamManager: vi.fn(async () => manager),
    jetstream: vi.fn(() => jetstream),
    closed: vi.fn(() => closedPromise),
    isClosed: vi.fn(() => closed),
    publish: corePublish,
    drain: vi.fn(async () => {
      closed = true;
      closeConnection(undefined);
    }),
  };

  return {
    connection: connection as unknown as NatsConnection,
    manager,
    jetstream,
    streamsByDurable,
    consumerAttached: consumerAttached.promise,
    corePublish,
    disconnect(error = new Error('connection lost')) {
      closed = true;
      closeConnection(error);
    },
  };
}

function connectTo(connection: { connection: NatsConnection }) {
  return vi.fn(async () => connection.connection) as unknown as NonNullable<ControlPlaneTransportOptions['connect']>;
}

function controlMessage(subject: string, payload: unknown) {
  const acked = deferred();
  const nacked = deferred();
  const message = {
    subject,
    data: new TextEncoder().encode(JSON.stringify(payload)),
    working: vi.fn(),
    ack: vi.fn(() => acked.resolve()),
    nak: vi.fn(() => nacked.resolve()),
  } as unknown as JsMsg;
  return { message, acked: acked.promise, nacked: nacked.promise };
}

describe('JetStream control-plane transport', () => {
  it('parses an explicit stream and rejects unscoped or colliding durable config', () => {
    const parsed = parseControlPlaneTransportConfig(deviceConfig);
    expect(parsed).toMatchObject({
      role: 'device',
      stream: 'CONTROL',
      deviceId: 'device_01',
      commandDurable: 'printops-control-command-device_01',
    });
    expect(() => parseControlPlaneTransportConfig({ ...deviceConfig, commandDurable: 'shared-command' }))
      .toThrow(/must end with/);
    expect(() => parseControlPlaneTransportConfig({ role: 'control-plane', url: deviceConfig.url, stream: 'CONTROL', eventDurable: 'shared', heartbeatDurable: 'shared' }))
      .toThrow(/must be different/);
    expect(controlPlaneTransportConfigFromEnv(
      { role: 'control-plane' },
      { PRINTOPS_NATS_URL: deviceConfig.url, PRINTOPS_CONTROL_NATS_STREAM: 'CONTROL' },
    )).toBeUndefined();
    expect(() => controlPlaneTransportConfigFromEnv(
      { role: 'control-plane' },
      { PRINTOPS_CONTROL_NATS_URL: deviceConfig.url },
    )).toThrow(/PRINTOPS_CONTROL_NATS_STREAM is required/);
  });

  it('requires the named stream to exist and never provisions it', async () => {
    const fake = createFakeConnection();
    fake.manager.streams.info.mockRejectedValueOnce(new Error('stream not found'));

    await expect(startControlPlaneTransport(deviceConfig, { onCommand: async () => {} }, { connect: connectTo(fake) }))
      .rejects.toThrow('stream not found');
    expect(fake.manager.streams.info).toHaveBeenCalledWith('CONTROL');
    expect(fake.manager.streams.add).not.toHaveBeenCalled();
    expect(fake.manager.consumers.add).not.toHaveBeenCalled();
  });

  it.each([
    ['filter_subject', { filter_subject: 'printops.control.command.other_device' }],
    ['durable_name', { durable_name: 'printops-control-command-other_device' }],
    ['ack_wait', { ack_wait: nanos(5_000) }],
    ['max_deliver', { max_deliver: 1 }],
  ])('refuses an existing durable with conflicting %s without changing it', async (_field, overrides) => {
    const durable = 'printops-control-command-device_01';
    const fake = createFakeConnection(new Map([
      ['CONTROL/' + durable, consumerInfo('CONTROL', durable, 'printops.control.command.device_01', overrides)],
    ]));

    await expect(startControlPlaneTransport(deviceConfig, { onCommand: async () => {} }, { connect: connectTo(fake) }))
      .rejects.toBeInstanceOf(ControlPlaneConsumerConfigConflictError);
    expect(fake.manager.consumers.add).not.toHaveBeenCalled();
    expect(fake.manager.consumers.update).not.toHaveBeenCalled();
    expect(fake.manager.consumers.delete).not.toHaveBeenCalled();
  });

  it('closes the durable subscription and drains the NATS connection on stop', async () => {
    const fake = createFakeConnection();
    const transport = await startControlPlaneTransport(deviceConfig, { onCommand: async () => {} }, { connect: connectTo(fake) });
    const messages = fake.streamsByDurable.get('printops-control-command-device_01')!;
    const close = vi.spyOn(messages, 'close');

    await transport.stop();

    expect(close).toHaveBeenCalledTimes(1);
    expect(fake.connection.drain).toHaveBeenCalledTimes(1);
  });

  it('binds role-specific durable filters and publishes only through JetStream with expected PubAck', async () => {
    const fake = createFakeConnection();
    const handlers = { onEvent: async () => {}, onHeartbeat: async () => {} };
    const transport = await startControlPlaneTransport({
      role: 'control-plane',
      url: deviceConfig.url,
      stream: 'CONTROL',
      eventDurable: 'control-events',
      heartbeatDurable: 'control-heartbeats',
    }, handlers, { connect: connectTo(fake) });

    expect(fake.manager.consumers.add.mock.calls.map(([, config]) => config['filter_subject'])).toEqual([
      'printops.control.event.>',
      'printops.control.heartbeat.>',
    ]);
    expect(fake.manager.consumers.add.mock.calls.map(([, config]) => config['durable_name'])).toEqual([
      'control-events',
      'control-heartbeats',
    ]);

    const payload = { command_id: 'cmd-1', signature: 'sig', payload: { device_id: 'device_01' } };
    await expect(transport.publishCommand('printops.control.command.device_01', payload, 'cmd-1')).resolves.toEqual({
      stream: 'CONTROL', sequence: 1, duplicate: false,
    });
    expect(fake.jetstream.publish).toHaveBeenCalledWith(
      'printops.control.command.device_01',
      JSON.stringify(payload),
      { msgID: 'cmd-1', timeout: 10_000, expect: { streamName: 'CONTROL' } },
    );
    expect(fake.corePublish).not.toHaveBeenCalled();

    fake.jetstream.publish.mockRejectedValueOnce(new Error('no stream response'));
    await expect(transport.publishEvent('printops.control.event.device_01', { signature: 'sig' }, 'event-1'))
      .rejects.toThrow('no stream response');
    expect(fake.corePublish).not.toHaveBeenCalled();
    await transport.stop();
  });

  it('rejects a PubAck that does not identify the configured stream', async () => {
    const fake = createFakeConnection();
    fake.jetstream.publish.mockResolvedValueOnce({ stream: 'OTHER', seq: 3, duplicate: false });
    const transport = await startControlPlaneTransport(deviceConfig, { onCommand: async () => {} }, { connect: connectTo(fake) });

    await expect(transport.publishHeartbeat('printops.control.heartbeat.device_01', { timestamp: 't' }, 'hb-1'))
      .rejects.toBeInstanceOf(ControlPlanePubAckError);
    await transport.stop();
  });

  it('ACKs only after the awaited device handler succeeds and NAKs handler failures', async () => {
    const fake = createFakeConnection();
    const handlerStarted = deferred();
    const finishHandler = deferred();
    const onCommand = vi.fn(async () => {
      handlerStarted.resolve();
      await finishHandler.promise;
    });
    const transport = await startControlPlaneTransport(deviceConfig, { onCommand }, { connect: connectTo(fake) });
    expect(fake.manager.consumers.add.mock.calls[0]?.[1]).toMatchObject({
      durable_name: 'printops-control-command-device_01',
      filter_subject: 'printops.control.command.device_01',
      ack_policy: AckPolicy.Explicit,
    });
    const messages = fake.streamsByDurable.get('printops-control-command-device_01')!;
    const successful = controlMessage('printops.control.command.device_01', { payload: { id: 'cmd-1' }, signature: 'sig' });
    messages.push(successful.message);

    await handlerStarted.promise;
    expect(successful.message.working).toHaveBeenCalledTimes(1);
    expect(successful.message.ack).not.toHaveBeenCalled();
    expect(successful.message.nak).not.toHaveBeenCalled();
    finishHandler.resolve();
    await successful.acked;
    expect(successful.message.ack).toHaveBeenCalledTimes(1);
    expect(successful.message.nak).not.toHaveBeenCalled();

    const failingFake = createFakeConnection();
    const failingHandler = vi.fn(async () => { throw new Error('persistence failed'); });
    const failingTransport = await startControlPlaneTransport(deviceConfig, { onCommand: failingHandler }, { connect: connectTo(failingFake) });
    const failingMessage = controlMessage('printops.control.command.device_01', { payload: { id: 'cmd-2' }, signature: 'sig' });
    failingFake.streamsByDurable.get('printops-control-command-device_01')!.push(failingMessage.message);
    await failingMessage.nacked;
    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(failingMessage.message.nak).toHaveBeenCalledWith(1_000);
    expect(failingMessage.message.ack).not.toHaveBeenCalled();

    await transport.stop();
    await failingTransport.stop();
  });

  it('extends the JetStream ACK lease while an install handler waits for print idle', async () => {
    vi.useFakeTimers();
    const fake = createFakeConnection();
    const handlerStarted = deferred();
    const finishHandler = deferred();
    const transport = await startControlPlaneTransport(deviceConfig, {
      onCommand: async () => {
        handlerStarted.resolve();
        await finishHandler.promise;
      },
    }, { connect: connectTo(fake) });

    try {
      const message = controlMessage('printops.control.command.device_01', { payload: { id: 'cmd-long' }, signature: 'sig' });
      fake.streamsByDurable.get('printops-control-command-device_01')!.push(message.message);
      await handlerStarted.promise;
      expect(message.message.working).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(message.message.working).toHaveBeenCalledTimes(2);
      expect(message.message.ack).not.toHaveBeenCalled();
      finishHandler.resolve();
      await message.acked;
    } finally {
      finishHandler.resolve();
      await transport.stop();
      vi.useRealTimers();
    }
  });

  it('routes event and heartbeat wildcard messages to their own handlers', async () => {
    const fake = createFakeConnection();
    const onEvent = vi.fn(async () => {});
    const onHeartbeat = vi.fn(async () => {});
    const transport = await startControlPlaneTransport({
      role: 'control-plane', url: deviceConfig.url, stream: 'CONTROL',
      eventDurable: 'events', heartbeatDurable: 'heartbeats',
    }, { onEvent, onHeartbeat }, { connect: connectTo(fake) });

    const event = controlMessage('printops.control.event.device_02', { state: 'COMPLETED', signature: 'sig' });
    const heartbeat = controlMessage('printops.control.heartbeat.device_02', { timestamp: 'now', signature: 'sig' });
    fake.streamsByDurable.get('events')!.push(event.message);
    fake.streamsByDurable.get('heartbeats')!.push(heartbeat.message);
    await Promise.all([event.acked, heartbeat.acked]);
    expect(onEvent).toHaveBeenCalledWith({ state: 'COMPLETED', signature: 'sig' }, 'printops.control.event.device_02');
    expect(onHeartbeat).toHaveBeenCalledWith({ timestamp: 'now', signature: 'sig' }, 'printops.control.heartbeat.device_02');
    await transport.stop();
  });
  it('keeps the API transport retrying when the broker is unavailable during startup', async () => {
    const fake = createFakeConnection();
    let connectionCount = 0;
    const connect = vi.fn(async () => {
      connectionCount++;
      if (connectionCount === 1) throw new Error('temporary broker outage');
      return fake.connection;
    }) as unknown as NonNullable<ControlPlaneTransportOptions['connect']>;

    const transport = await startControlPlaneTransport(deviceConfig, { onCommand: async () => {} }, {
      connect,
      reconnectDelayMs: 0,
      allowOfflineStartup: true,
    });
    await fake.consumerAttached;

    expect(connect).toHaveBeenCalledTimes(2);
    expect(fake.manager.streams.info).toHaveBeenCalledWith('CONTROL');
    await transport.stop();
  });

  it('reconnects and binds the same durable consumers again', async () => {
    const existingConsumers = new Map<string, ConsumerInfo>();
    const first = createFakeConnection(existingConsumers);
    const second = createFakeConnection(existingConsumers);
    let connectionCount = 0;
    const connect = vi.fn(async () => {
      connectionCount++;
      return connectionCount === 1 ? first.connection : second.connection;
    }) as unknown as NonNullable<ControlPlaneTransportOptions['connect']>;
    const transport = await startControlPlaneTransport(deviceConfig, { onCommand: async () => {} }, {
      connect,
      reconnectDelayMs: 0,
    });
    expect(first.jetstream.consumers.get).toHaveBeenCalledWith('CONTROL', 'printops-control-command-device_01');

    first.disconnect();
    await second.consumerAttached;
    expect(connect).toHaveBeenCalledTimes(2);
    expect(second.manager.consumers.add).not.toHaveBeenCalled();
    expect(second.jetstream.consumers.get).toHaveBeenCalledWith('CONTROL', 'printops-control-command-device_01');
    await transport.stop();
  });
});
