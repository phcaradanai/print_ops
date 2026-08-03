import {
  AckPolicy, DeliverPolicy, ReplayPolicy, connect,
  nanos,
  type JsMsg, type Consumer, type ConsumerInfo, type JetStreamManager, type NatsConnection,
} from 'nats';
import type { DynamicPrintService } from '../../services/dynamic-print.service.js';
import type { IntakeAttemptRepositoryPort } from '@printerops/domain';
import type { IntakeOutcomeCallbackService } from '../../services/intake-outcome-callback.service.js';
import {
  handlePrintIntakeMessage,
  redactNatsUrl,
  type PrintIntakeConfig,
  type PrintIntakeLogger,
} from './print-intake.js';

export type NatsRuntimeState =
  | 'DISABLED'
  | 'CONFIGURED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'DISCONNECTED'
  | 'ERROR';

export interface NatsRuntimeStatus {
  enabled: boolean;
  state: NatsRuntimeState;
  connected: boolean;
  intakeReady: boolean;
  callbackPublishReady: boolean;
  streamReady: boolean;
  consumerReady: boolean;
  consumerAction?: ConsumerAction;
  setupGeneration: number;
  setupInFlight: boolean;
  consumeLoopActive: boolean;
  clientId?: string;
  subject?: string;
  stream?: string;
  durable?: string;
  server?: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  lastErrorCode?: string;
  lastErrorStage?: string;
  lastErrorMessage?: string;
}

export class NatsRetryableError extends Error {
  readonly code = 'NATS_DISCONNECTED';
  readonly retryable = true;
  constructor(message = 'NATS transport is not connected') {
    super(message);
    this.name = 'NatsRetryableError';
  }
}

/**
 * No JetStream stream covers the subject a callback was published to.
 *
 * Retryable on purpose: the usual cause is that the receiving side has not
 * provisioned its stream yet, which an operator fixes without PrintOps
 * restarting. PrintOps deliberately does not create the stream itself — see
 * `docs/architecture/result-callbacks.md` on stream ownership.
 */
export class NatsNoStreamError extends Error {
  readonly code = 'NATS_NO_STREAM';
  readonly retryable = true;
  constructor(subject: string) {
    super(
      `No JetStream stream is configured for subject '${subject}'. `
      + 'At-least-once delivery needs the receiving environment to own a stream that captures it, '
      + 'or set PRINTOPS_CALLBACK_NATS_MODE=CORE to accept best-effort delivery instead.',
    );
    this.name = 'NatsNoStreamError';
  }
}

/** A JetStream publish acknowledgement, or the fact that there wasn't one. */
export interface NatsPublishAck {
  acknowledged: boolean;
  stream?: string;
  sequence?: number;
  /** The broker recognised `Nats-Msg-Id` and stored nothing new. */
  duplicate?: boolean;
}

function isNoRespondersError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | undefined;
  return value?.code === '503'
    || value?.code === 503
    || value?.code === 'NO_RESPONDERS'
    || (typeof value?.message === 'string' && /no responders|no stream response|503/i.test(value.message));
}

function errorDetails(error: unknown): { code?: string; message: string } {
  const value = error as { code?: string; message?: string } | undefined;
  return {
    code: typeof value?.code === 'string' ? value.code : undefined,
    message: value?.message ?? String(error),
  };
}

