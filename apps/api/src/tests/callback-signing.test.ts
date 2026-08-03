import { describe, expect, it } from 'vitest';
import { callbackSigningSecret, signCallback, verifyCallbackSignature } from '../services/callback-signing.js';

describe('HTTP callback HMAC signing', () => {
  const secret = 'synthetic-test-secret';
  const rawBody = '{"event_id":"evt-1","print_status":"SUCCESS"}';
  const timestamp = '1785132000';
  const now = Number(timestamp) * 1000;

  it('accepts a valid HMAC-SHA256 signature', () => {
    expect(verifyCallbackSignature({
      rawBody, timestamp, secret, now,
      signature: signCallback(rawBody, timestamp, secret),
    })).toBe(true);
  });

  it.each([
    ['tampered body', { rawBody: `${rawBody} ` }],
    ['modified timestamp', { timestamp: '1785132001' }],
    ['wrong secret', { secret: 'wrong' }],
    ['missing signature', { signature: undefined }],
  ])('rejects %s', (_name, patch) => {
    expect(verifyCallbackSignature({
      rawBody, timestamp, secret, now,
      signature: signCallback(rawBody, timestamp, secret),
      ...patch,
    })).toBe(false);
  });

  it('rejects replay outside the allowed window', () => {
    expect(verifyCallbackSignature({
      rawBody, timestamp, secret, now: now + 301_000,
      signature: signCallback(rawBody, timestamp, secret),
    })).toBe(false);
  });

  it('resolves only the referenced environment secret', () => {
    expect(callbackSigningSecret('receiver-primary', {
      PRINTOPS_CALLBACK_SECRET_RECEIVER_PRIMARY: secret,
    })).toBe(secret);
  });
});
