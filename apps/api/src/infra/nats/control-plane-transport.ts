import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  connect,
  nanos,
} from 'nats';
import type {
  ConsumerInfo,
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  NatsConnection,
} from 'nats';

const CONTROL_COMMAND_PREFIX = 'printops.control.command.';
const CONTROL_EVENT_FILTER = 'printops.control.event.>';
const CONTROL_HEARTBEAT_FILTER = 'printops.control.heartbeat.>';
const ACK_WAIT_MS = 30_000;
const NAK_RETRY_DELAY_MS = 1_000;
const CONNECT_TIMEOUT_MS = 3_000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;

type DeviceControlPlaneConfigInput = {
  role: 'device';
  url: string;
  stream: string;
  deviceId: string;
  commandDurable?: string;
};

type CentralControlPlaneConfigInput = {
  role: 'control-plane';
  url: string;
  stream: string;
  eventDurable?: string;
  heartbeatDurable?: string;
};

export type ControlPlaneTransportConfigInput = DeviceControlPlaneConfigInput | CentralControlPlaneConfigInput;

export interface DeviceControlPlaneTransportConfig {
  role: 'device';
  url: string;
  stream: string;
  deviceId: string;
  commandDurable: string;
}

export interface CentralControlPlaneTransportConfig {
  role: 'control-plane';
  url: string;
  stream: string;
  eventDurable: string;
  heartbeatDurable: string;
}

export type ControlPlaneTransportConfig = DeviceControlPlaneTransportConfig | CentralControlPlaneTransportConfig;

export type ControlPlaneTransportRoleInput =
  | { role: 'device'; deviceId: string }
  | { role: 'control-plane' };

export type ControlPlaneMessageHandler = (
  payload: Record<string, unknown>,
  subject: string,
) => Promise<unknown>;

export interface ControlPlaneTransportHandlers {
  onCommand?: ControlPlaneMessageHandler;
  onEvent?: ControlPlaneMessageHandler;
  onHeartbeat?: ControlPlaneMessageHandler;
}

export interface ControlPlaneTransportLogger {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface ControlPlaneTransportOptions {
  /** Replaces the NATS connection function for deterministic protocol tests. */
  connect?: typeof connect;
  /** Keep the hosting API available while the broker is initially unreachable. */
  allowOfflineStartup?: boolean;
  logger?: ControlPlaneTransportLogger;
  publishTimeoutMs?: number;
  reconnectDelayMs?: number;
}

export interface ControlPlanePublishAck {
  stream: string;
  sequence: number;
  duplicate: boolean;
}

export interface ControlPlaneTransport {
  publishCommand(subject: string, payload: Record<string, unknown>, msgId: string): Promise<ControlPlanePublishAck>;
  publishEvent(subject: string, payload: Record<string, unknown>, msgId: string): Promise<ControlPlanePublishAck>;
  publishHeartbeat(subject: string, payload: Record<string, unknown>, msgId: string): Promise<ControlPlanePublishAck>;
  stop(): Promise<void>;
}

export class ControlPlaneTransportDisconnectedError extends Error {
  readonly code = 'CONTROL_PLANE_NATS_DISCONNECTED';

  constructor() {
    super('JetStream control-plane transport is not connected');
    this.name = 'ControlPlaneTransportDisconnectedError';
  }
}

export interface ConsumerConfigDifference {
  field: string;
  expected: unknown;
  actual: unknown;
}

export class ControlPlaneConsumerConfigConflictError extends Error {
  readonly code = 'CONTROL_PLANE_CONSUMER_CONFIG_CONFLICT';

  constructor(
    readonly stream: string,
    readonly durable: string,
    readonly differences: ConsumerConfigDifference[],
  ) {
    const details = differences
      .map(({ field, expected, actual }) => `${field}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`)
      .join('; ');
    super(`JetStream consumer configuration conflicts for ${stream}/${durable}: ${details}. The existing durable was not changed.`);
    this.name = 'ControlPlaneConsumerConfigConflictError';
  }
}

export class ControlPlanePubAckError extends Error {
  readonly code = 'CONTROL_PLANE_PUBACK_INVALID';

