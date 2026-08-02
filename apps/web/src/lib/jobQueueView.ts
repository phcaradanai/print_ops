import { JOB_STATUSES, type JobStatus } from '@printerops/domain';

export type JobQueueStatusFilter = 'ALL' | JobStatus;

export interface JobQueueListItem {
  id: string;
  printerCode?: string;
  printerId: string;
  status: string;
  sourceSystem?: string;
  sourceReference?: string;
  requestId?: string;
  templateCode?: string;
  resolvedTemplateCode?: string;
  payloadSnapshot?: string;
}

export interface JobQueueView<T extends JobQueueListItem> {
  rows: T[];
  filteredCount: number;
  totalPages: number;
  page: number;
  counts: Record<JobStatus, number>;
}

/** Apply search + exact domain-status filtering before slicing a page. */
export function buildJobQueueView<T extends JobQueueListItem>(
  jobs: T[],
  input: {
    status: JobQueueStatusFilter;
    search: string;
    page: number;
    pageSize: number;
  },
): JobQueueView<T> {
  const counts = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<JobStatus, number>;
  for (const job of jobs) {
    if (JOB_STATUSES.includes(job.status as JobStatus)) {
      counts[job.status as JobStatus] += 1;
    }
  }

  const needle = input.search.trim().toLocaleLowerCase();
  const filtered = jobs.filter((job) => {
    if (input.status !== 'ALL' && job.status !== input.status) return false;
    if (!needle) return true;
    return [
      job.id,
      job.status,
      job.printerCode,
      job.printerId,
      job.sourceSystem,
      job.sourceReference,
      job.requestId,
      job.templateCode,
      job.resolvedTemplateCode,
      job.payloadSnapshot,
    ].some((value) => value?.toLocaleLowerCase().includes(needle));
  });

  const pageSize = Math.max(1, Math.trunc(input.pageSize));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(input.page)));
  const offset = (page - 1) * pageSize;
  return {
    rows: filtered.slice(offset, offset + pageSize),
    filteredCount: filtered.length,
    totalPages,
    page,
    counts,
  };
}
