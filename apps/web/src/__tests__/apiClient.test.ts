import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors.js';
import { apiFetch, apiFetchVoid, login, onUnauthorized } from '../api/client.js';
import { clearRecentErrors, logError, recentErrors } from '../lib/logError.js';

const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  clearRecentErrors();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // localStorage is absent in the node test environment; client.ts guards it.
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  it('rejects with an ApiError carrying the server code and message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(404, { error: 'NOT_FOUND', message: "Printer with id 'p1' not found" }),
    ) as typeof fetch;

    await expect(apiFetch('/printers/p1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
      message: "Printer with id 'p1' not found",
      path: '/printers/p1',
    });
  });

  it('turns an unreachable API into status 0 rather than an opaque TypeError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as typeof fetch;

    const err = await apiFetch('/jobs').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).isNetwork).toBe(true);
  });

  it('resolves the parsed body on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(200, [{ id: 'j1' }])) as typeof fetch;
    await expect(apiFetch<{ id: string }[]>('/jobs')).resolves.toEqual([{ id: 'j1' }]);
  });

  it('keeps an empty JSON-contract response invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch;
    await expect(apiFetch('/jobs')).rejects.toMatchObject({ code: 'INVALID_JSON', status: 200 });
  });

  it('logs every rejection through the single [PrintOps] channel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'INTERNAL_ERROR' })) as typeof fetch;
    await apiFetch('/jobs').catch(() => undefined);

    const logged = recentErrors();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.scope).toBe('apiFetch');
    expect(logged[0]?.technical).toContain('INTERNAL_ERROR');
  });
});

describe('apiFetchVoid', () => {
  it('accepts HTTP 204 with no body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })) as typeof fetch;
    await expect(apiFetchVoid('/printers/p1/test-print', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('accepts an explicitly ignored empty HTTP 200 body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 })) as typeof fetch;
    await expect(apiFetchVoid('/commands/refresh', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('still preserves structured failures', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(409, { error: 'PRINTER_BUSY', message: 'Printer is busy' }),
    ) as typeof fetch;
    await expect(apiFetchVoid('/printers/p1/test-print', { method: 'POST' })).rejects.toMatchObject({
      status: 409,
      code: 'PRINTER_BUSY',
      message: 'Printer is busy',
    });
  });
});

describe('login', () => {
  it('masks the server wording on 401 but keeps the status for diagnostics', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: 'UNAUTHORIZED', message: 'bcrypt compare failed for user 12' }),
    ) as typeof fetch;

    const err = await login('a@b.c', 'nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Invalid email or password');
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).toBe('UNAUTHORIZED');
  });

  it('shows a non-401 failure verbatim, so a broken gateway is not read as a typo', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(503, { error: 'Auth service unavailable' }),
    ) as typeof fetch;

    const err = await login('a@b.c', 'pw').catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('Auth service unavailable');
    expect((err as ApiError).status).toBe(503);
  });
});

describe('session expiry', () => {
  it('notifies subscribers on 401 so the app can return to Login', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'UNAUTHORIZED' })) as typeof fetch;

    await apiFetch('/jobs').catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does NOT end the session on 403 — that is a permission decision, not an expired token', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: 'Missing permission: printer:control' })) as typeof fetch;

    await apiFetch('/printers/p1/control').catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('stops notifying once unsubscribed', async () => {
    const listener = vi.fn();
    onUnauthorized(listener)();
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(401, {})) as typeof fetch;

    await apiFetch('/jobs').catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not route a rejected login through the session-expiry path', async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'UNAUTHORIZED' })) as typeof fetch;

    await login('a@b.c', 'wrong').catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('logError buffering', () => {
  it('collapses a repeated failure instead of flooding the buffer', () => {
    const err = new ApiError({ status: 0, path: '/jobs', message: 'Failed to fetch', code: 'NETWORK_ERROR' });
    for (let i = 0; i < 50; i++) logError('apiFetch', err);

    const logged = recentErrors();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.repeats).toBe(50);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct failures separate', () => {
    logError('apiFetch', new Error('first'));
    logError('apiFetch', new Error('second'));
    logError('render', new Error('second'));
    expect(recentErrors().map((e) => e.message)).toEqual(['first', 'second', 'second']);
  });
});
