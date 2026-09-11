import { JOB_STATUSES, type JobStatus } from '@printerops/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobQueueControls } from './JobQueueControls.js';

const counts = Object.fromEntries(JOB_STATUSES.map((status) => [status, status === 'FAILED' ? 2 : 0])) as Record<JobStatus, number>;

describe('JobQueueControls', () => {
  it('composes a visually scoped status and search surface', () => {
    const markup = renderToStaticMarkup(
      <JobQueueControls
        status="FAILED"
        search="HN-123"
        counts={counts}
        totalCount={7}
        labels={{
          status: 'สถานะ',
          all: 'ทั้งหมด',
          search: 'ค้นหา',
          searchPlaceholder: 'รหัสงานหรือเครื่องพิมพ์',
        }}
        onStatusChange={() => undefined}
        onSearchChange={() => undefined}
      />,
    );

    expect(markup).toContain('ui-resource-toolbar');
    expect(markup).toContain('job-queue-toolbar');
    expect(markup).toContain('job-queue-toolbar__status');
    expect(markup).toContain('job-queue-toolbar__search');
    expect(markup).toContain('ui-select-filter');
    expect(markup).toContain('ui-search-field');
    expect(markup).toContain('ทั้งหมด (7)');
    expect(markup).toContain('FAILED (2)');
    expect(markup).toContain('value="HN-123"');
    expect(markup).not.toContain('job-queue-controls');
  });
});
