/**
 * Terminal print-result callbacks.
 *
 * Two concerns live in this file, and keeping them apart is the whole point:
 *
 *  - `JobCallbackIntent` — WHERE the result of a job must be delivered. Decided
 *    once, when the job is accepted, and persisted WITH the job. It is not a
 *    template: `$.field` destinations are resolved against the intake payload at
 *    accept time and stored as literals, because by the time the print reaches a
 *    terminal state the intake payload no longer exists anywhere.
 *
 *  - `CallbackDelivery` — WHETHER that delivery actually happened. A print job
 *    and its result callback fail independently:
 *
 *        print status: SUCCESS     callback status: FAILED
 *        print status: FAILED      callback status: DELIVERED
 *
 *    so the two statuses are never merged into one field. `CallbackDelivery` is
 *    durable business data (unlike the 500-entry `WebhookCallbackAttempt` ring
 *    buffer, which stays as the per-attempt diagnostic child record) because the
 *    retry worker has to find pending deliveries again after a restart.
 */

/** Transport a result callback is delivered over. */
export type CallbackTransport = 'HTTP' | 'NATS';

/** What made a callback fire. Only PRINT_RESULT exists today; the acceptance
 *  notification is a different event type and is not a result callback. */
export type CallbackTrigger = 'PRINT_RESULT';

/**
 * NATS delivery guarantee actually achieved.
 *
 * `BEST_EFFORT` is honest, not a placeholder: a Core NATS publish that returns
 * without throwing proves the bytes left this process, and nothing more. The
 * print-intake connection deliberately does not own any stream (the publisher's
 * environment does), so PrintOps cannot guarantee a JetStream stream exists for
 * an arbitrary caller-supplied reply subject. See docs/architecture/result-callbacks.md.
 */
export type NatsDeliveryMode = 'CORE' | 'JETSTREAM';
export type CallbackDeliveryGuarantee = 'BEST_EFFORT' | 'ACKNOWLEDGED';

/**
 * Where a job's terminal result must be delivered. Persisted with the job (in
 * `job.metadata.callbackIntent`) so callback resolution survives a process
 * restart, a delayed execution, an EventBus redelivery and a NATS redelivery.
 */
export interface JobCallbackIntent {
  /** False when the endpoint has no callback transport, or has result
   *  callbacks switched off (`callbackOnPrintResult`). Kept rather than
   *  omitted so the Job Detail page can say "callbacks: disabled" instead of
   *  "unknown". */
  enabled: boolean;
  trigger: CallbackTrigger;
  transports: CallbackTransport[];
  /** Immutable reference to the endpoint this intent was snapshotted from.
   *  Editing the endpoint afterwards must NOT change where an already-accepted
   *  job reports its result, so the destinations below are a snapshot, and this
   *  id is for correlation/UI only. */
  endpointId?: string;
  endpointCode?: string;
  /** Resolved literal URL — never a `$.field` template. */
  httpUrl?: string;
  /** Resolved literal subject — never a `$.field` template. */
  natsSubject?: string;
  natsMode?: NatsDeliveryMode;
  callbackSigningSecretRef?: string;
  /** Why `enabled` is false, for the UI. */
  disabledReason?: string;
}

/**
 * Delivery state machine:
 *
 *   PENDING ──> DELIVERING ──> DELIVERED
 *                   │
 *                   ├──> RETRY_SCHEDULED ──> DELIVERING ...
 *                   └──> FAILED            (attempts exhausted / permanent 4xx)
 *
 * Disabled callbacks are represented by `JobCallbackIntent.enabled=false`;
 * they are not deliveries and therefore do not get a delivery state.
 */
export type CallbackDeliveryStatus =
  | 'PENDING'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'RETRY_SCHEDULED'
  | 'FAILED';

/** A delivery is terminal when the retry worker must never touch it again. */
export const TERMINAL_DELIVERY_STATUSES: readonly CallbackDeliveryStatus[] = [
  'DELIVERED',
  'FAILED',
];

