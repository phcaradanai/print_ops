import { JOB_STATUSES, type JobStatus } from '@printerops/domain';

import {
  extractJobPayload,
  matchesKeyFilter,
  parseJobSearchQuery,
  type JobKeyFilter,
} from './jobPayload.js';
import { getJobVerdict } from './jobVerdict.js';

export type JobQueueStatusFilter = 'ALL' | JobStatus | 'NEEDS_ATTENTION';

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
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Attention filter boundary: a job needs eyes when its verdict tone is
 * caution (outcome not confirmed) or negative (known problem) — FAILED,
 * UNVERIFIED, TIMEOUT, and any status this build does not recognise. Success
 * states and ordinary pipeline progress never land here, so the filter cannot
 * drift from the rest of the UI: both derive from the same verdict table.
 */
export function jobNeedsAttention(status: string): boolean {
  const { tone } = getJobVerdict(status);
  return tone === 'caution' || tone === 'negative';
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
    keyFilters?: JobKeyFilter[];
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

  const parsedSearch = parseJobSearchQuery(input.search);
  const activeKeyFilters = [
    ...(input.keyFilters ?? []).filter((f) => f.key.trim().length > 0 && f.value.trim().length > 0),
    ...parsedSearch.keyQueries,
  ];
  const filtered = jobs.filter((job) => {
    if (input.status === 'NEEDS_ATTENTION') {
      if (!jobNeedsAttention(job.status)) return false;
    } else if (input.status !== 'ALL' && job.status !== input.status) {
      return false;
    }
    const payload = extractJobPayload(job);
    for (const kf of activeKeyFilters) {
      if (!matchesKeyFilter(payload, kf)) return false;
    }
    if (parsedSearch.textTerms.length === 0) return true;
    const payloadParts = Object.entries(payload).flatMap(([key, value]) => [key, value]);
    const candidates = [
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
      ...payloadParts,
    ];
    return parsedSearch.textTerms.every((term) =>
      candidates.some((value) => value?.toLocaleLowerCase().includes(term)),
    );
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
