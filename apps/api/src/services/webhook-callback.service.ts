import type { WebhookEndpoint, WebhookCallbackAttemptRepositoryPort, CallbackAttemptTrigger } from '@printerops/domain';

/**
 * WebhookCallbackService notifies the original caller after a print job is
 * accepted (and, optionally, after the print result is known). A single
 * WebhookEndpoint can fan out to BOTH an HTTP POST and a NATS publish —
 * the `callbackTransport` field selects the channel(s):
 *
 *   NONE  — no callback (default, backwards compatible)
 *   HTTP  — POST a JSON payload to `callbackUrl`
 *   NATS  — publish a JSON payload to `callbackNatsSubject`
 *   BOTH  — HTTP + NATS
 *
 * Both `callbackUrl` and `callbackNatsSubject` may be a literal
 * value OR a `$.field` path that resolves against the ORIGINAL intake
 * payload, so the destination can be supplied dynamically per request
 * (e.g. a reply subject the publisher placed in the payload).
 *
 * The callback is best-effort: a delivery failure is logged, never throws
 * into the intake path (a failed webhook must not fail the print job).
 */

export interface CallbackTargetResolution {
  httpUrl?: string;
  natsSubject?: string;
}

export interface CallbackRender {
  target: CallbackTargetResolution;
  payload: Record<string, unknown>;
}

export interface WebhookCallbackLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export type HttpClient = (url: string, body: unknown) => Promise<void>;
export type NatsPublisher = (subject: string, payload: Record<string, unknown>) => void;

export interface CallbackContext {
  endpoint: WebhookEndpoint;
  /** The original intake payload (HTTP body or NATS envelope payload). */
  intakePayload: Record<string, unknown>;
  /** The accept response returned to the caller (or the final job result). */
  result: Record<string, unknown>;
}

/** Per-transport delivery outcome, returned by `send()` so callers (the
 * sandbox "test" endpoint in particular) can report what ACTUALLY happened
 * instead of a blind "ok: true" regardless of real delivery success. */
export interface CallbackTransportResult {
  attempted: boolean;
  success: boolean;
  target?: string;
  httpStatus?: number;
  error?: string;
  durationMs: number;
}

export interface CallbackSendResult {
  transport: WebhookEndpoint['callbackTransport'];
  http?: CallbackTransportResult;
  nats?: CallbackTransportResult;
}

const FIELD_PATH = /^\$\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
/** Matches `$.field` / `$.a.b` tokens embedded anywhere in a template string. */
const EMBEDDED_FIELD = /\$\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*/g;

/**
 * Resolve a destination template (`$.reply_to`, `results/$.tenant`, or a plain
 * literal) against an intake payload, returning a literal destination.
 *
 * Exported because the TERMINAL result-callback path has to do this resolution
 * at ACCEPT time and persist the literal with the job: by the time the print
 * finishes, the intake payload the `$.field` refers to is long gone.
 */
export function resolveCallbackDestination(
  template: string | undefined,
  intakePayload: Record<string, unknown>,
): string | undefined {
  if (!template) return undefined;
  const resolved = FIELD_PATH.test(template)
    ? String(fieldValue(intakePayload, template) ?? '')
    : renderFieldTokens(template, intakePayload);
  return resolved.length > 0 ? resolved : undefined;
}

function fieldValue(payload: Record<string, unknown>, path: string): unknown {
  const clean = path.startsWith('$.') ? path.slice(2) : path;
  return clean.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, payload);
}

/** Resolve every `$.field` token inside a template string against the payload. */
function renderFieldTokens(template: string, payload: Record<string, unknown>): string {
  return template.replace(EMBEDDED_FIELD, (token) => {
    const value = fieldValue(payload, token);
    return value == null ? '' : String(value);
  });
}

function resolveTemplate(
  template: Record<string, unknown> | undefined,
  intakePayload: Record<string, unknown>,
): Record<string, unknown> {
  if (!template) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(template)) {
    if (typeof raw === 'string' && FIELD_PATH.test(raw)) {
      out[key] = fieldValue(intakePayload, raw);
    } else {
      out[key] = raw;
    }
  }
  return out;
}

