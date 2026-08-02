import { JOB_STATUSES, type JobStatus } from '@printerops/domain';
import type { JobQueueStatusFilter } from '../lib/jobQueueView.js';
import { ResourceToolbar, SearchField, SelectFilter } from './ui/index.js';
import './JobQueueControls.css';

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
  };
  onStatusChange: (status: JobQueueStatusFilter) => void;
  onSearchChange: (search: string) => void;
}

/** Job Queue adapter over the page-agnostic resource-toolbar components. */
export function JobQueueControls({
  status,
  search,
  counts,
  totalCount,
  labels,
  onStatusChange,
  onSearchChange,
}: JobQueueControlsProps) {
  return (
    <ResourceToolbar
      ariaLabel={`${labels.status}; ${labels.search}`}
      className="job-queue-toolbar"
    >
      <SelectFilter
        className="job-queue-toolbar__status"
        label={labels.status}
        value={status}
        onValueChange={(value) => onStatusChange(value as JobQueueStatusFilter)}
      >
        <option value="ALL">{labels.all} ({totalCount})</option>
        {JOB_STATUSES.map((jobStatus) => (
          <option key={jobStatus} value={jobStatus}>
            {jobStatus} ({counts[jobStatus] ?? 0})
          </option>
        ))}
      </SelectFilter>

      <SearchField
        className="job-queue-toolbar__search"
        label={labels.search}
        value={search}
        placeholder={labels.searchPlaceholder}
        onValueChange={onSearchChange}
      />
    </ResourceToolbar>
  );
}
