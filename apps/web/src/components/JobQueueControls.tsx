import { JOB_STATUSES, type JobStatus } from '@printerops/domain';
import type { JobQueueStatusFilter } from '../lib/jobQueueView.js';

export function JobQueueControls({
  status,
  search,
  counts,
  totalCount,
  labels,
  onStatusChange,
  onSearchChange,
}: {
  status: JobQueueStatusFilter;
  search: string;
  counts: Record<JobStatus, number>;
  totalCount: number;
  labels: { status: string; all: string; search: string; searchPlaceholder: string };
  onStatusChange: (status: JobQueueStatusFilter) => void;
  onSearchChange: (search: string) => void;
}) {
  return (
    <div className="job-queue-controls" aria-label={labels.status}>
      <label className="job-queue-control">
        <span>{labels.status}</span>
        <select
          aria-label={labels.status}
          value={status}
          onChange={(event) => onStatusChange(event.target.value as JobQueueStatusFilter)}
        >
          <option value="ALL">{labels.all} ({totalCount})</option>
          {JOB_STATUSES.map((jobStatus) => (
            <option key={jobStatus} value={jobStatus}>
              {jobStatus} ({counts[jobStatus]})
            </option>
          ))}
        </select>
      </label>
      <label className="job-queue-control job-queue-control--search">
        <span>{labels.search}</span>
        <input
          type="search"
          value={search}
          placeholder={labels.searchPlaceholder}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
    </div>
  );
}
