/**
 * NATS JetStream print-intake consumer.
 *
 * This is the second transport (alongside POST /api/v1/printer/:code_template/
 * :code_profile) for the dynamic print flow. A caller publishes a JSON envelope
 * to the intake subject; this consumer resolves the printer and creates the job
 * through the SAME DynamicPrintService the HTTP endpoint uses, so idempotency,
 * trace, and audit are identical across transports.
 *
 * The consumer is optional and self-contained: it is started only when NATS_URL
 * is set. It does NOT create the stream — the publisher's environment owns the
 * stream (in this deployment, medisync-core ensures the MEDISYNC stream). Only a
 * durable consumer is created, so a missing stream fails soft (logged) and never
 * blocks the HTTP API.
 */

import {
  connect,
  type NatsConnection,
  type JsMsg,
  AckPolicy,
  nanos,
} from 'nats';
import type { DynamicPrintService, DynamicPrintRequest } from '../../services/dynamic-print.service.js';
import type { IntakeAttemptRepositoryPort } from '@printerops/domain';
import { AppError } from '@printerops/shared';
import type { IntakeOutcomeCallbackService } from '../../services/intake-outcome-callback.service.js';

export interface PrintIntakeLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface PrintIntakeConfig {
  url: string;
  stream: string;
  /** Immutable logical identifier assigned to this local PrintOps deployment. */
  clientId: string;
  subject: string;
  durable: string;
  dlqPrefix: string;
  maxDeliver: number;
}

/** Reads NATS print-intake config from the environment. Returns undefined when
 * NATS_URL is not set (feature disabled). */
export function printIntakeConfigFromEnv(env = process.env): PrintIntakeConfig | undefined {
  const url = env['PRINTOPS_NATS_URL'] ?? env['NATS_URL'];
  if (!url) return undefined;
  const clientId = env['PRINTOPS_NATS_CLIENT_ID']?.trim();
  if (!clientId) {
    throw new Error('PRINTOPS_NATS_CLIENT_ID is required when NATS intake is enabled');
  }
  assertNatsToken('PRINTOPS_NATS_CLIENT_ID', clientId);

  // Every local PrintOps install owns exactly one subject token. Never accept a
  // complete unscoped subject here: giving each install a different durable on
  // a shared subject changes a race into cross-site fan-out and duplicate prints.
  const subjectPrefix = env['PRINTOPS_NATS_SUBJECT_PREFIX']?.trim() || 'medisync.print.intake';
  assertNatsSubjectPrefix('PRINTOPS_NATS_SUBJECT_PREFIX', subjectPrefix, clientId);
  const durable = env['PRINTOPS_NATS_DURABLE']?.trim() || `printops-print-intake-${clientId}`;
  if (!durable.endsWith(`-${clientId}`)) {
    throw new Error(`PRINTOPS_NATS_DURABLE must end with '-${clientId}' to remain client-scoped`);
  }
  assertNatsToken('PRINTOPS_NATS_DURABLE', durable);
  return {
    url,
    stream: env['PRINTOPS_NATS_STREAM'] ?? 'MEDISYNC',
    clientId,
    subject: `${subjectPrefix}.${clientId}`,
    durable,
    dlqPrefix: env['PRINTOPS_NATS_DLQ_PREFIX'] ?? 'medisync.dlq.',
    maxDeliver: Number(env['PRINTOPS_NATS_MAX_DELIVER'] ?? 5),
  };
}

/** Strips credentials from a NATS URL so it is safe to show in the dashboard. */
export function redactNatsUrl(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//***@');
}

/**
 * PrintIntakeEnvelope is the wire contract published by callers. It is a
 * transport-neutral superset of the HTTP body: code_template / code_profile
 * identify the binding, printer_code is an optional override.
 */
interface PrintIntakeEnvelope {
  /** Must match the client token encoded in the NATS subject. */
  target_client_id?: string;
  request_id?: string;
  source_system?: string;
  source_reference?: string;
  code_template?: string;
  code_profile?: string;
  printer_code?: string;
  payload?: Record<string, unknown>;
  copies?: number;
  priority?: DynamicPrintRequest['priority'];
  metadata?: Record<string, unknown>;
  /**
   * OPTIONAL reference to a configured WebhookEndpoint that should receive this
   * job's terminal print result (HTTP and/or NATS, per that endpoint's config).
   *
   * Backward compatible by construction: existing publishers that never send it
   * behave exactly as before and get no result callback. This is the field that
   * makes NATS-originated prints reportable at all — the envelope previously
   * carried no callback reference of any kind, so `NATS -> print -> callback`
   * was structurally impossible regardless of endpoint configuration.
   *
   * The endpoint must exist, be enabled, and belong to `source_system`; a bad
   * reference is rejected BEFORE anything prints (see DynamicPrintService).
   */
  endpoint_code?: string;
}

