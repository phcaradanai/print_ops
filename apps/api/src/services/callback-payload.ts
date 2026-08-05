import type { CallbackTransport, NatsDeliveryMode } from '@printerops/domain';

/**
 * Unified callback envelope — version 2 (2026-08-05).
 *
 * Every print callback — `print.job.accepted` (QUEUED), `print.job.completed`
 * (terminal status) and `print.job.rejected` — shares ONE key vocabulary so a
 * receiver can parse any status with the same mapping. Fields that do not
 * apply to a phase are explicit `null` / `[]`, never absent, which is what
 * makes the shapes structurally identical across statuses.
 *
 * Version 2 changes from v1 (breaking, receiver-facing):
 *   - `print_status`  → `status`            (same key as the acceptance event)
 *   - `job_id`        → now used by every event (acceptance previously sent
 *                        `print_job_id`; the key is kept for template lookups
 *                        but the envelope carries `job_id`)
 *   - `occurred_at`   → now present on the QUEUED acceptance event too, so a
 *                        receiver knows when the print was ordered
 *   - `timeline`      → present on every event (`accepted_at` / `queued_at`
 *                        are set as soon as the job exists; later entries stay
 *                        null until they happen)
 */
export const CALLBACK_ENVELOPE_VERSION = 2;

export type CallbackEventType =
  | 'print.job.accepted'
  | 'print.job.completed'
  | 'print.job.rejected';

export interface CallbackEnvelopeInput {
  eventId: string;
  eventType: CallbackEventType;
  /** ISO-8601 instant of the event itself. */
  occurredAt: string;
  requestId: string | null;
  jobId: string | null;
  sourceSystem: string | null;
  /** QUEUED / SUCCESS / FAILED / UNVERIFIED / TIMEOUT / CANCELLED / REJECTED / DUPLICATE_RETURNED. */
  status: string;
  dataQuality?: 'OK' | 'WITH_WARNINGS' | null;
  missingFields?: string[];
  renderWarnings?: string[];
  printerCode?: string | null;
  runnerId?: string | null;
  traceId?: string | null;
  duplicate?: boolean;
  error?: { code: string; message: string | null } | null;
  timeline?: {
    acceptedAt?: string | null;
    queuedAt?: string | null;
    startedAt?: string | null;
    terminalAt?: string | null;
  };
  transports?: CallbackTransport[];
  natsMode?: NatsDeliveryMode | null;
  /** Phase-specific extra keys (e.g. rejected intake diagnostics). */
  extra?: Record<string, unknown>;
}

/** Build the canonical callback body. Identical over HTTP and NATS. */
export function buildCallbackEnvelope(input: CallbackEnvelopeInput): Record<string, unknown> {
  return {
    version: CALLBACK_ENVELOPE_VERSION,
    event_id: input.eventId,
    event_type: input.eventType,
    occurred_at: input.occurredAt,

    request_id: input.requestId,
    job_id: input.jobId,
    source_system: input.sourceSystem,

    status: input.status,
    data_quality: input.dataQuality ?? null,
    missing_fields: input.missingFields ?? [],
    render_warnings: input.renderWarnings ?? [],

    printer_code: input.printerCode ?? null,
    runner_id: input.runnerId ?? null,
    trace_id: input.traceId ?? null,
    duplicate: input.duplicate ?? false,
    error: input.error ?? null,

    timeline: {
      accepted_at: input.timeline?.acceptedAt ?? null,
      queued_at: input.timeline?.queuedAt ?? null,
      started_at: input.timeline?.startedAt ?? null,
      terminal_at: input.timeline?.terminalAt ?? null,
    },

    delivery: {
      transports: input.transports ?? [],
      nats_mode: input.natsMode ?? null,
    },

    ...(input.extra ?? {}),
  };
}