export function isTerminalDeliveryStatus(status: CallbackDeliveryStatus): boolean {
  return TERMINAL_DELIVERY_STATUSES.includes(status);
}

export interface CallbackDelivery {
  id: string;
  /** Terminal-event id that produced this delivery. Stored for correlation and
   *  echoed in the callback payload as the receiver's idempotency key. It is
   *  NOT the dedupe key here — a fresh id is generated per publish, so it is
   *  only stable within one process. See `deliveryKey()`. */
  eventId: string;
  printJobId: string;
  requestId?: string;
  sourceSystem?: string;
  transport: CallbackTransport;
  /** Resolved HTTP URL or NATS subject. */
  target: string;
  trigger: CallbackTrigger;
  deliveryStatus: CallbackDeliveryStatus;
  /** BEST_EFFORT for Core NATS; ACKNOWLEDGED once an HTTP 2xx or a JetStream
   *  publish ack came back. Undefined until the first completed attempt. */
  guarantee?: CallbackDeliveryGuarantee;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  nextAttemptAt?: Date;
  deliveredAt?: Date;
  lastHttpStatus?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  /** Terminal PRINT status this callback reports. Distinct from
   *  `deliveryStatus` on purpose. */
  printStatus: string;
  /** Exact JSON body sent (or to be sent). Re-sent verbatim on every retry so
   *  a receiver deduping on `event_id` sees one logical event. */
  payload: Record<string, unknown>;
  endpointId?: string;
  endpointCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateCallbackDeliveryInput = Omit<
  CallbackDelivery,
  'id' | 'createdAt' | 'updatedAt' | 'attemptCount'
> & { attemptCount?: number };

/**
 * Idempotency key for a result callback.
 *
 * `(printJobId, transport, target)` and NOT `eventId`: a job reaches a terminal
 * state exactly once (guarded by the conditional `claim()` in ExecuteJobService
 * and the runner result route), so the job id is the durable natural key, while
 * `eventId` is a fresh `generateId()` per publish and would let a redelivered
 * or replayed event create a second delivery record — i.e. a duplicate callback.
 */
export function deliveryKey(printJobId: string, transport: CallbackTransport, target: string): string {
  return `${printJobId}::${transport}::${target}`;
}

/** Key under which the intent travels inside `job.metadata`. */
export const CALLBACK_INTENT_METADATA_KEY = 'callbackIntent';

/**
 * The intent rides in `job.metadata` rather than in a dedicated `jobs` column.
 * `metadata` is already a JSON blob that round-trips through BOTH the in-memory
 * and the SQLite job repositories (sqlite-job.repo serialises it with toJson),
 * so this needs no migration and cannot diverge between the two DB modes.
 */
export function readCallbackIntent(
  metadata: Record<string, unknown> | undefined,
): JobCallbackIntent | undefined {
  const raw = metadata?.[CALLBACK_INTENT_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const intent = raw as Partial<JobCallbackIntent>;
  if (typeof intent.enabled !== 'boolean') return undefined;
  return {
    enabled: intent.enabled,
    trigger: intent.trigger ?? 'PRINT_RESULT',
    transports: Array.isArray(intent.transports)
      ? intent.transports.filter((t): t is CallbackTransport => t === 'HTTP' || t === 'NATS')
      : [],
    endpointId: intent.endpointId,
    endpointCode: intent.endpointCode,
    httpUrl: intent.httpUrl,
    natsSubject: intent.natsSubject,
    natsMode: intent.natsMode,
    callbackSigningSecretRef: intent.callbackSigningSecretRef,
    disabledReason: intent.disabledReason,
  };
}

export function withCallbackIntent(
  metadata: Record<string, unknown> | undefined,
  intent: JobCallbackIntent,
): Record<string, unknown> {
  return { ...(metadata ?? {}), [CALLBACK_INTENT_METADATA_KEY]: intent };
}
