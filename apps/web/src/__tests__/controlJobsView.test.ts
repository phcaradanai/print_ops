/**
 * Contract tests for the Web Control "Incoming Jobs" view helpers.
 *
 * These are the three rules the page cannot get wrong without lying to the
 * operator: which bucket a status belongs to, whether the bucket counts add up
 * to the whole set, and the row order the list promises ("what needs review
 * first, then newest"). The E2E suite proves the rendered page agrees; these
 * keep the boundary itself cheap to pin down.
 */

import { describe, expect, it } from 'vitest';
import {
  countStatusBuckets,
  matchesStatusBucket,
  sortAttentionFirst,
  type SortableJob,
  type StatusBucket,
  type StatusBucketCounts,
} from '../lib/controlJobsView.js';

/** Every bucket except ALL, which is the "no filter" state rather than a slice. */
const SLICE_BUCKETS: readonly StatusBucket[] = [
  'NEEDS_REVIEW',
  'IN_PROGRESS',
  'PRINTED',
  'OTHER',
];

/** The expected bucket for each status the redesign reasons about. */
const EXPECTED_BUCKET: ReadonlyArray<[status: string, bucket: StatusBucket]> = [
  ['FAILED', 'NEEDS_REVIEW'],
  ['UNVERIFIED', 'NEEDS_REVIEW'],
  ['TIMEOUT', 'NEEDS_REVIEW'],
  ['SOMETHING_THIS_BUILD_DOES_NOT_KNOW', 'NEEDS_REVIEW'],
  ['ACCEPTED', 'IN_PROGRESS'],
  ['VALIDATED', 'IN_PROGRESS'],
  ['QUEUED', 'IN_PROGRESS'],
  ['DISPATCHED', 'IN_PROGRESS'],
  ['PRINTING', 'IN_PROGRESS'],
  ['SUCCESS', 'PRINTED'],
  ['CANCELLED', 'OTHER'],
  ['DUPLICATE_RETURNED', 'OTHER'],
];

function job(status: string, id = `job-${status}`, createdAt = '2026-11-17T09:00:00.000Z'): SortableJob {
  return { id, status, createdAt };
}

describe('matchesStatusBucket', () => {
  it('puts every status in exactly one slice bucket', () => {
    for (const [status, expected] of EXPECTED_BUCKET) {
      const matched = SLICE_BUCKETS.filter((bucket) => matchesStatusBucket(status, bucket));
      expect(matched, `status ${status} matched ${matched.join(', ') || 'no bucket'}`).toEqual([
        expected,
      ]);
    }
  });

  it('maps the attention statuses to Needs review', () => {
    for (const status of ['FAILED', 'UNVERIFIED', 'TIMEOUT']) {
      expect(matchesStatusBucket(status, 'NEEDS_REVIEW'), status).toBe(true);
    }
  });

  it('treats an unrecognised status as Needs review, never as Other', () => {
    expect(matchesStatusBucket('EXOTIC_NEW_STATUS', 'NEEDS_REVIEW')).toBe(true);
    expect(matchesStatusBucket('EXOTIC_NEW_STATUS', 'OTHER')).toBe(false);
  });

  it('keeps the active queue in In progress', () => {
    for (const status of ['ACCEPTED', 'VALIDATED', 'QUEUED', 'DISPATCHED', 'PRINTING']) {
      expect(matchesStatusBucket(status, 'IN_PROGRESS'), status).toBe(true);
    }
  });

  it('keeps the remainder in Other', () => {
    expect(matchesStatusBucket('CANCELLED', 'OTHER')).toBe(true);
    expect(matchesStatusBucket('DUPLICATE_RETURNED', 'OTHER')).toBe(true);
  });

  it('lets ALL admit every status', () => {
    for (const [status] of EXPECTED_BUCKET) {
      expect(matchesStatusBucket(status, 'ALL'), status).toBe(true);
    }
  });

  it('matches nothing for a bucket this build does not define', () => {
    expect(matchesStatusBucket('SUCCESS', 'NOT_A_BUCKET' as StatusBucket)).toBe(false);
  });
});

