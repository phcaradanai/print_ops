import type { Job } from '../models/job.js';

export type ExportFormat = 'csv' | 'json';

export interface ExportPort {
  exportJobs(jobs: Job[], format: ExportFormat): Promise<string>;
}
