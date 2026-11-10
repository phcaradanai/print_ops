import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JOB_STATUSES } from '@printerops/domain';
import { JobQueueControls } from '../components/JobQueueControls.js';
import { buildJobQueueView } from '../lib/jobQueueView.js';

const jobs = [
  { id: 'job-a', printerId: 'p1', printerCode: 'LAB', status: 'QUEUED', requestId: 'REQ-1', sourceSystem: 'medisync' },
  { id: 'job-b', printerId: 'p1', printerCode: 'LAB', status: 'SUCCESS', requestId: 'REQ-2', sourceSystem: 'medisync' },
  { id: 'job-c', printerId: 'p2', printerCode: 'WARD', status: 'UNVERIFIED', requestId: 'REQ-3', sourceSystem: 'ward' },
];

describe('JobQueue status filter', () => {
  it('renders every status from the domain source of truth with counts', () => {
    const view = buildJobQueueView(jobs, { status: 'ALL', search: '', page: 1, pageSize: 20 });
    const html = renderToStaticMarkup(
      <JobQueueControls
        status="ALL"
        search=""
        counts={view.counts}
        totalCount={jobs.length}
        labels={{ status: 'Filter by status', all: 'All', search: 'Search', searchPlaceholder: 'Search jobs' }}
        onStatusChange={() => {}}
        onSearchChange={() => {}}
      />,
    );

    for (const status of JOB_STATUSES) expect(html).toContain(`value="${status}"`);
    expect(html).toContain('QUEUED (1)');
    expect(html).toContain('UNVERIFIED (1)');
    expect(html).toContain('FAILED (0)');
    expect(html).toContain('All (3)');
  });

  it('combines status, search and pagination without duplicates', () => {
    const expanded = Array.from({ length: 25 }, (_, index) => ({
      ...jobs[index % jobs.length]!,
      id: `job-${index}`,
    }));
    const view = buildJobQueueView(expanded, {
      status: 'QUEUED',
      search: 'lab',
      page: 2,
      pageSize: 5,
    });

    expect(view.filteredCount).toBe(9);
    expect(view.page).toBe(2);
    expect(view.totalPages).toBe(2);
    expect(view.rows).toHaveLength(4);
    expect(new Set(view.rows.map((job) => job.id)).size).toBe(view.rows.length);
    expect(view.rows.every((job) => job.status === 'QUEUED')).toBe(true);
  });

  it('clamps an obsolete page after auto-refresh while retaining the filter', () => {
    const view = buildJobQueueView(jobs, {
      status: 'UNVERIFIED',
      search: 'ward',
      page: 99,
      pageSize: 20,
    });
    expect(view.page).toBe(1);
    expect(view.rows.map((job) => job.id)).toEqual(['job-c']);
  });

  it('NEEDS_ATTENTION keeps every unresolved outcome and drops resolved ones', () => {
    const mixed = [
      ...jobs,
      { id: 'job-d', printerId: 'p1', printerCode: 'LAB', status: 'FAILED', requestId: 'REQ-4', sourceSystem: 'medisync' },
      { id: 'job-e', printerId: 'p1', printerCode: 'LAB', status: 'TIMEOUT', requestId: 'REQ-5', sourceSystem: 'medisync' },
      { id: 'job-f', printerId: 'p1', printerCode: 'LAB', status: 'SOME_UNKNOWN_STATUS', requestId: 'REQ-6', sourceSystem: 'medisync' },
      { id: 'job-g', printerId: 'p1', printerCode: 'LAB', status: 'CANCELLED', requestId: 'REQ-7', sourceSystem: 'medisync' },
      { id: 'job-h', printerId: 'p1', printerCode: 'LAB', status: 'DUPLICATE_RETURNED', requestId: 'REQ-8', sourceSystem: 'medisync' },
    ];
    const view = buildJobQueueView(mixed, { status: 'NEEDS_ATTENTION', search: '', page: 1, pageSize: 20 });
    const kept = new Set(view.rows.map((job) => job.id));
    // The boundary is the job verdict tone, not a hardcoded status list: an
    // unknown status is an operator item too (UNKNOWN_VERDICT is caution).
    expect(kept.has('job-c')).toBe(true); // UNVERIFIED — reported complete, never confirmed
    expect(kept.has('job-d')).toBe(true); // FAILED
    expect(kept.has('job-e')).toBe(true); // TIMEOUT
    expect(kept.has('job-f')).toBe(true); // unknown status from a newer build
    for (const resolved of ['job-a', 'job-b', 'job-g', 'job-h']) {
      expect(kept.has(resolved)).toBe(false); // QUEUED / SUCCESS / CANCELLED / DUPLICATE_RETURNED
    }
    expect(view.filteredCount).toBe(4);
    // The counters stay full-fleet: the filter changes rows, not the counts.
    expect(view.counts.QUEUED).toBe(1);
    expect(view.counts.UNVERIFIED).toBe(1);
    expect(view.counts.FAILED).toBe(1);
  });

  it('offers the attention option only when a label is provided', () => {
    const view = buildJobQueueView(jobs, { status: 'ALL', search: '', page: 1, pageSize: 20 });
    const render = (attention?: string) => renderToStaticMarkup(
      <JobQueueControls
        status="ALL"
        search=""
        counts={view.counts}
        totalCount={jobs.length}
        attentionCount={4}
        labels={{
          status: 'Filter by status',
          all: 'All',
          search: 'Search',
          searchPlaceholder: 'Search jobs',
          ...(attention !== undefined ? { attention } : {}),
        }}
        onStatusChange={() => {}}
        onSearchChange={() => {}}
      />,
    );
    expect(render('Needs attention')).toContain('value="NEEDS_ATTENTION"');
    expect(render('Needs attention')).toContain('Needs attention (4)');
    // Without the label the option disappears entirely — an empty/meaningless
    // entry is worse than none.
    expect(render(undefined)).not.toContain('value="NEEDS_ATTENTION"');
  });
});