function isHttpTransport(t: WebhookEndpoint['callbackTransport']): boolean {
  return t === 'HTTP' || t === 'BOTH';
}

function isNatsTransport(t: WebhookEndpoint['callbackTransport']): boolean {
  return t === 'NATS' || t === 'BOTH';
}

export class WebhookCallbackService {
  constructor(
    private readonly logger: WebhookCallbackLogger,
    private readonly http: HttpClient,
    private readonly nats?: NatsPublisher,
    private readonly attemptLog?: WebhookCallbackAttemptRepositoryPort,
  ) {}

  /** Records one delivery attempt. Best-effort — a logging failure must never
   * affect the (already best-effort) callback path itself. */
  private async record(
    endpoint: WebhookEndpoint,
    transport: 'HTTP' | 'NATS',
    target: string,
    outcome: 'success' | 'failed' | 'skipped',
    durationMs: number,
    trigger: CallbackAttemptTrigger,
    requestId?: string,
    printJobId?: string,
    httpStatus?: number,
    errorMessage?: string,
  ): Promise<void> {
    if (!this.attemptLog) return;
    try {
      await this.attemptLog.record({
        endpointId: endpoint.id,
        endpointCode: endpoint.endpointCode,
        transport,
        target,
        outcome,
        durationMs,
        trigger,
        requestId,
        printJobId,
        httpStatus,
        errorMessage,
      });
    } catch {
      // never let attempt-log failures affect the callback path
    }
  }

  /** Resolve destination(s) and render the payload for a callback request. */
  prepare(ctx: CallbackContext): CallbackRender {
    const { endpoint, intakePayload, result } = ctx;
    const transport = endpoint.callbackTransport ?? 'NONE';

    const target: CallbackTargetResolution = {};
    if (isHttpTransport(transport) && endpoint.callbackUrl) {
      target.httpUrl = FIELD_PATH.test(endpoint.callbackUrl)
        ? String(fieldValue(intakePayload, endpoint.callbackUrl) ?? '')
        : renderFieldTokens(endpoint.callbackUrl, intakePayload);
    }
    if (isNatsTransport(transport) && endpoint.callbackNatsSubject) {
      target.natsSubject = FIELD_PATH.test(endpoint.callbackNatsSubject)
        ? String(fieldValue(intakePayload, endpoint.callbackNatsSubject) ?? '')
        : renderFieldTokens(endpoint.callbackNatsSubject, intakePayload);
    }

    const userTemplate = resolveTemplate(endpoint.callbackPayloadTemplate, intakePayload);
    const payload: Record<string, unknown> =
      Object.keys(userTemplate).length > 0
        ? userTemplate
        : {
            // `event_type` names this for what it is: an ACCEPTANCE
            // notification. It carries `status: "QUEUED"` because the job has
            // only been queued — it is not, and must never be described as, a
            // print result. The terminal result arrives separately as
            // `print.job.completed` (see ResultCallbackDispatcher).
            event_type: 'print.job.accepted',
            request_id: result['request_id'],
            print_job_id: result['print_job_id'],
            status: result['status'],
            trace_id: result['trace_id'],
            duplicate: result['duplicate'] ?? false,
          };

    return { target, payload };
  }

