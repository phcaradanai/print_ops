/**
 * Job status → operator verdict.
 *
 * `packages/domain` models ten job statuses. To a person holding a label
 * printer they collapse into three realities and one question:
 *
 *   a page came out          → do nothing
 *   no page came out         → reprint freely
 *   nobody can say           → CHECK THE PRINTER FIRST
 *
 * That third row is the entire reason `UNVERIFIED` exists as a status
 * (see the comment on JOB_STATUSES in packages/domain/src/models/job.ts).
 * Rendering it as one more uppercase enum name in a coloured badge throws the
 * distinction away at the exact moment it matters.
 *
 * This module is the single place that decides which reality a status belongs
 * to and whether reprinting is safe, routine, or a judgement call. It holds no
 * copy — only key names — so the wording stays in `translations.ts` where both
 * languages live side by side.
 */

import { JOB_STATUSES, type JobStatus } from '@printerops/domain';

/**
 * How a reprint should be offered.
 *
 * - `none`      — the job is not over, or reprinting this job is never right.
 * - `routine`   — nothing printed. Reprinting is the expected next step.
 * - `caution`   — a page may already exist. The duplicate-risk acknowledgement
 *                 is the point of the dialog, not a checkbox to clear.
 * - `redundant` — a page definitely exists. Available, deliberately quiet.
 */
export type ReprintStance = 'none' | 'routine' | 'caution' | 'redundant';

/** Drives the verdict band's accent. Maps onto the semantic palette. */
export type VerdictTone =
  | 'confirmed'
  | 'progress'
  | 'pending'
  | 'caution'
  | 'negative'
  | 'neutral';

export interface JobVerdict {
  /** i18n key stem: `page.jobDetail.verdict.<copyKey>.headline` / `.detail`. */
  copyKey: string;
  tone: VerdictTone;
  reprint: ReprintStance;
  /**
   * True when the outcome is genuinely unknown. The reprint dialog leads with
   * the duplicate warning in this case rather than burying it under the form.
   */
  outcomeUnknown: boolean;
}

const VERDICTS: Record<JobStatus, JobVerdict> = {
  ACCEPTED: { copyKey: 'waiting', tone: 'pending', reprint: 'none', outcomeUnknown: false },
  VALIDATED: { copyKey: 'waiting', tone: 'pending', reprint: 'none', outcomeUnknown: false },
  QUEUED: { copyKey: 'waiting', tone: 'pending', reprint: 'none', outcomeUnknown: false },
  // Kept apart from `waiting`: "still in the queue" and "already handed off"
  // are different answers to "can I still stop this?"
  DISPATCHED: { copyKey: 'sent', tone: 'progress', reprint: 'none', outcomeUnknown: false },
  PRINTING: { copyKey: 'printing', tone: 'progress', reprint: 'none', outcomeUnknown: false },
  SUCCESS: { copyKey: 'printed', tone: 'confirmed', reprint: 'redundant', outcomeUnknown: false },
  // The hinge. Sent, no fault reported, no confirmation that paper moved.
  UNVERIFIED: { copyKey: 'unverified', tone: 'caution', reprint: 'caution', outcomeUnknown: true },
  // Same stance as UNVERIFIED, different wording: "nothing came back at all"
  // and "something came back but confirmed nothing" send an operator to check
  // different things at the device.
  TIMEOUT: { copyKey: 'timeout', tone: 'caution', reprint: 'caution', outcomeUnknown: true },
  FAILED: { copyKey: 'failed', tone: 'negative', reprint: 'routine', outcomeUnknown: false },
  CANCELLED: { copyKey: 'cancelled', tone: 'neutral', reprint: 'routine', outcomeUnknown: false },
  // Reprinting *this* job is never right — it never printed because an
  // identical request already had. Send the operator to the original.
  DUPLICATE_RETURNED: { copyKey: 'duplicate', tone: 'neutral', reprint: 'none', outcomeUnknown: false },
};

/**
 * Unknown status strings are treated as unknown OUTCOMES, never as successes.
 * A status this build has not heard of is exactly the case where assuming a
 * page came out (or did not) is unsafe.
 */
const UNKNOWN_VERDICT: JobVerdict = {
  copyKey: 'unknown',
  tone: 'caution',
  reprint: 'caution',
  outcomeUnknown: true,
};

const KNOWN: ReadonlySet<string> = new Set<string>(JOB_STATUSES);

export function getJobVerdict(status: string): JobVerdict {
  return KNOWN.has(status) ? VERDICTS[status as JobStatus] : UNKNOWN_VERDICT;
}

export function verdictHeadlineKey(verdict: JobVerdict): string {
  return `page.jobDetail.verdict.${verdict.copyKey}.headline`;
}

export function verdictDetailKey(verdict: JobVerdict): string {
  return `page.jobDetail.verdict.${verdict.copyKey}.detail`;
}

/** Whether a reprint control should appear at all for this status. */
export function offersReprint(verdict: JobVerdict): boolean {
  return verdict.reprint !== 'none';
}

/**
 * Button variant for the reprint control.
 *
 * `caution` uses the danger variant not because reprinting is destructive, but
 * because the thing it risks — a second physical label for one patient — is.
 */
export function reprintButtonVariant(verdict: JobVerdict): 'primary' | 'secondary' | 'danger' {
  switch (verdict.reprint) {
    case 'caution':
      return 'danger';
    case 'redundant':
      return 'secondary';
    default:
      return 'primary';
  }
}
