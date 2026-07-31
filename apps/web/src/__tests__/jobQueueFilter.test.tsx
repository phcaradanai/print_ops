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
});