/**
 * Starts the consumer. Returns a stop() that drains in-flight handlers and
 * closes the connection. Throws only on the initial connect/consumer setup;
 * callers may treat that as non-fatal.
 */
export interface PrintIntakeHandle {
  /** Drains in-flight handlers and closes the connection. */
  stop(): Promise<void>;
  /** Publish a JSON payload to an arbitrary subject on this connection. */
  publishTo(subject: string, payload: Record<string, unknown>): void;
}

export async function startPrintIntakeConsumer(
  deps: { dynamicPrint: DynamicPrintService; logger: PrintIntakeLogger; intakeLog?: IntakeAttemptRepositoryPort; intakeCallbacks?: IntakeOutcomeCallbackService },
  cfg: PrintIntakeConfig,
): Promise<PrintIntakeHandle> {
  // The stream is owned by the publisher's environment and may not exist yet on
  // a cold boot (print_ops can start before medisync-core ensures MEDISYNC).
  // Retry setup a bounded number of times so a boot-order race self-heals
  // instead of leaving the consumer permanently dead until a restart.
  const maxAttempts = 10;
  const retryDelayMs = 3_000;

  let nc: NatsConnection | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!nc) nc = await connect({ servers: cfg.url, name: 'printops-api' });
      const jsm = await nc.jetstreamManager();
      // Idempotent durable consumer creation. Requires the stream to exist.
      await jsm.consumers.add(cfg.stream, {
        durable_name: cfg.durable,
        ack_policy: AckPolicy.Explicit,
        filter_subject: cfg.subject,
        max_deliver: cfg.maxDeliver,
        ack_wait: nanos(30_000),
      });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      deps.logger.warn(
        { attempt, maxAttempts, error: errMsg(err), stream: cfg.stream },
        'print-intake consumer setup failed; retrying',
      );
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  if (lastErr) {
    if (nc) await nc.close().catch(() => {});
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  const connection = nc!;
  const js = connection.jetstream();
  const consumer = await js.consumers.get(cfg.stream, cfg.durable);
  const messages = await consumer.consume();

  deps.logger.info(
    { stream: cfg.stream, subject: cfg.subject, durable: cfg.durable },
    'print-intake consumer started',
  );

  // Drive the consume loop in the background; errors on the iterator surface as
  // reconnect/close events handled by nats.js.
  void (async () => {
    for await (const msg of messages) {
      await handlePrintIntakeMessage(msg, deps, connection, cfg);
    }
  })();

  return {
    async stop() {
      try {
        await messages.close();
      } catch {
        // best-effort
      }
      await connection.drain();
    },
    publishTo(subject: string, payload: Record<string, unknown>): void {
      try {
        connection.publish(subject, JSON.stringify(payload));
      } catch (err) {
        deps.logger.error({ subject, error: errMsg(err) }, 'print-intake callback publish failed');
      }
    },
  };
}

/**
 * Exported for unit testing. Processes a single NATS JetStream message by
 * validating the envelope, resolving the printer via DynamicPrintService,
 * and acking / naking / dead-lettering the message accordingly.
 */
