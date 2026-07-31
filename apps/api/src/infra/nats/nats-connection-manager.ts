import {
  AckPolicy,
  connect,
  nanos,
  type JsMsg,
  type NatsConnection,
} from 'nats';
import type { DynamicPrintService } from '../../services/dynamic-print.service.js';
import type { IntakeAttemptRepositoryPort } from '@printerops/domain';
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

function errorDetails(error: unknown): { code?: string; message: string } {
  const value = error as { code?: string; message?: string } | undefined;
  return {
    code: typeof value?.code === 'string' ? value.code : undefined,
    message: value?.message ?? String(error),
  };
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
        };
  }

  getStatus(): NatsRuntimeStatus {
    return { ...this.status };
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
        await jsm.consumers.add(this.cfg.stream, { durable_name: this.cfg.durable, ack_policy: AckPolicy.Explicit, filter_subject: this.cfg.subject, max_deliver: this.cfg.maxDeliver, ack_wait: nanos(30_000) });
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
      this.status = { ...this.status, state: 'CONNECTING', lastAttemptAt: attemptedAt, nextRetryAt: undefined };
      try {
        const nc = await connect({ servers: this.cfg.url, timeout: 3_000, waitOnFirstConnect: true, maxReconnectAttempts: 0, name: `printops-${this.cfg.clientId}` });
        this.connection = nc;
        this.status = { ...this.status, state: 'CONNECTED', connected: true, callbackPublishReady: true, lastConnectedAt: new Date().toISOString(), lastErrorCode: undefined, lastErrorMessage: undefined };
        this.deps.logger.info({ server: redactNatsUrl(this.cfg.url), clientId: this.cfg.clientId }, 'NATS core connection ready');
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
    const jsm = await nc.jetstreamManager();
    await jsm.consumers.add(this.cfg.stream, { durable_name: this.cfg.durable, ack_policy: AckPolicy.Explicit, filter_subject: this.cfg.subject, max_deliver: this.cfg.maxDeliver, ack_wait: nanos(30_000) });
    const consumer = await nc.jetstream().consumers.get(this.cfg.stream, this.cfg.durable);
    const messages = await consumer.consume();
    this.messages = messages;
    this.status = { ...this.status, streamReady: true, consumerReady: true, intakeReady: true };
    this.deps.logger.info({ stream: this.cfg.stream, subject: this.cfg.subject, durable: this.cfg.durable }, 'NATS print-intake consumer ready');
    void (async () => {
      try {
        for await (const msg of messages) await handlePrintIntakeMessage(msg, this.deps, nc, this.cfg!);
      } catch (error) {
        if (!this.stopRequested) this.deps.logger.warn({ error: errorDetails(error).message }, 'NATS intake consume loop ended; reconnecting');
      }
    })();
  }

  private setDisconnected(message: string): void {
    this.status = { ...this.status, state: 'DISCONNECTED', connected: false, intakeReady: false, callbackPublishReady: false, consumerReady: false, streamReady: false, lastDisconnectedAt: new Date().toISOString(), lastErrorCode: 'CONNECTION_CLOSED', lastErrorMessage: message };
  }

  private setError(error: unknown, context: string): void {
    const details = errorDetails(error);
    this.status = { ...this.status, state: 'DEGRADED', connected: false, intakeReady: false, callbackPublishReady: false, consumerReady: false, streamReady: false, lastErrorCode: details.code ?? 'NATS_ERROR', lastErrorMessage: `${context}: ${details.message}` };
    this.deps.logger.warn({ server: this.cfg ? redactNatsUrl(this.cfg.url) : undefined, code: details.code, error: details.message }, context);
  }
}
