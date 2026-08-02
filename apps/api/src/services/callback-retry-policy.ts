/**
 * HTTP result-callback retry policy.
 *
 * Split out of the dispatcher so classification and backoff are unit-testable
 * without a network, a timer, or a real clock. Nothing here sleeps: the policy
 * computes a `nextAttemptAt` timestamp and the retry sweep picks the delivery
 * up when it comes due. That is what makes "retry exhaustion" and "restart with
 * a pending delivery" testable in milliseconds instead of 12 minutes.
 */

export type CallbackFailureKind = 'RETRYABLE' | 'PERMANENT';

export interface RetryPolicy {
  maxAttempts: number;
  /** Per-request HTTP timeout. */
  requestTimeoutMs: number;
  /** Backoff before attempt N+1, indexed by the attempt that just failed. */
  backoffMs: readonly number[];
  /** Fraction of the delay applied as random jitter (0.2 = ±20%). Jitter stops
   *  a burst of callbacks that failed together from retrying in lockstep. */
  jitterRatio: number;
}

/**
 * attempt 1 immediate, then ~5s, ~30s, ~2min, ~10min. Five attempts spans about
 * 12 minutes, which is long enough to ride out a receiver restart and short
 * enough that an operator looking at the dashboard sees a final verdict.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  requestTimeoutMs: 10_000,
  backoffMs: [5_000, 30_000, 120_000, 600_000],
  jitterRatio: 0.2,
};

export function retryPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): RetryPolicy {
  const num = (raw: string | undefined, fallback: number): number => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    ...DEFAULT_RETRY_POLICY,
    maxAttempts: Math.max(1, num(env['WEBHOOK_CALLBACK_MAX_ATTEMPTS'], DEFAULT_RETRY_POLICY.maxAttempts)),
    requestTimeoutMs: num(env['WEBHOOK_CALLBACK_TIMEOUT_MS'], DEFAULT_RETRY_POLICY.requestTimeoutMs),
  };
}

/**
 * Which HTTP responses deserve another attempt.
 *
 * 408 (request timeout) and 429 (rate limited) are retried even though they are
 * 4xx: both explicitly mean "try again". Every other 4xx is the receiver saying
 * the request itself is wrong — retrying a 400 or a 404 just burns attempts and
 * delays the FAILED verdict an operator needs to see.
 */
export function classifyHttpStatus(status: number): CallbackFailureKind {
  if (status === 408 || status === 429) return 'RETRYABLE';
  if (status >= 500) return 'RETRYABLE';
  return 'PERMANENT';
}

/** Connection refused, DNS failure, TLS error, socket hang-up, timeout — all
 *  transient by nature: no response ever came back, so the receiver never saw
 *  the request and a retry cannot duplicate anything. */
export function classifyTransportError(errorCode: string | undefined): CallbackFailureKind {
  // A destination rejected by the SSRF guard will never become valid by waiting.
  if (errorCode?.startsWith('CALLBACK_URL_')) return 'PERMANENT';
  return 'RETRYABLE';
}

/**
 * Delay before the attempt following `attemptsSoFar`. Returns undefined when the
 * budget is spent, which is the dispatcher's signal to mark the delivery FAILED.
 */
export function nextBackoffMs(
  attemptsSoFar: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number | undefined {
  if (attemptsSoFar >= policy.maxAttempts) return undefined;
  const index = Math.min(attemptsSoFar - 1, policy.backoffMs.length - 1);
  const base = policy.backoffMs[Math.max(0, index)] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 0;
  const jitter = base * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}
