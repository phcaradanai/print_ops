import type {
  AnyDomainEvent,
  CallbackDelivery,
  CallbackDeliveryRepositoryPort,
  CallbackTransport,
  EventBusPort,
  Job,
  JobCallbackIntent,
  JobRepositoryPort,
  PrintJobTerminal,
  WebhookCallbackAttemptRepositoryPort,
} from '@printerops/domain';
import { readCallbackIntent } from '@printerops/domain';
import {
  DEFAULT_RETRY_POLICY,
  classifyHttpStatus,
  classifyTransportError,
  nextBackoffMs,
  type RetryPolicy,
} from './callback-retry-policy.js';
import { assertCallbackUrlAllowed, CallbackUrlRejected, callbackUrlPolicyFromEnv, type CallbackUrlPolicy } from '../infra/http/callback-url-guard.js';
import { callbackSigningSecret, CALLBACK_SIGNATURE_VERSION, signCallback } from './callback-signing.js';

/** Wire-format version of the result-callback contract. Bump on a breaking
 *  change to the payload shape; receivers should switch on it. */
export const RESULT_CALLBACK_VERSION = 1;

export const RESULT_EVENT_TYPE = 'print.job.completed';

export interface CallbackHttpResponse {
  status: number;
  /** First few hundred characters of the response body, for the operator. */
  bodyExcerpt?: string;
}

/** HTTP sender contract. Resolves for ANY response (including 5xx) and rejects
 *  only when no response came back at all — the dispatcher needs the status code
 *  to decide retryable vs permanent, which a bare throw cannot carry. */
export type CallbackHttpSender = (
  url: string,
  body: Record<string, unknown>,
  opts: { timeoutMs: number; headers: Record<string, string> },
) => Promise<CallbackHttpResponse>;

export type CallbackNatsSender = (subject: string, body: Record<string, unknown>) => void | Promise<void>;

export interface DispatcherLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface ResultCallbackDispatcherDeps {
  jobs: JobRepositoryPort;
  deliveries: CallbackDeliveryRepositoryPort;
  http?: CallbackHttpSender;
  nats?: CallbackNatsSender;
  attemptLog?: WebhookCallbackAttemptRepositoryPort;
  logger: DispatcherLogger;
  policy?: RetryPolicy;
  urlPolicy?: CallbackUrlPolicy;
  /** Injectable clock — the retry sweep must be drivable from a test without
   *  waiting 12 real minutes. */
  now?: () => Date;
  random?: () => number;
}

/**
 * The production subscriber for terminal print results.
 *
 * Before this existed, `InMemoryEventBus.subscribe()` had no non-test caller:
 * every domain event was published into the void, and the only callback that
 * ever fired did so at ACCEPTANCE time carrying `status: "QUEUED"` — which is
 * not a print result at all. This class is what closes that loop:
 *
 *   terminal event -> resolve persisted intent -> delivery record
 *     -> transport -> outcome persisted -> retry scheduled when applicable
 *
 * It never throws into the print path. A callback that cannot be delivered is a
 * visible FAILED delivery, not a failed print.
 */