export interface ConsumerConfigDifference { field: string; expected: unknown; actual: unknown; }
export class ConsumerConfigConflictError extends Error {
  readonly code = 'CONSUMER_CONFIG_CONFLICT';
  constructor(readonly stream: string, readonly durable: string, readonly differences: ConsumerConfigDifference[]) {
    const detail = differences
      .map(({ field, expected, actual }) => `${field}: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`)
      .join('; ');
    super(
      `Consumer configuration conflicts for ${stream}/${durable}: ${detail}. `
      + 'Align the configured subject prefix with the existing durable, or use a new client ID. '
      + 'PrintOps will not delete or retarget an existing consumer automatically.',
    );
    this.name = 'ConsumerConfigConflictError';
  }
}
export type ConsumerAction = 'CREATED' | 'REUSED' | 'UPDATED';
const consumerDefaults = { ack_policy: AckPolicy.Explicit, deliver_policy: DeliverPolicy.All, replay_policy: ReplayPolicy.Instant, ack_wait: nanos(30_000) };
function isMissingConsumer(error: unknown): boolean {
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
function consumerDifferences(info: ConsumerInfo, cfg: PrintIntakeConfig): ConsumerConfigDifference[] {
  const actual = info.config;
  const expected = { durable_name: cfg.durable, filter_subject: cfg.subject, ack_policy: consumerDefaults.ack_policy, deliver_policy: consumerDefaults.deliver_policy, replay_policy: consumerDefaults.replay_policy, max_deliver: cfg.maxDeliver, ack_wait: consumerDefaults.ack_wait, deliver_subject: '', deliver_group: '' };
  const normalized = { durable_name: actual.durable_name ?? actual.name ?? cfg.durable, filter_subject: actual.filter_subject ?? '', ack_policy: actual.ack_policy ?? consumerDefaults.ack_policy, deliver_policy: actual.deliver_policy ?? consumerDefaults.deliver_policy, replay_policy: actual.replay_policy ?? consumerDefaults.replay_policy, max_deliver: actual.max_deliver ?? -1, ack_wait: actual.ack_wait === undefined ? consumerDefaults.ack_wait : Number(actual.ack_wait), deliver_subject: actual.deliver_subject ?? '', deliver_group: actual.deliver_group ?? '' };
  return (Object.keys(expected) as Array<keyof typeof expected>).filter((field) => normalized[field] !== expected[field]).map((field) => ({ field, expected: expected[field], actual: normalized[field] }));
}
export function assertPrintIntakeConsumerCompatible(info: ConsumerInfo, cfg: PrintIntakeConfig): ConsumerConfigDifference[] {
  const differences = consumerDifferences(info, cfg);
  const incompatible = differences.filter(({ field }) => ['durable_name', 'filter_subject', 'ack_policy', 'deliver_policy', 'replay_policy', 'deliver_subject', 'deliver_group'].includes(field));
  if (incompatible.length > 0) throw new ConsumerConfigConflictError(cfg.stream, cfg.durable, incompatible);
  return differences;
}
export async function ensurePrintIntakeConsumer(jsm: JetStreamManager, cfg: PrintIntakeConfig): Promise<{ consumer: Consumer; action: ConsumerAction }> {
  let existing: ConsumerInfo | undefined;
  try { existing = await jsm.consumers.info(cfg.stream, cfg.durable); } catch (error) { if (!isMissingConsumer(error)) throw error; }
  if (!existing) {
    try {
      await jsm.consumers.add(cfg.stream, { durable_name: cfg.durable, ack_policy: consumerDefaults.ack_policy, deliver_policy: consumerDefaults.deliver_policy, replay_policy: consumerDefaults.replay_policy, filter_subject: cfg.subject, max_deliver: cfg.maxDeliver, ack_wait: consumerDefaults.ack_wait });
      return { consumer: await jsm.jetstream().consumers.get(cfg.stream, cfg.durable), action: 'CREATED' };
    } catch (error) {
      if (!isConsumerCreateRace(error)) throw error;
      existing = await jsm.consumers.info(cfg.stream, cfg.durable);
    }
  }
  const differences = assertPrintIntakeConsumerCompatible(existing!, cfg);
  const mutable = differences.filter(({ field }) => ['max_deliver', 'ack_wait'].includes(field));
  if (mutable.length > 0) {
    await jsm.consumers.update(cfg.stream, cfg.durable, { max_deliver: cfg.maxDeliver, ack_wait: consumerDefaults.ack_wait });
    return { consumer: await jsm.jetstream().consumers.get(cfg.stream, cfg.durable), action: 'UPDATED' };
  }
  return { consumer: await jsm.jetstream().consumers.get(cfg.stream, cfg.durable), action: 'REUSED' };
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NatsConnectionManager {
  private connection?: NatsConnection;
  private stopRequested = false;
  private runPromise?: Promise<void>;
  private status: NatsRuntimeStatus;
  private messages?: AsyncIterable<JsMsg> & { close?: () => Promise<void | Error> };

  constructor(
    private readonly cfg: PrintIntakeConfig | undefined,
    private readonly deps: {
      dynamicPrint: DynamicPrintService;
      logger: PrintIntakeLogger;
      intakeLog?: IntakeAttemptRepositoryPort;
      intakeCallbacks?: IntakeOutcomeCallbackService;
    },
  ) {
    this.status = cfg
      ? {
          enabled: true,
          state: 'CONFIGURED',
          connected: false,
          intakeReady: false,
          callbackPublishReady: false,
          streamReady: false,
          consumerReady: false,
          setupGeneration: 0,
          setupInFlight: false,
          consumeLoopActive: false,
          clientId: cfg.clientId,
          subject: cfg.subject,
          stream: cfg.stream,
          durable: cfg.durable,
          server: redactNatsUrl(cfg.url),
        }
      : {
          enabled: false,
          state: 'DISABLED',
          connected: false,
          intakeReady: false,
          callbackPublishReady: false,
          streamReady: false,
          consumerReady: false,
          setupGeneration: 0,
          setupInFlight: false,
          consumeLoopActive: false,
        };
  }

  getStatus(): NatsRuntimeStatus {
    return { ...this.status };
  }

  setIntakeCallbacks(service: IntakeOutcomeCallbackService): void {
    this.deps.intakeCallbacks = service;
  }

  start(): void {
    if (!this.cfg || this.runPromise) return;
    this.stopRequested = false;
    this.runPromise = this.run().catch((error) => {
      this.setError(error, 'NATS manager stopped unexpectedly');
    });
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.messages?.close) await this.messages.close().catch(() => {});
    await this.connection?.drain().catch(() => {});
    await this.runPromise?.catch(() => {});
    this.connection = undefined;
    this.runPromise = undefined;
  }

  publish(subject: string, payload: Record<string, unknown>): void {
    if (!this.connection || this.connection.isClosed() || !this.status.callbackPublishReady) {
      throw new NatsRetryableError();
    }
    this.connection.publish(subject, JSON.stringify(payload));
  }

  /**
   * Publish and wait for a JetStream acknowledgement.
   *
   * This is what makes a NATS result callback at-least-once rather than
   * best-effort: the returned PubAck proves the broker persisted the message,
   * which a Core publish never does. `msgId` is sent as `Nats-Msg-Id`, so the
   * broker's own duplicate window collapses our retries into one stored
   * message — the same `event_id` the receiver dedupes on.
   *
   * PrintOps does not create the stream. If none captures the subject the
   * publish fails loudly (`NatsNoStreamError`) rather than silently degrading
   * to a Core publish that would report a guarantee it did not obtain.
   */
  async publishJetStream(
    subject: string,
    payload: Record<string, unknown>,
    opts: { msgId: string; timeoutMs?: number },
  ): Promise<NatsPublishAck> {
    if (!this.connection || this.connection.isClosed() || !this.status.callbackPublishReady) {
      throw new NatsRetryableError();
    }
    try {
      const ack = await this.connection.jetstream().publish(subject, JSON.stringify(payload), {
        msgID: opts.msgId,
        timeout: opts.timeoutMs ?? 10_000,
      });
      return { acknowledged: true, stream: ack.stream, sequence: ack.seq, duplicate: ack.duplicate };
    } catch (error) {
      if (isNoRespondersError(error)) throw new NatsNoStreamError(subject);
      throw error;
    }
  }

  async testConnection(): Promise<{ ok: boolean; stage: string; code?: string; message: string; durationMs: number }> {
    const started = Date.now();
    if (!this.cfg) return { ok: false, stage: 'URL_VALIDATION', code: 'NATS_DISABLED', message: 'NATS is disabled', durationMs: 0 };
    let nc: NatsConnection | undefined;
    try {
      nc = await connect({ servers: this.cfg.url, timeout: 3_000, waitOnFirstConnect: true, name: `printops-test-${this.cfg.clientId}` });
      const jsm = await nc.jetstreamManager();
      let streamReady = false;
      try {
        await jsm.streams.info(this.cfg.stream);
        streamReady = true;
      } catch (error) {
        const details = errorDetails(error);
        return { ok: false, stage: 'STREAM_LOOKUP', code: details.code ?? 'STREAM_NOT_FOUND', message: details.message, durationMs: Date.now() - started };
      }
      if (streamReady) {
        try {
          const info = await jsm.consumers.info(this.cfg.stream, this.cfg.durable);
          assertPrintIntakeConsumerCompatible(info, this.cfg);
        } catch (error) {
          if (!isMissingConsumer(error)) {
            const details = errorDetails(error);
            return {
              ok: false,
              stage: 'CONSUMER_COMPATIBILITY',
              code: details.code ?? 'CONSUMER_CONFIG_CONFLICT',
              message: details.message,
              durationMs: Date.now() - started,
            };
          }
        }
      }
      return { ok: true, stage: 'READY', message: 'NATS and JetStream are ready', durationMs: Date.now() - started };
    } catch (error) {
      const details = errorDetails(error);
      return { ok: false, stage: 'TCP_CONNECT', code: details.code ?? 'CONNECTION_FAILED', message: details.message, durationMs: Date.now() - started };
    } finally {
      await nc?.drain().catch(() => {});
    }
  }

  private async run(): Promise<void> {
    let retry = 0;
    while (!this.stopRequested && this.cfg) {
      retry++;
      const attemptedAt = new Date().toISOString();
      this.status = {
        ...this.status,
        state: 'CONNECTING',
        lastAttemptAt: attemptedAt,
        nextRetryAt: undefined,
        lastErrorStage: 'TCP_CONNECT',
      };
      try {
        const nc = await connect({ servers: this.cfg.url, timeout: 3_000, waitOnFirstConnect: true, maxReconnectAttempts: 0, name: `printops-${this.cfg.clientId}` });
        this.connection = nc;
        this.status = {
          ...this.status,
          state: 'CONNECTED',
          connected: true,
          callbackPublishReady: true,
          lastConnectedAt: new Date().toISOString(),
          lastErrorCode: undefined,
          lastErrorStage: undefined,
          lastErrorMessage: undefined,
        };
        this.deps.logger.info({ server: redactNatsUrl(this.cfg.url), clientId: this.cfg.clientId }, 'NATS core connection ready');
        this.status = { ...this.status, lastErrorStage: 'JETSTREAM_SETUP' };
        await this.setupConsumer(nc);
        retry = 0;
        await nc.closed();
        if (!this.stopRequested) this.setDisconnected('NATS connection closed');
      } catch (error) {
        if (!this.stopRequested) this.setError(error, 'NATS connection or JetStream setup failed');
      } finally {
        if (this.messages?.close) await this.messages.close().catch(() => {});
        await this.connection?.drain().catch(() => {});
        this.connection = undefined;
        this.messages = undefined;
        this.status = { ...this.status, consumeLoopActive: false, setupInFlight: false };
        if (!this.stopRequested) {
          const delay = Math.min(30_000, 500 * 2 ** Math.min(retry - 1, 6)) + Math.floor(Math.random() * 250);
          this.status = { ...this.status, connected: false, callbackPublishReady: false, intakeReady: false, consumerReady: false, streamReady: false, nextRetryAt: new Date(Date.now() + delay).toISOString() };
          await sleep(delay);
        }
      }
    }
  }

  private async setupConsumer(nc: NatsConnection): Promise<void> {
    if (!this.cfg) return;
    const generation = this.status.setupGeneration + 1;
    this.status = { ...this.status, setupGeneration: generation, setupInFlight: true };
    const jsm = await nc.jetstreamManager();
    const ensured = await ensurePrintIntakeConsumer(jsm, this.cfg);
    this.status = { ...this.status, consumerAction: ensured.action, setupInFlight: false };
    if (this.stopRequested) return;
    const consumer = await nc.jetstream().consumers.get(this.cfg.stream, this.cfg.durable);
    const messages = await consumer.consume();
    this.messages = messages;
    this.status = {
      ...this.status,
      consumeLoopActive: true,
      streamReady: true,
      consumerReady: true,
      intakeReady: true,
      lastErrorCode: undefined,
      lastErrorStage: undefined,
      lastErrorMessage: undefined,
    };
    this.deps.logger.info({ stream: this.cfg.stream, subject: this.cfg.subject, durable: this.cfg.durable }, 'NATS print-intake consumer ready');
    void (async () => {
      try {
        for await (const msg of messages) await handlePrintIntakeMessage(msg, this.deps, nc, this.cfg!);
      } catch (error) {
        this.status = { ...this.status, consumeLoopActive: false };
        if (!this.stopRequested) this.deps.logger.warn({ error: errorDetails(error).message }, 'NATS intake consume loop ended; reconnecting');
      }
    })();
  }

  private setDisconnected(message: string): void {
    this.status = { ...this.status, state: 'DISCONNECTED', connected: false, intakeReady: false, callbackPublishReady: false, consumerReady: false, streamReady: false, lastDisconnectedAt: new Date().toISOString(), lastErrorCode: 'CONNECTION_CLOSED', lastErrorStage: 'CONNECTION_CLOSED', lastErrorMessage: message };
  }

  private setError(error: unknown, context: string): void {
    const details = errorDetails(error);
    this.status = { ...this.status, state: 'DEGRADED', connected: false, intakeReady: false, callbackPublishReady: false, consumerReady: false, streamReady: false, lastErrorCode: details.code ?? 'NATS_ERROR', lastErrorMessage: `${context}: ${details.message}` };
    this.deps.logger.warn({ server: this.cfg ? redactNatsUrl(this.cfg.url) : undefined, code: details.code, error: details.message }, context);
  }
}
