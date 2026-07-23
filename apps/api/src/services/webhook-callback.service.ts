import type { WebhookEndpoint } from '@printerops/domain';

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

const FIELD_PATH = /^\$\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
/** Matches `$.field` / `$.a.b` tokens embedded anywhere in a template string. */
const EMBEDDED_FIELD = /\$\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*/g;

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
  ) {}

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
            request_id: result['request_id'],
            print_job_id: result['print_job_id'],
            status: result['status'],
            trace_id: result['trace_id'],
            duplicate: result['duplicate'] ?? false,
          };

    return { target, payload };
  }

  /** Fire the callback(s). Best-effort — never throws. */
  async send(ctx: CallbackContext): Promise<void> {
    const transport = ctx.endpoint.callbackTransport ?? 'NONE';
    if (transport === 'NONE') return;

    const { target, payload } = this.prepare(ctx);

    if (isHttpTransport(transport)) {
      if (!target.httpUrl) {
        this.logger.warn(
          { endpointId: ctx.endpoint.id, transport },
          'webhook callback skipped: no resolvable HTTP URL',
        );
      } else {
        try {
          await this.http(target.httpUrl, payload);
          this.logger.info(
            { endpointId: ctx.endpoint.id, url: target.httpUrl },
            'webhook HTTP callback sent',
          );
        } catch (err) {
          this.logger.error(
            { endpointId: ctx.endpoint.id, url: target.httpUrl, error: errMsg(err) },
            'webhook HTTP callback failed',
          );
        }
      }
    }

    if (isNatsTransport(transport)) {
      if (!target.natsSubject) {
        this.logger.warn(
          { endpointId: ctx.endpoint.id, transport },
          'webhook callback skipped: no resolvable NATS subject',
        );
      } else if (!this.nats) {
        this.logger.warn(
          { endpointId: ctx.endpoint.id, subject: target.natsSubject },
          'webhook NATS callback skipped: NATS transport not connected',
        );
      } else {
        try {
          await this.nats(target.natsSubject, payload);
          this.logger.info(
            { endpointId: ctx.endpoint.id, subject: target.natsSubject },
            'webhook NATS callback sent',
          );
        } catch (err) {
          this.logger.error(
            { endpointId: ctx.endpoint.id, subject: target.natsSubject, error: errMsg(err) },
            'webhook NATS callback failed',
          );
        }
      }
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
