import type { Job } from '@printerops/domain';

export type RedactedJob = Omit<Job, 'renderedPrintPayload'> & {
  renderedPrintPayload?: never;
};

export function redactJob(job: Job): RedactedJob {
  const { renderedPrintPayload: _renderedPrintPayload, ...safeJob } = job;
  return safeJob;
}

export function redactJobs(jobs: Job[]): RedactedJob[] {
  return jobs.map(redactJob);
}