  constructor(readonly expectedStream: string, readonly actualAck: unknown) {
    super(`JetStream publish did not receive a valid PubAck from configured stream '${expectedStream}'`);
    this.name = 'ControlPlanePubAckError';
  }
}

/** Parse and validate the complete runtime config; filters are derived from the role and cannot be overridden. */
export function parseControlPlaneTransportConfig(input: unknown): ControlPlaneTransportConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Control-plane NATS config must be an object');
  }

  const config = input as Record<string, unknown>;
  const urlInput = requiredString(config['url'], 'url');
  assertNatsUrl(urlInput);
  const url = urlInput.split(',').map((server) => server.trim()).join(',');
  const stream = requiredString(config['stream'], 'stream');
  assertNatsToken('stream', stream);

  if (config['role'] === 'device') {
    const deviceId = requiredString(config['deviceId'], 'deviceId');
    assertNatsToken('deviceId', deviceId);
    const commandDurable = optionalString(config['commandDurable'])
      ?? `printops-control-command-${deviceId}`;
    assertNatsToken('commandDurable', commandDurable);
    if (!commandDurable.endsWith(`-${deviceId}`)) {
      throw new Error(`commandDurable must end with '-${deviceId}' so each device owns its command durable`);
    }
    return { role: 'device', url, stream, deviceId, commandDurable };
  }

  if (config['role'] === 'control-plane') {
    const eventDurable = optionalString(config['eventDurable']) ?? 'printops-control-events';
    const heartbeatDurable = optionalString(config['heartbeatDurable']) ?? 'printops-control-heartbeats';
    assertNatsToken('eventDurable', eventDurable);
    assertNatsToken('heartbeatDurable', heartbeatDurable);
    if (eventDurable === heartbeatDurable) {
      throw new Error('eventDurable and heartbeatDurable must be different durable names');
    }
    return { role: 'control-plane', url, stream, eventDurable, heartbeatDurable };
  }

  throw new Error("Control-plane NATS config role must be 'device' or 'control-plane'");
}