export class ResultCallbackDispatcher {
  private readonly policy: RetryPolicy;
  private readonly urlPolicy: CallbackUrlPolicy;
  private readonly now: () => Date;
  private readonly random: () => number;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: ResultCallbackDispatcherDeps) {
    this.policy = deps.policy ?? DEFAULT_RETRY_POLICY;
    this.urlPolicy = deps.urlPolicy ?? callbackUrlPolicyFromEnv();
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
  }

  /** Explicit, testable startup registration — this is the wiring that must not
   *  live only in test code. */
  register(bus: EventBusPort): void {
    bus.subscribe<PrintJobTerminal>('PrintJobTerminal', (event) => this.handleTerminal(event));
  }

  /** Periodic sweep for deliveries whose backoff has elapsed. Follows the same
   *  setInterval + unref + onClose shape as the SQLite retention sweep. */
  startRetryWorker(intervalMs = 5_000): () => void {
    this.sweepTimer = setInterval(() => {
      void this.sweep().catch((err: unknown) => {
        this.deps.logger.error({ err }, 'result callback retry sweep failed');
      });
    }, intervalMs);
    this.sweepTimer.unref?.();
    return () => this.stopRetryWorker();
  }

  stopRetryWorker(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  /** Deliver every due retry. Exposed so a test can advance the injected clock
   *  and call this directly instead of waiting on a timer. */
  async sweep(limit = 50): Promise<number> {
    const due = await this.deps.deliveries.findDue(this.now(), limit);
    for (const delivery of due) {
      await this.attempt(delivery.id);
    }
    return due.length;
  }

  /**
   * Recover deliveries left mid-flight by a crash.
   *
   * A process that died between `claim(... DELIVERING)` and writing the outcome
   * leaves a row nothing will ever pick up again: DELIVERING is not due, and the
   * sweep only looks at RETRY_SCHEDULED. Re-arm those at boot. Re-sending is the
   * right call — the receiver dedupes on `event_id`, and silently never
   * delivering a print result is the worse failure.
   */
  async recoverInFlight(): Promise<number> {
    const stuck = await this.deps.deliveries.findAll({ deliveryStatus: 'DELIVERING' });
    const pending = await this.deps.deliveries.findAll({ deliveryStatus: 'PENDING' });
    const now = this.now();
    let recovered = 0;
    for (const delivery of [...stuck, ...pending]) {
      await this.deps.deliveries.update(delivery.id, {
        deliveryStatus: 'RETRY_SCHEDULED',
        nextAttemptAt: now,
      });
      recovered += 1;
    }
    if (recovered > 0) {
      this.deps.logger.info({ recovered }, 're-armed callback deliveries left in flight by a previous process');
    }
    return recovered;
  }

  /** Subscriber entry point. Idempotent: the same terminal event delivered twice
   *  produces one delivery record and one callback. */
  async handleTerminal(event: PrintJobTerminal): Promise<void> {
    try {
      const job = await this.deps.jobs.findById(event.jobId);
      if (!job) {
        this.deps.logger.warn({ jobId: event.jobId }, 'terminal callback skipped: job not found');
        return;
      }
      const intent = readCallbackIntent(job.metadata);
      if (!intent || !intent.enabled) {
        // Not an error: most jobs have no callback configured, and an endpoint
        // with callbackOnPrintResult off is a deliberate operator choice.
        return;
      }

      const payload = buildResultCallbackPayload(event, job, intent);

      // Transport attempts are independent. A slow HTTP endpoint must not hold
      // a NATS result behind it, just as one job's callback must not hold the
      // callback for the next terminal job.
      await Promise.all(intent.transports.map(async (transport) => {
        const target = transport === 'HTTP' ? intent.httpUrl : intent.natsSubject;
        if (!target) return;

        const { delivery, created } = await this.deps.deliveries.createIfAbsent({
          eventId: event.eventId,
          printJobId: job.id,
          requestId: job.requestId,
          sourceSystem: job.sourceSystem,
          transport,
          target,
          trigger: 'PRINT_RESULT',
          deliveryStatus: 'PENDING',
          maxAttempts: this.policy.maxAttempts,
          printStatus: event.status,
          payload,
          endpointId: intent.endpointId,
          endpointCode: intent.endpointCode,
        });

        if (!created) {
          // Redelivered / replayed terminal event. The first record owns the
          // whole retry lifecycle; touching it here would restart a schedule or
          // re-send an already-delivered callback.
          this.deps.logger.info(
            { jobId: job.id, transport, deliveryId: delivery.id, deliveryStatus: delivery.deliveryStatus },
            'terminal callback already has a delivery record; not duplicating',
          );
          return;
        }

        await this.attempt(delivery.id);
      }));
    } catch (err) {
      // A callback failure must never surface as a print failure.
      this.deps.logger.error(
        { jobId: event.jobId, err },
        'result callback dispatch failed',
      );
    }
  }

  /** Run one delivery attempt. Safe to call concurrently: the conditional claim
   *  means only one caller proceeds. */
  async attempt(deliveryId: string): Promise<CallbackDelivery | undefined> {
    const startedAt = this.now();
    const claimed = await this.deps.deliveries.claim(deliveryId, ['PENDING', 'RETRY_SCHEDULED'], {
      deliveryStatus: 'DELIVERING',
      lastAttemptAt: startedAt,
      nextAttemptAt: undefined,
    });
    if (!claimed) return undefined;

    const attemptNumber = claimed.attemptCount + 1;
    const outcome = await this.send(claimed);
    const finishedAt = this.now();

    await this.recordAttempt(claimed, attemptNumber, outcome, finishedAt.getTime() - startedAt.getTime());

    if (outcome.success) {
      return this.deps.deliveries.update(deliveryId, {
        deliveryStatus: 'DELIVERED',
        attemptCount: attemptNumber,
        deliveredAt: finishedAt,
        guarantee: outcome.guarantee,
        lastHttpStatus: outcome.httpStatus,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        nextAttemptAt: undefined,
      });
    }

    const backoff =
      outcome.kind === 'PERMANENT'
        ? undefined
        : nextBackoffMs(attemptNumber, { ...this.policy, maxAttempts: claimed.maxAttempts }, this.random);

    if (backoff === undefined) {
      return this.deps.deliveries.update(deliveryId, {
        deliveryStatus: 'FAILED',
        attemptCount: attemptNumber,
        guarantee: outcome.guarantee,
        lastHttpStatus: outcome.httpStatus,
        lastErrorCode: outcome.errorCode,
        lastErrorMessage: outcome.errorMessage,
        nextAttemptAt: undefined,
      });
    }

    return this.deps.deliveries.update(deliveryId, {
      deliveryStatus: 'RETRY_SCHEDULED',
      attemptCount: attemptNumber,
      guarantee: outcome.guarantee,
      lastHttpStatus: outcome.httpStatus,
      lastErrorCode: outcome.errorCode,
      lastErrorMessage: outcome.errorMessage,
      nextAttemptAt: new Date(finishedAt.getTime() + backoff),
    });
  }

  private async send(delivery: CallbackDelivery): Promise<SendOutcome> {
    if (delivery.transport === 'HTTP') return this.sendHttp(delivery);
    return this.sendNats(delivery);
  }

  private async sendHttp(delivery: CallbackDelivery): Promise<SendOutcome> {
    if (!this.deps.http) {
      return { success: false, kind: 'RETRYABLE', errorCode: 'NO_HTTP_SENDER', errorMessage: 'no HTTP callback sender configured' };
    }
    try {
      // Re-checked on every attempt, not just at accept time: DNS can be
      // repointed at a blocked address between acceptance and a 10-minute retry.
      assertCallbackUrlAllowed(delivery.target, this.urlPolicy);
    } catch (err) {
      const code = err instanceof CallbackUrlRejected ? err.code : 'CALLBACK_URL_REJECTED';
      return {
        success: false,
        kind: classifyTransportError(code),
        errorCode: code,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const rawBody = JSON.stringify(delivery.payload);
      const intent = readCallbackIntent((await this.deps.jobs.findById(delivery.printJobId))?.metadata);
      const timestamp = Math.floor(this.now().getTime() / 1000).toString();
      const signingHeaders: Record<string, string> = {};
      if (intent?.callbackSigningSecretRef) {
        const secret = callbackSigningSecret(intent.callbackSigningSecretRef);
        signingHeaders['X-PrintOps-Timestamp'] = timestamp;
        signingHeaders['X-PrintOps-Signature'] = signCallback(rawBody, timestamp, secret);
        signingHeaders['X-PrintOps-Signature-Version'] = CALLBACK_SIGNATURE_VERSION;
      }
      const res = await this.deps.http(delivery.target, delivery.payload, {
        timeoutMs: this.policy.requestTimeoutMs,
        headers: {
          'Content-Type': 'application/json',
          // The receiver's idempotency key. Retries re-send the same value, so
          // five attempts are still one logical result notification.
          'X-PrintOps-Event-Id': delivery.eventId,
          'X-PrintOps-Delivery-Id': delivery.id,
          'X-PrintOps-Event-Type': RESULT_EVENT_TYPE,
          ...signingHeaders,
        },
      });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, kind: 'PERMANENT', httpStatus: res.status, guarantee: 'ACKNOWLEDGED' };
      }
      return {
        success: false,
        kind: classifyHttpStatus(res.status),
        httpStatus: res.status,
        errorCode: `HTTP_${res.status}`,
        errorMessage: `callback receiver responded ${res.status}${res.bodyExcerpt ? `: ${res.bodyExcerpt}` : ''}`,
      };
    } catch (err) {
      const errorCode = errCode(err);
      return {
        success: false,
        kind: classifyTransportError(errorCode),
        errorCode,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async sendNats(delivery: CallbackDelivery): Promise<SendOutcome> {
    if (!this.deps.nats) {
      return {
        success: false,
        kind: 'RETRYABLE',
        errorCode: 'NATS_NOT_CONNECTED',
        errorMessage: 'NATS transport is not connected',
      };
    }
    try {
      await this.deps.nats(delivery.target, delivery.payload);
      // BEST_EFFORT, and the word is chosen carefully. A Core NATS publish that
      // does not throw proves the bytes left this process — it does NOT prove a
      // subscriber received them. Reporting this as ACKNOWLEDGED would be a lie
      // an integrator would build on.
      return { success: true, kind: 'PERMANENT', guarantee: 'BEST_EFFORT' };
    } catch (err) {
      return {
        success: false,
        kind: 'RETRYABLE',
        errorCode: errCode(err) ?? 'NATS_PUBLISH_FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async recordAttempt(
    delivery: CallbackDelivery,
    attemptNumber: number,
    outcome: SendOutcome,
    durationMs: number,
  ): Promise<void> {
    if (!this.deps.attemptLog) return;
    try {
      await this.deps.attemptLog.record({
        endpointId: delivery.endpointId ?? '',
        endpointCode: delivery.endpointCode ?? '',
        transport: delivery.transport,
        target: delivery.target,
        outcome: outcome.success ? 'success' : 'failed',
        httpStatus: outcome.httpStatus,
        errorMessage: outcome.success ? undefined : `attempt ${attemptNumber}: ${outcome.errorMessage ?? outcome.errorCode ?? 'unknown'}`,
        durationMs,
        requestId: delivery.requestId,
        printJobId: delivery.printJobId,
        trigger: 'live',
      });
    } catch {
      // The diagnostic log must never affect delivery.
    }
  }
}

interface SendOutcome {
  success: boolean;
  kind: 'RETRYABLE' | 'PERMANENT';
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  guarantee?: CallbackDelivery['guarantee'];
}

/**
 * The terminal result-callback payload.
 *
 * Versioned, correlation-complete, and carrying the REAL terminal status —
 * including `UNVERIFIED`, which must never be flattened into FAILED: a page may
 * physically exist, and telling an integrator otherwise invites a duplicate
 * reprint of a patient label. No print payload is included; a callback is a
 * notification, not a copy of the document.
 */
export function buildResultCallbackPayload(
  event: PrintJobTerminal,
  job: Job,
  intent: JobCallbackIntent,
): Record<string, unknown> {
  return {
    version: RESULT_CALLBACK_VERSION,
    event_id: event.eventId,
    event_type: RESULT_EVENT_TYPE,
    occurred_at: (event.finishedAt ?? event.occurredAt).toISOString(),

    request_id: event.requestId ?? job.requestId ?? null,
    job_id: event.jobId,
    source_system: event.sourceSystem ?? job.sourceSystem ?? null,

    print_status: event.status,

    printer_code: event.printerCode ?? job.printerCode ?? null,
    runner_id: event.runnerId ?? job.runnerId ?? null,

    error: event.errorCode
      ? { code: event.errorCode, message: event.errorMessage ?? null }
      : null,

    trace_id: event.traceId,
    timeline: {
      accepted_at: job.receivedAt?.toISOString() ?? job.createdAt?.toISOString() ?? null,
      queued_at: job.queuedAt?.toISOString() ?? null,
      started_at: job.startedAt?.toISOString() ?? job.runnerReceivedAt?.toISOString() ?? null,
      terminal_at: (event.finishedAt ?? event.occurredAt).toISOString(),
    },
    // Lets a receiver tell a BEST_EFFORT NATS notification from an HTTP one it
    // actually acknowledged.
    delivery: {
      transports: intent.transports,
      nats_mode: intent.natsMode ?? null,
    },
  };
}

function errCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  if (err instanceof Error && err.name === 'AbortError') return 'ETIMEDOUT';
  return undefined;
}

/** Narrow an arbitrary domain event to the terminal one. */
export function isPrintJobTerminal(event: AnyDomainEvent): event is PrintJobTerminal {
  return event.eventType === 'PrintJobTerminal';
}
