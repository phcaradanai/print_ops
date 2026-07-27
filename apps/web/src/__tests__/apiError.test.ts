import { describe, expect, it } from 'vitest';
import {
  ApiError,
  apiErrorFromResponse,
  errorMessage,
  errorTechnicalSummary,
  looksLikeErrorCode,
  networkApiError,
} from '../api/errors.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('apiErrorFromResponse', () => {
  it('keeps the AppError code and message ({ error: CODE, message })', async () => {
    const err = await apiErrorFromResponse(
      jsonResponse(404, { error: 'NOT_FOUND', message: "Printer with id 'p1' not found" }),
      '/printers/p1',
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe("Printer with id 'p1' not found");
    expect(err.path).toBe('/printers/p1');
  });

  it('uses a prose `error` field as the message, not as a code', async () => {
    const err = await apiErrorFromResponse(jsonResponse(404, { error: 'Job not found' }), '/jobs/x');
    expect(err.code).toBeUndefined();
    expect(err.message).toBe('Job not found');
  });

  it('surfaces the permission guard message verbatim', async () => {
    const err = await apiErrorFromResponse(
      jsonResponse(403, { error: 'Missing permission: printer:control' }),
      '/printers/p1/control',
    );
    expect(err.message).toBe('Missing permission: printer:control');
    expect(err.isAuth).toBe(true);
  });

  it('reads the Fastify default envelope without mistaking "Bad Request" for a code', async () => {
    const err = await apiErrorFromResponse(
      jsonResponse(400, { statusCode: 400, error: 'Bad Request', message: 'body must have required property x' }),
      '/v1/print-jobs',
    );
    expect(err.code).toBeUndefined();
    expect(err.message).toBe('body must have required property x');
    expect(err.isClient).toBe(true);
  });

  it('picks up a trace id from the body or the headers', async () => {
    const fromBody = await apiErrorFromResponse(
      jsonResponse(500, { error: 'INTERNAL_ERROR', message: 'boom', trace_id: 'tr-1' }),
      '/jobs',
    );
    expect(fromBody.traceId).toBe('tr-1');
    expect(fromBody.isServer).toBe(true);

    const fromHeader = await apiErrorFromResponse(
      jsonResponse(500, { error: 'INTERNAL_ERROR' }, { 'x-trace-id': 'tr-2' }),
      '/jobs',
    );
    expect(fromHeader.traceId).toBe('tr-2');
  });

  it('degrades to the status line for a non-JSON body', async () => {
    const res = new Response('<html>502 Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' });
    const err = await apiErrorFromResponse(res, '/jobs');
    expect(err.status).toBe(502);
    expect(err.message).toBe('<html>502 Bad Gateway</html>');
  });

  it('degrades to the status line for an empty body', async () => {
    const err = await apiErrorFromResponse(new Response(null, { status: 503, statusText: 'Service Unavailable' }), '/jobs');
    expect(err.message).toBe('Service Unavailable');
  });
});

describe('networkApiError', () => {
  it('marks an unreachable API as a network failure, not an HTTP status', () => {
    const err = networkApiError('/jobs', new TypeError('Failed to fetch'));
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.isNetwork).toBe(true);
    expect(err.isServer).toBe(false);
    expect(err.message).toBe('Failed to fetch');
  });
});

describe('looksLikeErrorCode', () => {
  it('accepts UPPER_SNAKE codes and rejects prose', () => {
    expect(looksLikeErrorCode('NOT_FOUND')).toBe(true);
    expect(looksLikeErrorCode('VALIDATION_ERROR')).toBe(true);
    expect(looksLikeErrorCode('Bad Request')).toBe(false);
    expect(looksLikeErrorCode('Job not found')).toBe(false);
    expect(looksLikeErrorCode('notFound')).toBe(false);
  });
});

describe('errorMessage / errorTechnicalSummary', () => {
  it('falls back only when there is nothing usable', () => {
    expect(errorMessage(new Error('real message'), 'fallback')).toBe('real message');
    expect(errorMessage(new Error(''), 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
    expect(errorMessage('plain string')).toBe('plain string');
  });

  it('summarises path, status, code and trace for support', () => {
    const err = new ApiError({ status: 500, path: '/jobs', message: 'boom', code: 'INTERNAL_ERROR', traceId: 'tr-9' });
    expect(errorTechnicalSummary(err)).toBe('/jobs · HTTP 500 · INTERNAL_ERROR · trace tr-9');
    expect(errorTechnicalSummary(networkApiError('/jobs', new Error('down')))).toBe('/jobs · network · NETWORK_ERROR');
  });

  it('returns null for a non-API error, so the disclosure stays hidden', () => {
    expect(errorTechnicalSummary(new Error('render crash'))).toBeNull();
  });
});