/** Read role-specific control-plane settings. A configured URL requires an explicit stream name. */
export function controlPlaneTransportConfigFromEnv(
  role: ControlPlaneTransportRoleInput,
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneTransportConfig | undefined {
  const url = env['PRINTOPS_CONTROL_NATS_URL']?.trim();
  if (!url) return undefined;

  const stream = env['PRINTOPS_CONTROL_NATS_STREAM']?.trim();
  if (!stream) {
    throw new Error('PRINTOPS_CONTROL_NATS_STREAM is required when control-plane NATS is enabled');
  }

  if (role.role === 'device') {
    return parseControlPlaneTransportConfig({
      role: 'device',
      url,
      stream,
      deviceId: role.deviceId,
      commandDurable: env['PRINTOPS_CONTROL_COMMAND_DURABLE'],
    });
  }

  return parseControlPlaneTransportConfig({
    role: 'control-plane',
    url,
    stream,
    eventDurable: env['PRINTOPS_CONTROL_EVENTS_DURABLE'],
    heartbeatDurable: env['PRINTOPS_CONTROL_HEARTBEATS_DURABLE'],
  });
}

interface ConsumerSpec {
  durable: string;
  filterSubject: string;
  handler: ControlPlaneMessageHandler;
}

interface ClosableMessageStream extends AsyncIterable<JsMsg> {
  close(): Promise<void | Error>;
}

interface ActiveSubscription {
  spec: ConsumerSpec;
  messages: ClosableMessageStream;
  loop: Promise<void>;
}

/** Start a role-scoped JetStream transport after its configured stream and durables have been checked. */
export async function startControlPlaneTransport(
  input: unknown,
  handlers: ControlPlaneTransportHandlers,
  options: ControlPlaneTransportOptions = {},
): Promise<ControlPlaneTransport> {
  const config = parseControlPlaneTransportConfig(input);
  assertHandlers(config, handlers);
  const transport = new ControlPlaneTransportImpl(config, handlers, options);
  await transport.start();
  return transport;
}

class ControlPlaneTransportImpl implements ControlPlaneTransport {
  private readonly connectNats: typeof connect;
  private readonly publishTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private readonly allowOfflineStartup: boolean;
  private readonly logger?: ControlPlaneTransportLogger;
  private connection?: NatsConnection;
  private jetstream?: JetStreamClient;
  private runPromise?: Promise<void>;
  private readySettled = false;
  private stopRequested = false;
  private stopSignalResolve!: () => void;
  private readonly stopSignal = new Promise<void>((resolve) => { this.stopSignalResolve = resolve; });
  private readyResolve!: () => void;
  private readyReject!: (error: unknown) => void;
  private readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });

  constructor(
    private readonly config: ControlPlaneTransportConfig,
    private readonly handlers: ControlPlaneTransportHandlers,
    options: ControlPlaneTransportOptions,
  ) {
    this.connectNats = options.connect ?? connect;
    this.publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.allowOfflineStartup = options.allowOfflineStartup ?? false;
    this.logger = options.logger;
    if (!Number.isFinite(this.publishTimeoutMs) || this.publishTimeoutMs <= 0) {
      throw new Error('publishTimeoutMs must be a positive number');
    }
    if (!Number.isFinite(this.reconnectDelayMs) || this.reconnectDelayMs < 0) {
      throw new Error('reconnectDelayMs must be a non-negative number');
    }
  }

  async start(): Promise<void> {
    this.runPromise = this.run().catch((error) => {
      if (!this.readySettled) this.rejectInitial(error);
      else this.logger?.error({ error: errorMessage(error) }, 'JetStream control-plane transport stopped unexpectedly');
    });
    if (this.allowOfflineStartup) return;
    try {
      await this.ready;
    } catch (error) {
      this.stopRequested = true;
      this.stopSignalResolve();
      await this.runPromise;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopRequested) {
      await this.runPromise;
      return;
    }
    this.stopRequested = true;
    this.stopSignalResolve();
    await this.runPromise;
  }

  publishCommand(subject: string, payload: Record<string, unknown>, msgId: string): Promise<ControlPlanePublishAck> {
    assertDeviceSubject(subject, CONTROL_COMMAND_PREFIX, 'command');
    return this.publish(subject, payload, msgId);
  }

  publishEvent(subject: string, payload: Record<string, unknown>, msgId: string): Promise<ControlPlanePublishAck> {
    assertDeviceSubject(subject, 'printops.control.event.', 'event');
    return this.publish(subject, payload, msgId);
  }

  publishHeartbeat(subject: string, payload: Record<string, unknown>, msgId: string): Promise<ControlPlanePublishAck> {
    assertDeviceSubject(subject, 'printops.control.heartbeat.', 'heartbeat');
    return this.publish(subject, payload, msgId);
  }

  private async publish(
    subject: string,
    payload: Record<string, unknown>,
    msgId: string,
  ): Promise<ControlPlanePublishAck> {
    if (!this.jetstream || this.connection?.isClosed()) throw new ControlPlaneTransportDisconnectedError();
    if (typeof msgId !== 'string' || !msgId.trim() || /[\r\n]/.test(msgId)) {
      throw new Error('msgId must be a non-empty stable message identifier');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('JetStream control-plane payload must be a JSON object');
    }
    const encoded = JSON.stringify(payload);
    if (typeof encoded !== 'string') throw new Error('JetStream control-plane payload must serialize to JSON');

    const ack = await this.jetstream.publish(subject, encoded, {
      msgID: msgId,
      timeout: this.publishTimeoutMs,
      expect: { streamName: this.config.stream },
    });
    if (
      !ack
      || ack.stream !== this.config.stream
      || !Number.isSafeInteger(ack.seq)
      || ack.seq < 1
      || typeof ack.duplicate !== 'boolean'
    ) {
      throw new ControlPlanePubAckError(this.config.stream, ack);
    }
    return { stream: ack.stream, sequence: ack.seq, duplicate: ack.duplicate };
  }

  private async run(): Promise<void> {
    let connectedOnce = false;
    let reconnectAttempt = 0;

    while (!this.stopRequested) {
      let connection: NatsConnection | undefined;
      const subscriptions: ActiveSubscription[] = [];
      try {
        connection = await this.connectNats({
          servers: this.config.url,
          name: this.config.role === 'device'
            ? `printops-control-device-${this.config.deviceId}`
            : 'printops-control-plane',
          timeout: CONNECT_TIMEOUT_MS,
          waitOnFirstConnect: true,
          maxReconnectAttempts: 0,
        });
        this.connection = connection;

        const jsm = await connection.jetstreamManager();
        // Stream ownership belongs to deployment/workflow. Lookup only; never add, update, or delete it.
        await jsm.streams.info(this.config.stream);

        const specs = this.consumerSpecs();
        for (const spec of specs) await ensureDurableConsumer(jsm, this.config.stream, spec);

        const js = connection.jetstream();
        for (const spec of specs) {
          const consumer = await js.consumers.get(this.config.stream, spec.durable);
          const messages = await consumer.consume() as ClosableMessageStream;
          const active: ActiveSubscription = { spec, messages, loop: Promise.resolve() };
          subscriptions.push(active);
          active.loop = this.consumeMessages(active);
        }
        this.jetstream = js;
        reconnectAttempt = 0;
        if (!connectedOnce) {
          connectedOnce = true;
          this.resolveInitial();
        }

        const outcome = await Promise.race([
          connection.closed().then((error) => ({ kind: 'closed' as const, error })),
          Promise.all(subscriptions.map(({ loop }) => loop)).then(() => ({ kind: 'consumers-ended' as const })),
          this.stopSignal.then(() => ({ kind: 'stopped' as const })),
        ]);
        if (this.stopRequested || outcome.kind === 'stopped') break;
        if (outcome.kind === 'closed') {
          throw outcome.error instanceof Error ? outcome.error : new Error('NATS connection closed');
        }
        throw new Error('JetStream durable consumer ended unexpectedly');
      } catch (error) {
        if (!connectedOnce && !this.allowOfflineStartup) {
          this.rejectInitial(error);
          break;
        }
        if (!this.stopRequested) {
          reconnectAttempt++;
          this.logger?.warn(
            { role: this.config.role, stream: this.config.stream, error: errorMessage(error) },
            'JetStream control-plane transport disconnected; reconnecting',
          );
        }
      } finally {
        if (this.connection === connection) this.connection = undefined;
        if (connection && this.jetstream) this.jetstream = undefined;
        await closeSubscriptions(subscriptions);
        await connection?.drain().catch(() => {});
      }

      if (!this.stopRequested && (connectedOnce || this.allowOfflineStartup)) {
        const delay = Math.min(MAX_RECONNECT_DELAY_MS, this.reconnectDelayMs * 2 ** Math.min(reconnectAttempt - 1, 6));
        await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, delay)), this.stopSignal]);
      }
    }
  }

  private consumerSpecs(): ConsumerSpec[] {
    if (this.config.role === 'device') {
      return [{
        durable: this.config.commandDurable,
        filterSubject: `${CONTROL_COMMAND_PREFIX}${this.config.deviceId}`,
        handler: this.handlers.onCommand!,
      }];
    }
    return [
      {
        durable: this.config.eventDurable,
        filterSubject: CONTROL_EVENT_FILTER,
        handler: this.handlers.onEvent!,
      },
      {
        durable: this.config.heartbeatDurable,
        filterSubject: CONTROL_HEARTBEAT_FILTER,
        handler: this.handlers.onHeartbeat!,
      },
    ];
  }

  private async consumeMessages(subscription: ActiveSubscription): Promise<void> {
    for await (const msg of subscription.messages) {
      try {
        if (!subjectMatches(subscription.spec.filterSubject, msg.subject)) {
          throw new Error(`Message subject '${msg.subject}' does not match durable filter '${subscription.spec.filterSubject}'`);
        }
        const payload = parseMessagePayload(msg.data);
        await this.handleWithAckProgress(subscription, msg, payload);
      } catch (error) {
        try {
          msg.nak(NAK_RETRY_DELAY_MS);
        } catch (nakError) {
          this.logger?.error(
            { role: this.config.role, durable: subscription.spec.durable, error: errorMessage(nakError) },
            'JetStream control-plane NAK failed',
          );
          throw nakError;
        }
        this.logger?.warn(
          { role: this.config.role, durable: subscription.spec.durable, subject: msg.subject, error: errorMessage(error) },
          'JetStream control-plane message handler failed; message NAKed',
        );
        continue;
      }
      // ACK only after JSON validation and the awaited handler both succeed.
      msg.ack();
    }
  }

  private async handleWithAckProgress(
    subscription: ActiveSubscription,
    msg: JsMsg,
    payload: Record<string, unknown>,
  ): Promise<void> {
    msg.working();
    const progressTimer = setInterval(() => {
      try {
        msg.working();
      } catch (error) {
        this.logger?.warn(
          { role: this.config.role, durable: subscription.spec.durable, error: errorMessage(error) },
          'JetStream control-plane ACK progress failed',
        );
      }
    }, ACK_WAIT_MS / 3);
    progressTimer.unref?.();
    try {
      await subscription.spec.handler(payload, msg.subject);
    } finally {
      clearInterval(progressTimer);
    }
  }

  private resolveInitial(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyResolve();
  }

  private rejectInitial(error: unknown): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyReject(error);
  }
}