export async function handlePrintIntakeMessage(
  msg: JsMsg,
  deps: { dynamicPrint: DynamicPrintService; logger: PrintIntakeLogger; intakeLog?: IntakeAttemptRepositoryPort; intakeCallbacks?: IntakeOutcomeCallbackService },
  nc: NatsConnection,
  cfg: PrintIntakeConfig,
): Promise<void> {
  // Records a transport-level rejection — one that happens BEFORE the envelope
  // ever reaches DynamicPrintService/AcceptExternalJobService (which record
  // their own outcomes). Keeping this separate avoids double-logging the same
  // attempt once it's past these checks.
  const recordRejected = (reason: string, env?: PrintIntakeEnvelope): void => {
    void deps.intakeLog?.record({
      source: 'nats',
      outcome: 'rejected',
      reason,
      requestId: env?.request_id,
      sourceSystem: env?.source_system,
      sourceReference: env?.source_reference,
      codeTemplate: env?.code_template,
      codeProfile: env?.code_profile,
      printerCode: env?.printer_code,
      clientId: env?.target_client_id ?? cfg.clientId,
      subject: msg.subject,
    });
  };
  const notifyRejected = async (
    env: PrintIntakeEnvelope,
    stage: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> => {
    await deps.intakeCallbacks?.notifyRejected({
      endpointCode: env.endpoint_code,
      sourceSystem: env.source_system,
      requestId: env.request_id,
      sourceReference: env.source_reference,
      intakeTransport: 'NATS',
      stage,
      errorCode,
      errorMessage,
      intakePayload: env.payload ?? {},
    }).catch(() => false);
  };

  let env: PrintIntakeEnvelope;
  try {
    env = msg.json<PrintIntakeEnvelope>();
  } catch (err) {
    const reason = `malformed json: ${errMsg(err)}`;
    recordRejected(reason);
    await deadLetter(msg, nc, cfg, deps.logger, reason);
    return;
  }

  if (!env.request_id || !env.source_system) {
    const reason = 'request_id and source_system are required';
    recordRejected(reason, env);
    await notifyRejected(env, 'VALIDATION', 'VALIDATION_ERROR', reason);
    await deadLetter(msg, nc, cfg, deps.logger, reason);
    return;
  }
  if (env.target_client_id !== cfg.clientId) {
    const reason = 'target_client_id does not match this PrintOps client';
    recordRejected(reason, env);
    await notifyRejected(env, 'ROUTING', 'TARGET_CLIENT_MISMATCH', reason);
    await deadLetter(msg, nc, cfg, deps.logger, reason);
    return;
  }
  if (msg.subject !== cfg.subject) {
    const reason = 'unexpected intake subject for this PrintOps client';
    recordRejected(reason, env);
    await notifyRejected(env, 'ROUTING', 'UNEXPECTED_SUBJECT', reason);
    await deadLetter(msg, nc, cfg, deps.logger, reason);
    return;
  }
  if (!env.printer_code && (!env.code_template || !env.code_profile)) {
    const reason = 'code_template + code_profile (or printer_code) are required';
    recordRejected(reason, env);
    await notifyRejected(env, 'VALIDATION', 'VALIDATION_ERROR', reason);
    await deadLetter(msg, nc, cfg, deps.logger, reason);
    return;
  }

  try {
    const result = await deps.dynamicPrint.submit(
      {
        request_id: env.request_id,
        source_system: env.source_system,
        source_reference: env.source_reference,
        code_template: env.code_template ?? '',
        code_profile: env.code_profile ?? '',
        printer_code: env.printer_code,
        payload: env.payload ?? {},
        copies: env.copies,
        priority: env.priority,
        endpoint_code: env.endpoint_code,
        metadata: {
          ...(env.metadata ?? {}),
          nats: {
            clientId: cfg.clientId,
            subject: msg.subject,
            streamSequence: msg.info.streamSequence,
          },
        },
      },
      `nats:${env.source_system}:client:${cfg.clientId}`,
      { source: 'nats' },
    );
    deps.logger.info(
      { request_id: env.request_id, print_job_id: result.print_job_id, duplicate: result.duplicate },
      'print-intake job accepted',
    );
    msg.ack();
  } catch (err) {
    // A 4xx AppError (bad template/profile/binding) is a poison message: it will
    // never succeed on redelivery, so dead-letter it. Everything else is treated
    // as transient and NAKed for redelivery up to max_deliver.
    if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
      await notifyRejected(env, 'INTAKE', err.code, err.message);
      await deadLetter(msg, nc, cfg, deps.logger, `${err.code}: ${err.message}`);
      return;
    }
    if (msg.info.redeliveryCount + 1 >= cfg.maxDeliver) {
      const message = errMsg(err);
      await notifyRejected(env, 'INTAKE_RETRIES_EXHAUSTED', 'INTAKE_FAILED', message);
      await deadLetter(msg, nc, cfg, deps.logger, `INTAKE_FAILED: ${message}`);
      return;
    }
    deps.logger.warn(
      { request_id: env.request_id, error: errMsg(err), redeliveries: msg.info.redeliveryCount },
      'print-intake submit failed; will retry',
    );
    msg.nak();
  }
}

async function deadLetter(
  msg: JsMsg,
  nc: NatsConnection,
  cfg: PrintIntakeConfig,
  logger: PrintIntakeLogger,
  reason: string,
): Promise<void> {
  logger.warn({ reason, subject: msg.subject }, 'print-intake dead-lettering message');
  try {
    nc.publish(cfg.dlqPrefix + msg.subject, msg.data);
  } catch (err) {
    // If DLQ publish fails, NAK so the message is not silently lost.
    logger.error({ error: errMsg(err) }, 'print-intake DLQ publish failed; NAKing');
    msg.nak();
    return;
  }
  msg.term();
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A client id and a durable must be a single literal NATS token. */
function assertNatsToken(name: string, value: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must contain only letters, digits, '_' or '-'`);
  }
}

/** A prefix may have multiple literal tokens, but never wildcards or a client id already appended. */
function assertNatsSubjectPrefix(name: string, value: string, clientId: string): void {
  const tokens = value.split('.');
  if (tokens.length === 0 || tokens.some((token) => !/^[A-Za-z0-9_-]+$/.test(token))) {
    throw new Error(`${name} must be a concrete NATS subject prefix without wildcards`);
  }
  if (tokens[tokens.length - 1] === clientId) {
    throw new Error(`${name} must not already include PRINTOPS_NATS_CLIENT_ID`);
  }
}
