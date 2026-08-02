import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RETRY_POLICY,
  classifyHttpStatus,
  classifyTransportError,
  nextBackoffMs,
  retryPolicyFromEnv,
} from '../services/callback-retry-policy.js';

describe('callback retry classification', () => {
  it('retries 5xx', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyHttpStatus(status)).toBe('RETRYABLE');
    }
  });

  it('retries 408 and 429 even though they are 4xx', () => {
    // Both explicitly mean "try again"; treating them as permanent would give
    // up on a receiver that asked to be retried.
    expect(classifyHttpStatus(408)).toBe('RETRYABLE');
    expect(classifyHttpStatus(429)).toBe('RETRYABLE');
  });

  it('does not retry other 4xx', () => {
    // Retrying a 400/401/404 burns the attempt budget and delays the FAILED
    // verdict an operator needs in order to act.
    for (const status of [400, 401, 403, 404, 410, 422]) {
      expect(classifyHttpStatus(status)).toBe('PERMANENT');
    }
  });

  it('retries connection-level failures', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', undefined]) {
      expect(classifyTransportError(code)).toBe('RETRYABLE');
    }
  });

  it('never retries an SSRF-rejected destination', () => {
    // Waiting does not turn 169.254.169.254 into a legitimate receiver.
    expect(classifyTransportError('CALLBACK_URL_METADATA_BLOCKED')).toBe('PERMANENT');
    expect(classifyTransportError('CALLBACK_URL_SCHEME_BLOCKED')).toBe('PERMANENT');
  });
});

describe('callback backoff schedule', () => {
  const noJitter = () => 0.5; // maps to exactly 0 jitter

  it('follows immediate / 5s / 30s / 2min / 10min', () => {
    expect(nextBackoffMs(1, DEFAULT_RETRY_POLICY, noJitter)).toBe(5_000);
    expect(nextBackoffMs(2, DEFAULT_RETRY_POLICY, noJitter)).toBe(30_000);
    expect(nextBackoffMs(3, DEFAULT_RETRY_POLICY, noJitter)).toBe(120_000);
    expect(nextBackoffMs(4, DEFAULT_RETRY_POLICY, noJitter)).toBe(600_000);
  });

  it('returns undefined once the budget is spent', () => {
    // This is the dispatcher's signal to mark the delivery FAILED.
    expect(nextBackoffMs(5, DEFAULT_RETRY_POLICY, noJitter)).toBeUndefined();
    expect(nextBackoffMs(9, DEFAULT_RETRY_POLICY, noJitter)).toBeUndefined();
  });

  it('applies bounded jitter so simultaneous failures do not retry in lockstep', () => {
    const low = nextBackoffMs(1, DEFAULT_RETRY_POLICY, () => 0)!;
    const high = nextBackoffMs(1, DEFAULT_RETRY_POLICY, () => 1)!;
    expect(low).toBe(4_000); // 5000 - 20%
    expect(high).toBe(6_000); // 5000 + 20%
  });

  it('honours env overrides', () => {
    const policy = retryPolicyFromEnv({
      WEBHOOK_CALLBACK_MAX_ATTEMPTS: '3',
      WEBHOOK_CALLBACK_TIMEOUT_MS: '2500',
    } as NodeJS.ProcessEnv);
    expect(policy.maxAttempts).toBe(3);
    expect(policy.requestTimeoutMs).toBe(2500);
  });
});