async function ensureDurableConsumer(
  jsm: JetStreamManager,
  stream: string,
  spec: ConsumerSpec,
): Promise<void> {
  let info: ConsumerInfo | undefined;
  try {
    info = await jsm.consumers.info(stream, spec.durable);
  } catch (error) {
    if (!isMissingConsumerError(error)) throw error;
  }

  if (!info) {
    try {
      await jsm.consumers.add(stream, {
        durable_name: spec.durable,
        filter_subject: spec.filterSubject,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        replay_policy: ReplayPolicy.Instant,
        ack_wait: nanos(ACK_WAIT_MS),
        max_deliver: -1,
      });
    } catch (error) {
      if (!isConsumerCreateRace(error)) throw error;
    }
    info = await jsm.consumers.info(stream, spec.durable);
  }

  assertConsumerCompatible(info, stream, spec);
}

function assertConsumerCompatible(info: ConsumerInfo, stream: string, spec: ConsumerSpec): void {
  const config = info.config;
  const filterSubjects = config.filter_subjects ?? [];
  const actualFilter = config.filter_subject ?? (filterSubjects.length === 1 ? filterSubjects[0] : undefined);
  const differences: ConsumerConfigDifference[] = [];
  const compare = (field: string, expected: unknown, actual: unknown) => {
    if (actual !== expected) differences.push({ field, expected, actual });
  };

  compare('stream_name', stream, info.stream_name);
  compare('durable_name', spec.durable, config.durable_name);
  compare('filter_subject', spec.filterSubject, actualFilter);
  if (filterSubjects.length > 1) {
    differences.push({ field: 'filter_subjects', expected: [spec.filterSubject], actual: filterSubjects });
  }
  compare('ack_policy', AckPolicy.Explicit, config.ack_policy);
  compare('deliver_policy', DeliverPolicy.All, config.deliver_policy);
  compare('replay_policy', ReplayPolicy.Instant, config.replay_policy);
  compare('ack_wait', nanos(ACK_WAIT_MS), config.ack_wait);
  compare('max_deliver', -1, config.max_deliver);
  compare('deliver_subject', '', config.deliver_subject ?? '');
  compare('deliver_group', '', config.deliver_group ?? '');
  if (differences.length > 0) {
    throw new ControlPlaneConsumerConfigConflictError(stream, spec.durable, differences);
  }
}

