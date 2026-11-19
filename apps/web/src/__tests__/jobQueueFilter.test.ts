import { describe, expect, it } from 'vitest';
import { JOB_STATUSES } from '@printerops/domain';
import {
  countStatusBuckets,
  matchesStatusBucket,
  sortJobs,
  type StatusBucket,
} from '../lib/controlJobsView.js';
import { filterAndGroupJobs, type FilterableJob } from '../lib/jobPayload.js';

/**
 * The station Job Queue's list arithmetic.
 *
 * The page itself is layout; what can silently be wrong is the pipeline behind it,
 * and there is exactly one rule to defend: *a bucket count must equal the rows its
 * click shows*. Both sides of that promise derive from the same base set, so this
 * suite walks the base set once and checks every bucket against it, with search,
 * a date preset and a `key = value` filter active at the same time.
 */

const NOW = new Date('2026-11-18T12:00:00.000Z');

const JOBS: FilterableJob[] = [
  {
    id: 'job-a',
    printerId: 'p1',
    printerCode: 'ZEBRA_OPD_01',
    status: 'QUEUED',
    requestId: 'REQ-1',
    sourceSystem: 'medisync',
    createdAt: '2026-11-18T09:00:00.000Z',
    payload: { hn: '123456' },
  },
  {
    id: 'job-b',
    printerId: 'p1',
    printerCode: 'ZEBRA_OPD_01',
    status: 'SUCCESS',
    requestId: 'REQ-2',
    sourceSystem: 'medisync',
    createdAt: '2026-11-18T08:30:00.000Z',
    payload: { hn: '123456' },
  },
  {
    id: 'job-c',
    printerId: 'p2',
    printerCode: 'WRISTBAND_01',
    status: 'UNVERIFIED',
    requestId: 'REQ-3',
    sourceSystem: 'ward',
    createdAt: '2026-11-18T08:00:00.000Z',
    payload: { hn: '999888' },
  },
  {
    id: 'job-d',
    printerId: 'p2',
    printerCode: 'WRISTBAND_01',
    status: 'CANCELLED',
    requestId: 'REQ-4',
    sourceSystem: 'ward',
    createdAt: '2026-11-17T08:00:00.000Z',
  },
];

const BUCKETS: StatusBucket[] = ['ALL', 'NEEDS_REVIEW', 'IN_PROGRESS', 'PRINTED', 'OTHER'];

function baseJobs(overrides: Partial<Parameters<typeof filterAndGroupJobs>[1]> = {}): FilterableJob[] {
  return filterAndGroupJobs(JOBS, {
    status: 'ALL',
    search: '',
    datePreset: 'all',
    now: NOW,
    ...overrides,
  }).filteredJobs;
}

function rowsFor(base: FilterableJob[], bucket: StatusBucket): string[] {
  return base.filter((job) => matchesStatusBucket(job.status, bucket, false)).map((job) => job.id);
}

describe('station Job Queue list', () => {
  it('names every domain status once, so no bucket can silently drop one', () => {
    // The four content buckets are disjoint and cover every status the API can
    // return; All is the frame, never a competing member.
    const contentBuckets = BUCKETS.filter((bucket) => bucket !== 'ALL');
    for (const status of JOB_STATUSES) {
      const buckets = contentBuckets.filter((bucket) => matchesStatusBucket(status, bucket, false));
      expect(buckets).toHaveLength(1);
    }
    expect(contentBuckets).toHaveLength(4);
  });

  it('keeps a bucket count equal to the rows its click shows, with every filter active', () => {
    const base = baseJobs({
      search: 'wristband',
      datePreset: '7d',
      keyFilters: [{ key: 'hn', value: '9998', exact: false }],
    });
    const counts = countStatusBuckets(base);

    expect(counts.all).toBe(base.length);
    expect(counts.all).toBe(rowsFor(base, 'ALL').length);
    expect(counts.needsReview).toBe(rowsFor(base, 'NEEDS_REVIEW').length);
    expect(counts.inProgress).toBe(rowsFor(base, 'IN_PROGRESS').length);
    expect(counts.printed).toBe(rowsFor(base, 'PRINTED').length);
    expect(counts.other).toBe(rowsFor(base, 'OTHER').length);
    // The buckets partition the base set: nothing is counted twice or lost.
    expect(
      counts.needsReview + counts.inProgress + counts.printed + counts.other,
    ).toBe(counts.all);
  });

  it('counts an UNVERIFIED job as needs-review and a CANCELLED job as other', () => {
    const base = baseJobs();
    expect(rowsFor(base, 'NEEDS_REVIEW')).toEqual(['job-c']);
    expect(rowsFor(base, 'OTHER')).toEqual(['job-d']);
    expect(rowsFor(base, 'IN_PROGRESS')).toEqual(['job-a']);
    expect(rowsFor(base, 'PRINTED')).toEqual(['job-b']);
  });

  it('narrows by the exact status an advanced filter selects', () => {
    const base = baseJobs({ status: 'UNVERIFIED' });
    expect(base.map((job) => job.id)).toEqual(['job-c']);
  });

  it('sorts attention first, then newest first, with a stable tie-break', () => {
    const sorted = sortJobs(baseJobs(), 'attention').map((job) => job.id);
    expect(sorted).toEqual(['job-c', 'job-a', 'job-b', 'job-d']);

    const newest = sortJobs(baseJobs(), 'newest').map((job) => job.id);
    expect(newest).toEqual(['job-a', 'job-b', 'job-c', 'job-d']);

    const oldest = sortJobs(baseJobs(), 'oldest').map((job) => job.id);
    expect(oldest).toEqual(['job-d', 'job-c', 'job-b', 'job-a']);
  });

  it('pages without duplicating or dropping a row', () => {
    const base = baseJobs();
    const pageSize = 3;
    const pages = Math.ceil(base.length / pageSize);
    const seen: string[] = [];
    for (let page = 0; page < pages; page += 1) {
      seen.push(...base.slice(page * pageSize, (page + 1) * pageSize).map((job) => job.id));
    }
    expect(seen).toEqual(base.map((job) => job.id));
    expect(new Set(seen).size).toBe(base.length);
  });
});
