import { describe, expect, it } from 'vitest';
import type { Job } from '@printerops/domain';
import { orderQueuedCandidates } from '../routes/v1/runner-jobs.routes.js';

function job(id: string, priority: number, queuedAt: string): Job {
  return {
    id,
    priority,
    queuedAt: new Date(queuedAt),
    createdAt: new Date(queuedAt),
  } as Job;
}

describe('runner queued-job ordering', () => {
  it('uses priority then FIFO instead of the repository list view newest-first order', () => {
    const ordered = orderQueuedCandidates([
      job('normal-new', 50, '2026-07-31T10:00:02Z'),
      job('urgent', 100, '2026-07-31T10:00:03Z'),
      job('normal-old', 50, '2026-07-31T10:00:01Z'),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['urgent', 'normal-old', 'normal-new']);
  });
});