function assertHandlers(config: ControlPlaneTransportConfig, handlers: ControlPlaneTransportHandlers): void {
  if (config.role === 'device' && typeof handlers.onCommand !== 'function') {
    throw new Error('A device control-plane transport requires an onCommand handler');
  }
  if (config.role === 'control-plane') {
    if (typeof handlers.onEvent !== 'function') throw new Error('A control-plane transport requires an onEvent handler');
    if (typeof handlers.onHeartbeat !== 'function') throw new Error('A control-plane transport requires an onHeartbeat handler');
  }
}

function assertDeviceSubject(subject: string, prefix: string, kind: string): void {
  if (typeof subject !== 'string' || !subject.startsWith(prefix)) {
    throw new Error(`Invalid control-plane ${kind} subject`);
  }
  const deviceId = subject.slice(prefix.length);
  try {
    assertNatsToken(`${kind} subject device ID`, deviceId);
  } catch {
    throw new Error(`Invalid control-plane ${kind} subject`);
  }
}

function subjectMatches(filter: string, subject: string): boolean {
  const filterTokens = filter.split('.');
  const subjectTokens = subject.split('.');
  let subjectIndex = 0;
  for (const token of filterTokens) {
    if (token === '>') return subjectIndex < subjectTokens.length;
    const actual = subjectTokens[subjectIndex];
    if (actual === undefined || (token !== '*' && token !== actual)) return false;
    subjectIndex++;
  }
  return subjectIndex === subjectTokens.length;
}

