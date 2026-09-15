/**
 * WebhookCallbackAttempt records every attempt PrintOps makes to deliver a
 * webhook callback (HTTP POST and/or NATS publish) back to a caller — both
 * real, live intake traffic AND manual "test" fires from the sandbox.
 *
 * The callback send path is deliberately best-effort (a failed callback must
 * never fail the underlying print job), which previously meant a delivery
 * failure was only ever visible in process logs — the "did it actually
 * arrive?" question had no real answer short of grepping server output or
 * asking the receiving system. This log makes that outcome visible on the
 * dashboard, the same way IntakeAttempt did for the inbound side.
 */

export type CallbackAttemptTransport = 'HTTP' | 'NATS';
export type CallbackAttemptOutcome = 'success' | 'failed' | 'skipped';
/** 'live' = fired from real print-job intake traffic. 'test' = manually
 *  fired from the sandbox's "test webhook" / callback-test action. */
export type CallbackAttemptTrigger = 'live' | 'test';

export interface WebhookCallbackAttempt {
  id: string;
  endpointId: string;
  endpointCode: string;
  transport: CallbackAttemptTransport;
  /** Resolved HTTP URL or NATS subject actually targeted. Empty when the
   *  target could not be resolved at all (outcome will be 'skipped'). */
  target: string;
  outcome: CallbackAttemptOutcome;
  /** HTTP status code, when available (HTTP transport only, and only when a
   *  response was actually received — not set for DNS/connection failures). */
  httpStatus?: number;
  /** Human-readable failure/skip reason. Undefined on success. */
  errorMessage?: string;
  durationMs: number;
  requestId?: string;
  printJobId?: string;
  trigger: CallbackAttemptTrigger;
  occurredAt: Date;
}

export type CreateWebhookCallbackAttemptInput = Omit<WebhookCallbackAttempt, 'id' | 'occurredAt'>;
