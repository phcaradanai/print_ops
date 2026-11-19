import { getJobVerdict } from './jobVerdict.js';

/**
 * The "needs review" boundary: a job needs eyes when its verdict tone is caution
 * (outcome not confirmed) or negative (known problem) — `FAILED`, `UNVERIFIED`,
 * `TIMEOUT`, and any status this build does not recognise. Success states and
 * ordinary pipeline progress never land here, and every list in the app derives
 * the boundary from the one verdict table rather than restating it.
 *
 * The queue's own filtering (search, dates, `key = value`, grouping) lives in
 * `jobPayload.ts` (`filterAndGroupJobs`), the buckets in `controlJobsView.ts`;
 * this module exists only so the boundary has exactly one definition.
 */
export function jobNeedsAttention(status: string): boolean {
  const { tone } = getJobVerdict(status);
  return tone === 'caution' || tone === 'negative';
}