function parseMessagePayload(data: Uint8Array): Record<string, unknown> {
  const decoded: unknown = JSON.parse(new TextDecoder().decode(data));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('JetStream control-plane message payload must be a JSON object');
  }
  return decoded as Record<string, unknown>;
}

function isMissingConsumerError(error: unknown): boolean {
  const value = error as { code?: unknown; api_error_code?: unknown; apiErrorCode?: unknown } | undefined;
  return value?.code === 'consumer_not_found'
    || value?.code === 404
    || value?.code === '404'
    || value?.code === '10014'
    || value?.api_error_code === 10014
    || value?.apiErrorCode === 10014;
}

function isConsumerCreateRace(error: unknown): boolean {
  const value = error as { code?: unknown; api_error_code?: unknown; apiErrorCode?: unknown; message?: unknown } | undefined;
  const code = value?.code ?? value?.api_error_code ?? value?.apiErrorCode;
  return code === 10013
    || code === 10058
    || code === '10013'
    || code === '10058'
    || code === 'consumer_name_already_in_use'
    || code === 'CONSUMER_ALREADY_EXISTS'
    || (typeof value?.message === 'string' && /consumer already exists|consumer name.*in use/i.test(value.message));
}

function assertNatsUrl(value: string): void {
  const servers = value.split(',').map((server) => server.trim());
  if (servers.some((server) => server.length === 0)) throw new Error('url must contain one or more valid NATS server URLs');
  for (const server of servers) {
    let parsed: URL;
    try {
      parsed = new URL(server);
    } catch {
      throw new Error('url must contain one or more valid NATS server URLs');
    }
    if (!['nats:', 'tls:', 'ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error('url must use nats://, tls://, ws://, or wss://');
    }
  }
}

function assertNatsToken(name: string, value: string): void {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(value)) {
    throw new Error(`${name} must be a single literal NATS token without wildcards`);
  }
}

function requiredString(value: unknown, name: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


async function closeSubscriptions(subscriptions: ActiveSubscription[]): Promise<void> {
  await Promise.all(subscriptions.map(async ({ messages }) => {
    try {
      await messages.close();
    } catch {
      // Closing a subscription on a dead connection is best-effort.
    }
  }));
  await Promise.all(subscriptions.map(({ loop }) => loop.then(() => undefined, () => undefined)));
}