describe('countStatusBuckets', () => {
  it('counts each bucket from the statuses present', () => {
    const counts = countStatusBuckets([
      job('UNVERIFIED'),
      job('FAILED'),
      job('TIMEOUT'),
      job('QUEUED'),
      job('PRINTING'),
      job('SUCCESS'),
      job('SUCCESS'),
      job('CANCELLED'),
      job('DUPLICATE_RETURNED'),
    ]);

    expect(counts).toEqual<StatusBucketCounts>({
      all: 9,
      needsReview: 3,
      inProgress: 2,
      printed: 2,
      other: 2,
    });
  });

  it('keeps the four buckets exhaustive and disjoint over a mixed set', () => {
    const statuses = [
      'ACCEPTED',
      'VALIDATED',
      'QUEUED',
      'DISPATCHED',
      'PRINTING',
      'SUCCESS',
      'UNVERIFIED',
      'TIMEOUT',
      'FAILED',
      'CANCELLED',
      'DUPLICATE_RETURNED',
      'UNRECOGNISED',
    ];
    const jobs = statuses.map((status) => job(status));
    const counts = countStatusBuckets(jobs);

    expect(counts.all).toBe(jobs.length);
    expect(counts.needsReview + counts.inProgress + counts.printed + counts.other).toBe(counts.all);
    // Each source status contributes to exactly one bucket, so the sum of the
    // slice counts must equal the sum of the per-status matches.
    const sliceSum = SLICE_BUCKETS.reduce(
      (total, bucket) => total + jobs.filter((entry) => matchesStatusBucket(entry.status, bucket)).length,
      0,
    );
    expect(sliceSum).toBe(jobs.length);
  });

  it('counts an empty set as all zeroes', () => {
    expect(countStatusBuckets([])).toEqual<StatusBucketCounts>({
      all: 0,
      needsReview: 0,
      inProgress: 0,
      printed: 0,
      other: 0,
    });
  });

  it('never lets Other absorb an unknown status', () => {
    const counts = countStatusBuckets([job('SOMETHING_NEW')]);
    expect(counts.needsReview).toBe(1);
    expect(counts.other).toBe(0);
  });
});

describe('sortAttentionFirst', () => {
  it('lists attention jobs before the rest, then newest first', () => {
    const ordered = sortAttentionFirst([
      job('SUCCESS', 'success-new', '2026-11-17T10:00:00.000Z'),
      job('FAILED', 'failed-old', '2026-11-15T10:00:00.000Z'),
      job('CANCELLED', 'cancelled', '2026-11-17T11:00:00.000Z'),
      job('UNVERIFIED', 'unverified-new', '2026-11-17T09:00:00.000Z'),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual([
      'unverified-new',
      'failed-old',
      'cancelled',
      'success-new',
    ]);
  });

  it('breaks a createdAt tie by id ascending', () => {
    const stamp = '2026-11-17T09:00:00.000Z';
    const ordered = sortAttentionFirst([
      job('FAILED', 'b', stamp),
      job('FAILED', 'a', stamp),
      job('SUCCESS', 'd', stamp),
      job('SUCCESS', 'c', stamp),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not mutate the caller array', () => {
    const input = [
      job('SUCCESS', 'printed', '2026-11-17T10:00:00.000Z'),
      job('FAILED', 'failed', '2026-11-15T10:00:00.000Z'),
    ];
    const snapshot = input.map((entry) => entry.id);

    const ordered = sortAttentionFirst(input);

    expect(input.map((entry) => entry.id)).toEqual(snapshot);
    expect(ordered).not.toBe(input);
    expect(ordered.map((entry) => entry.id)).toEqual(['failed', 'printed']);
  });

  it('keeps an unparseable createdAt after every real timestamp, stably by id', () => {
    const ordered = sortAttentionFirst([
      job('SUCCESS', 'broken-b', 'not-a-date'),
      job('SUCCESS', 'valid-new', '2026-11-17T10:00:00.000Z'),
      job('SUCCESS', 'broken-a', ''),
      job('SUCCESS', 'valid-old', '2026-11-16T10:00:00.000Z'),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual([
      'valid-new',
      'valid-old',
      'broken-a',
      'broken-b',
    ]);
    // Calling it again must not reorder the invalid tail.
    expect(sortAttentionFirst(ordered).map((entry) => entry.id)).toEqual(
      ordered.map((entry) => entry.id),
    );
  });

  it('sorts a single job and an empty list without throwing', () => {
    expect(sortAttentionFirst([])).toEqual([]);
    const only = [job('SUCCESS', 'only')];
    expect(sortAttentionFirst(only).map((entry) => entry.id)).toEqual(['only']);
  });
});
