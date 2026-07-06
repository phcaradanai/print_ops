import type { ExportPort, ExportFormat, Job } from '@printerops/domain';

export class InMemoryExportAdapter implements ExportPort {
  async exportJobs(jobs: Job[], format: ExportFormat): Promise<string> {
    if (format === 'json') {
      return JSON.stringify(jobs, null, 2);
    }
    if (jobs.length === 0) return '';
    const headers = [
      'id', 'printerId', 'createdBy', 'status', 'priority',
      'mimeType', 'copies', 'duplex', 'colorMode',
      'retryCount', 'queuedAt', 'startedAt', 'finishedAt', 'createdAt',
    ];
    const rows = jobs.map((j) =>
      headers.map((h) => {
        const val = (j as unknown as Record<string, unknown>)[h];
        return val instanceof Date ? val.toISOString() : String(val ?? '');
      }).join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }
}
