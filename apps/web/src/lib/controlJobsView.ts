/**
 * Pure view helpers for the Web Control "Incoming Jobs" page.
 *
 * The page has to answer two questions in one place: how big is each status
 * bucket, and which rows does a bucket click show. If those two answers came
 * from different code paths they would drift — a chip reading "Needs review (3)"
 * above a list of four is the exact failure this module exists to prevent.
 *
 * Three rules live here, all of them plain functions so the page can compose
 * them without a React dependency:
 *
 *   - the bucket a status belongs to (`matchesStatusBucket`),
 *   - the counts over a filtered set (`countStatusBuckets`),
 *   - the operator-first row order (`sortAttentionFirst`).
 *
 * The "needs review" boundary is deliberately not redefined here: it is
 * `jobNeedsAttention` from `jobQueueView.ts`, which derives from the verdict
 * table in `jobVerdict.ts`. One definition, shared with every other list.
 */

import { jobNeedsAttention } from './jobQueueView.js';

export type StatusBucket = 'ALL' | 'NEEDS_REVIEW' | 'IN_PROGRESS' | 'PRINTED' | 'OTHER';

/**
 * The active-queue set: a job that is somewhere between intake and the printer
 * head. Mirrors `ACTIVE_QUEUE_STATUSES` in `jobPayload.ts` so "In progress"
 * cannot mean something different from the queue's own definition.
 */
const IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set<string>([
  'ACCEPTED',
  'VALIDATED',
  'QUEUED',
  'DISPATCHED',
  'PRINTING',
]);

export interface StatusBucketCounts {
  all: number;
  needsReview: number;
  inProgress: number;
  printed: number;
  other: number;
}

/** Anything carrying the server's literal status string. */
export interface BucketableJob {
  status: string;
}

/**
 * Whether a row belongs to a bucket.
 *
 * The buckets are disjoint by construction: `jobNeedsAttention` covers the
 * caution/negative verdict tones (FAILED, UNVERIFIED, TIMEOUT and any unknown
 * status), the in-progress set covers the pipeline, `SUCCESS` is Printed, and
 * Other is the remainder — never a catch-all for unknown statuses, which belong
 * to Needs review because the app cannot say whether paper moved.
 *
 * `reviewed` is the control-plane acknowledgement of an outcome an operator has
 * already checked. It removes the row from Needs review without rewriting the
 * station's status: the acknowledgement is a triage fact, not print evidence.
 * A reviewed UNVERIFIED job therefore lands in Other, next to the outcomes that
 * are already closed for the operator.
 */
export function matchesStatusBucket(
  status: string,
  bucket: StatusBucket,
  reviewed = false,
): boolean {
  switch (bucket) {
    case 'ALL':
      return true;
    case 'NEEDS_REVIEW':
      return !reviewed && jobNeedsAttention(status);
    case 'IN_PROGRESS':
      return IN_PROGRESS_STATUSES.has(status);
    case 'PRINTED':
      return status === 'SUCCESS';
    case 'OTHER':
      if (reviewed) {
        return !IN_PROGRESS_STATUSES.has(status) && status !== 'SUCCESS';
      }
      return (
        status !== 'SUCCESS' &&
        !IN_PROGRESS_STATUSES.has(status) &&
        !jobNeedsAttention(status)
      );
    default:
      return false;
  }
}

export interface BucketCountOptions<T extends BucketableJob> {
  /** Which rows need a human. Defaults to the shared status verdict. */
  isAttention?: (job: T) => boolean;
}

/** Counts for every bucket over the already-filtered set (status bucket excluded). */
export function countStatusBuckets<T extends BucketableJob>(
  jobs: readonly T[],
  options: BucketCountOptions<T> = {},
): StatusBucketCounts {
  const isAttention = options.isAttention ?? ((job: T) => jobNeedsAttention(job.status));
  let needsReview = 0;
  let inProgress = 0;
  let printed = 0;

  for (const job of jobs) {
    if (isAttention(job)) needsReview += 1;
    if (IN_PROGRESS_STATUSES.has(job.status)) inProgress += 1;
    if (job.status === 'SUCCESS') printed += 1;
  }

  const all = jobs.length;
  return {
    all,
    needsReview,
    inProgress,
    printed,
    other: all - needsReview - inProgress - printed,
  };
}

export interface SortableJob {
  id: string;
  status: string;
  createdAt: string;
}

function createdMs(job: SortableJob): number | null {
  const ms = Date.parse(job.createdAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Attention first, then newest first, then `id` ascending for a stable order.
 *
 * Returns a copy: the caller's array is often a memoised feed slice that several
 * views share. An unparseable timestamp sorts after every real one and falls
 * through to the same `id` tie-break rather than making the order random.
 */
export function sortAttentionFirst<T extends SortableJob>(
  jobs: readonly T[],
  options: { isAttention?: (job: T) => boolean } = {},
): T[] {
  const isAttention = options.isAttention ?? ((job: T) => jobNeedsAttention(job.status));
  return [...jobs].sort((a, b) => {
    const aNeedsReview = isAttention(a);
    const bNeedsReview = isAttention(b);
    if (aNeedsReview !== bNeedsReview) return aNeedsReview ? -1 : 1;

    const aMs = createdMs(a);
    const bMs = createdMs(b);
    if (aMs !== null && bMs !== null && aMs !== bMs) return bMs - aMs;
    if (aMs !== null && bMs === null) return -1;
    if (aMs === null && bMs !== null) return 1;

    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

export type JobSortMode = 'attention' | 'newest' | 'oldest';

/**
 * The list order the operator chose.
 *
 * `attention` is the triage order above (what needs a human, then newest).
 * `newest` and `oldest` are pure received-time orders, which an operator needs
 * when they are reconciling one shift's output rather than triaging. Rows whose
 * timestamp cannot be parsed stay in a stable tail instead of jumping around.
 */
export function sortJobs<T extends SortableJob>(
  jobs: readonly T[],
  mode: JobSortMode,
  options: { isAttention?: (job: T) => boolean } = {},
): T[] {
  if (mode === 'attention') return sortAttentionFirst(jobs, options);
  const direction = mode === 'newest' ? -1 : 1;
  return [...jobs].sort((a, b) => {
    const aMs = createdMs(a);
    const bMs = createdMs(b);
    if (aMs !== null && bMs !== null && aMs !== bMs) return (aMs - bMs) * direction;
    if (aMs !== null && bMs === null) return -1;
    if (aMs === null && bMs !== null) return 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}
