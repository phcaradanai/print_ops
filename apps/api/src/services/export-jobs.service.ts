import type { JobRepositoryPort, ExportPort, ExportFormat, Job } from '@printerops/domain';

export class ExportJobsService {
  constructor(
    private jobs: JobRepositoryPort,
    private exporter: ExportPort
  ) {}

  async execute(format: ExportFormat): Promise<string> {
    const jobs = await this.jobs.findAll({ limit: 10000 });
    return this.exporter.exportJobs(jobs, format);
  }
}
