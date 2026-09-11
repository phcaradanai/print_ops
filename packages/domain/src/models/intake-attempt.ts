/**
 * IntakeAttempt records every attempt to submit a dynamic print job through
 * either transport (NATS JetStream or the HTTP APIs), whether it succeeded,
 * was recognised as a duplicate, or was rejected.
 *
 * This exists so a rejected/dead-lettered message is never just a silent
 * disappearance: sysadmins can see on the dashboard that a job DID arrive and
 * WHY it did not turn into a print job, instead of having to grep API logs.
 */

export type IntakeSource = 'nats' | 'api';
export type IntakeOutcome = 'accepted' | 'duplicate' | 'rejected';

export interface IntakeAttempt {
  id: string;
  source: IntakeSource;
  outcome: IntakeOutcome;
  occurredAt: Date;
  /** Human-readable rejection/duplicate reason. Undefined when accepted cleanly. */
  reason?: string;
  requestId?: string;
  sourceSystem?: string;
  sourceReference?: string;
  codeTemplate?: string;
  codeProfile?: string;
  printerCode?: string;
  /** NATS-only: the client id / subject the message arrived on. */
  clientId?: string;
  subject?: string;
  /** Set when outcome is 'accepted' or 'duplicate'. */
  jobId?: string;
}

export type CreateIntakeAttemptInput = Omit<IntakeAttempt, 'id' | 'occurredAt'>;