  /** Fire the callback(s). Best-effort — never throws. Returns the REAL
   * per-transport outcome (attempted/success/status/error/timing) so callers
   * — the sandbox test-fire endpoint in particular — can report what
   * actually happened instead of a blind "ok". Every attempt (including
   * skips, when no target could be resolved) is recorded to the attempt log
   * if one was provided. */
  async send(ctx: CallbackContext, opts?: { trigger?: CallbackAttemptTrigger }): Promise<CallbackSendResult> {
    const transport = ctx.endpoint.callbackTransport ?? 'NONE';
    const trigger: CallbackAttemptTrigger = opts?.trigger ?? 'live';
    const out: CallbackSendResult = { transport };
    if (transport === 'NONE') return out;

    const { target, payload } = this.prepare(ctx);
    const requestId = typeof ctx.result['request_id'] === 'string' ? (ctx.result['request_id'] as string) : undefined;
    const printJobId = typeof ctx.result['print_job_id'] === 'string' ? (ctx.result['print_job_id'] as string) : undefined;

    if (isHttpTransport(transport)) {
      if (!target.httpUrl) {
        this.logger.warn(
          { endpointId: ctx.endpoint.id, transport },
          'webhook callback skipped: no resolvable HTTP URL',
        );
        out.http = { attempted: false, success: false, durationMs: 0, error: 'no resolvable HTTP URL' };
        void this.record(ctx.endpoint, 'HTTP', '', 'skipped', 0, trigger, requestId, printJobId, undefined, 'no resolvable HTTP URL');
      } else {
        const t0 = Date.now();
        try {
          await this.http(target.httpUrl, payload);
          const durationMs = Date.now() - t0;
          this.logger.info(
            { endpointId: ctx.endpoint.id, url: target.httpUrl },
            'webhook HTTP callback sent',
          );
          out.http = { attempted: true, success: true, target: target.httpUrl, durationMs };
          void this.record(ctx.endpoint, 'HTTP', target.httpUrl, 'success', durationMs, trigger, requestId, printJobId);
        } catch (err) {
          const durationMs = Date.now() - t0;
          const message = errMsg(err);
          const httpStatus = extractHttpStatus(message);
          this.logger.error(
            { endpointId: ctx.endpoint.id, url: target.httpUrl, error: message },
            'webhook HTTP callback failed',
          );
          out.http = { attempted: true, success: false, target: target.httpUrl, durationMs, error: message, httpStatus };
          void this.record(ctx.endpoint, 'HTTP', target.httpUrl, 'failed', durationMs, trigger, requestId, printJobId, httpStatus, message);
        }
      }
    }

    if (isNatsTransport(transport)) {
      if (!target.natsSubject) {
        this.logger.warn(
          { endpointId: ctx.endpoint.id, transport },
          'webhook callback skipped: no resolvable NATS subject',
        );
        out.nats = { attempted: false, success: false, durationMs: 0, error: 'no resolvable NATS subject' };
        void this.record(ctx.endpoint, 'NATS', '', 'skipped', 0, trigger, requestId, printJobId, undefined, 'no resolvable NATS subject');
      } else if (!this.nats) {
        this.logger.warn(
          { endpointId: ctx.endpoint.id, subject: target.natsSubject },
          'webhook NATS callback skipped: NATS transport not connected',
        );
        out.nats = { attempted: false, success: false, target: target.natsSubject, durationMs: 0, error: 'NATS transport not connected' };
        void this.record(ctx.endpoint, 'NATS', target.natsSubject, 'skipped', 0, trigger, requestId, printJobId, undefined, 'NATS transport not connected');
      } else {
        const t0 = Date.now();
        try {
          await this.nats(target.natsSubject, payload);
          const durationMs = Date.now() - t0;
          this.logger.info(
            { endpointId: ctx.endpoint.id, subject: target.natsSubject },
            'webhook NATS callback sent',
          );
          out.nats = { attempted: true, success: true, target: target.natsSubject, durationMs };
          void this.record(ctx.endpoint, 'NATS', target.natsSubject, 'success', durationMs, trigger, requestId, printJobId);
        } catch (err) {
          const durationMs = Date.now() - t0;
          const message = errMsg(err);
          this.logger.error(
            { endpointId: ctx.endpoint.id, subject: target.natsSubject, error: message },
            'webhook NATS callback failed',
          );
          out.nats = { attempted: true, success: false, target: target.natsSubject, durationMs, error: message };
          void this.record(ctx.endpoint, 'NATS', target.natsSubject, 'failed', durationMs, trigger, requestId, printJobId, undefined, message);
        }
      }
    }

    return out;
  }
}

/** Best-effort extraction of an HTTP status code from httpCallbackSender's
 * thrown error message (`webhook callback HTTP 404 to https://...`), so the
 * status shows up in the attempt log without requiring a stricter HttpClient
 * contract change (which would ripple through every existing test mock). */
function extractHttpStatus(message: string): number | undefined {
  const match = /HTTP (\d{3})/.exec(message);
  return match ? Number(match[1]) : undefined;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
