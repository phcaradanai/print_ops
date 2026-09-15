import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api/client.js';

const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('apiFetch DELETE compatibility', () => {
  it('accepts a successful 204 response with no body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    ) as typeof fetch;

    await expect(
      apiFetch('/v1/templates/template-1', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('accepts a successful empty 200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 200 }),
    ) as typeof fetch;

    await expect(
      apiFetch('/v1/paper-profiles/profile-1', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('ignores a compatibility JSON body returned by DELETE', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, { deleted: true }),
    ) as typeof fetch;

    await expect(
      apiFetch('/v1/templates/template-1', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('preserves a structured DELETE failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        error: 'RESOURCE_IN_USE',
        message: 'Template is referenced by an active binding',
      }),
    ) as typeof fetch;

    await expect(
      apiFetch('/v1/templates/template-1', { method: 'DELETE' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'RESOURCE_IN_USE',
      message: 'Template is referenced by an active binding',
    });
  });

  it('keeps empty non-DELETE JSON responses invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 }),
    ) as typeof fetch;

    await expect(apiFetch('/v1/templates')).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_JSON',
    });
  });
});
