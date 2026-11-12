import { JOB_STATUSES, type JobStatus } from '@printerops/domain';
import type { JobQueueStatusFilter } from '../lib/jobQueueView.js';
import { ResourceToolbar, SearchField, SelectFilter } from './ui/index.js';

export interface JobQueueControlsProps {
  status: JobQueueStatusFilter;
  search: string;
  counts: Record<JobStatus, number>;
  totalCount: number;
  labels: {
    status: string;
    all: string;
    search: string;
    searchPlaceholder: string;
    /** When provided, a NEEDS_ATTENTION option is offered above ALL. */
    attention?: string;
  };
  /** How many rows the attention filter would keep; shown next to the option. */
  attentionCount?: number;
  onStatusChange: (status: JobQueueStatusFilter) => void;
  onSearchChange: (search: string) => void;
}

/** Job Queue adapter over the page-agnostic resource-toolbar components. */
export function JobQueueControls({
  status,
  search,
  counts,
  totalCount,
  attentionCount,
  labels,
  onStatusChange,
  onSearchChange,
}: JobQueueControlsProps) {
  return (
    <ResourceToolbar
      ariaLabel={`${labels.status}; ${labels.search}`}
      className="job-queue-toolbar"
    >
      <SearchField
        className="job-queue-toolbar__search"
        label={labels.search}
        value={search}
        placeholder={labels.searchPlaceholder}
        onValueChange={onSearchChange}
      />

      <SelectFilter
        className="job-queue-toolbar__status"
        label={labels.status}
        value={status}
        onValueChange={(value) => onStatusChange(value as JobQueueStatusFilter)}
      >
        {labels.attention != null && (
          <option value="NEEDS_ATTENTION">
            {labels.attention} ({attentionCount ?? 0})
          </option>
        )}
        <option value="ALL">{labels.all} ({totalCount})</option>
        {JOB_STATUSES.map((jobStatus) => (
          <option key={jobStatus} value={jobStatus}>
            {jobStatus} ({counts[jobStatus] ?? 0})
          </option>
        ))}
      </SelectFilter>
    </ResourceToolbar>
  );
}
