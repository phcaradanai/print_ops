/**
 * Typed API failures for the PrintOps dashboard (FE-01).
 *
 * Before this module every failed request became `new Error('API /jobs -> 500')`:
 * the server's own message, its error code and any trace id were read off the
 * wire and thrown away, so an operator saw "API /jobs -> 500" and had nothing to
 * give support. `ApiError` keeps the whole payload.
 *
 * Wire shapes actually emitted by apps/api today (verified against
 * apps/api/src/routes/**):
 *   { "error": "NOT_FOUND", "message": "Printer with id 'x' not found" }  AppError
 *   { "error": "Job not found" }                                          ad-hoc
 *   { "error": "Missing permission: printer:control" }                    guard
 *   { "statusCode": 400, "error": "Bad Request", "message": "..." }        Fastify
 * so `error` is sometimes a machine code and sometimes the human message.
 * `code` is only populated when the value really looks like a code
 * (UPPER_SNAKE_CASE), never from Fastify's "Bad Request" style status text.
 */

/** `status` used for "the request never reached the server". */
export const NETWORK_STATUS = 0;
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

export interface ApiErrorInit {
  status: number;
  path: string;
  message: string;
  code?: string;
  details?: unknown;
  traceId?: string;
  /** Raw parsed body (or raw text) — kept for the details disclosure. */
  body?: unknown;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly code: string | undefined;
  readonly details: unknown;
  readonly traceId: string | undefined;
  readonly body: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.path = init.path;
    this.code = init.code;
    this.details = init.details;
    this.traceId = init.traceId;
    this.body = init.body;
    if (init.cause !== undefined) {
      (this as { cause?: unknown }).cause = init.cause;
    }
  }

  /** Request never reached the API (offline, server down, DNS, CORS). */
  get isNetwork(): boolean {
    return this.status === NETWORK_STATUS;
  }

  /** Session expired or the role lacks the permission. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** Caller sent something invalid — retrying the same request will not help. */
  get isClient(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isServer(): boolean {
    return this.status >= 500;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** UPPER_SNAKE_CASE tokens are codes (`NOT_FOUND`); prose is a message. */
export function looksLikeErrorCode(value: string): boolean {
  return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(value) && !value.includes(' ');
}

/**
 * Builds an `ApiError` from a non-OK `Response`. Never throws: an unreadable or
 * non-JSON body degrades to the status line rather than masking the real
 * failure with a parse error.
 */
export async function apiErrorFromResponse(res: Response, path: string): Promise<ApiError> {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    // body already consumed or connection dropped mid-read
  }

  let parsed: unknown = undefined;
  if (raw.trim() !== '') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  let code: string | undefined;
  let message: string | undefined;
  let details: unknown;
  let traceId: string | undefined;

  if (isRecord(parsed)) {
    const errorField = asString(parsed.error);
    const messageField = asString(parsed.message);
    code = asString(parsed.code) ?? (errorField && looksLikeErrorCode(errorField) ? errorField : undefined);
    message = messageField ?? (code === errorField ? undefined : errorField);
    details = parsed.details;
    traceId = asString(parsed.traceId) ?? asString(parsed.trace_id);
  } else if (typeof parsed === 'string') {
    message = asString(parsed);
  }

  traceId = traceId ?? asString(res.headers.get('x-trace-id')) ?? asString(res.headers.get('x-request-id'));

  return new ApiError({
    status: res.status,
    path,
    message: message ?? asString(res.statusText) ?? `HTTP ${res.status}`,
    code,
    details,
    traceId,
    body: parsed,
  });
}

/** The fetch itself rejected — no HTTP status exists. */
export function networkApiError(path: string, cause: unknown): ApiError {
  return new ApiError({
    status: NETWORK_STATUS,
    path,
    message: cause instanceof Error && cause.message ? cause.message : 'Network request failed',
    code: NETWORK_ERROR_CODE,
    cause,
  });
}

/**
 * Human string for any thrown value. Pages use this instead of
 * `err instanceof Error ? err.message : fallback` repeated 19 times.
 */
export function errorMessage(err: unknown, fallback = 'Unexpected error'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message.trim() !== '') return err.message;
  if (typeof err === 'string' && err.trim() !== '') return err;
  return fallback;
}

/** Short technical line for the details disclosure: `GET-ish path, status, code, trace`. */
export function errorTechnicalSummary(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const parts = [err.path, err.isNetwork ? 'network' : `HTTP ${err.status}`];
  if (err.code) parts.push(err.code);
  if (err.traceId) parts.push(`trace ${err.traceId}`);
  return parts.join(' · ');
}
