import type { ExportPort, ExportFormat, Job, AuditLog, Printer } from '@printerops/domain';

function toCsv<T extends object>(items: T[], headers: (keyof T)[]): string {
  if (items.length === 0) return headers.join(',') + '\n';
  const rows = items.map((item) =>
    headers.map((h) => {
      const val = item[h];
      if (val == null) return '';
      if (val instanceof Date) return val.toISOString();
      if (typeof val === 'object') return JSON.stringify(val).replace(/,/g, ';');
      return String(val).replace(/,/g, ';');
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export class InMemoryExportAdapter implements ExportPort {
  async exportJobs(jobs: Job[], format: ExportFormat): Promise<string> {
    if (format === 'json') return JSON.stringify(jobs, null, 2);
    const headers: (keyof Job)[] = [
      'id', 'printerId', 'printerCode', 'sourceSystem', 'sourceReference',
      'requestId', 'createdBy', 'status', 'priorityLabel', 'copies',
      'mimeType', 'templateCode', 'retryCount',
      'receivedAt', 'validatedAt', 'queuedAt', 'dispatchedAt',
      'startedAt', 'finishedAt', 'completedAt',
      'adapterUsed', 'runnerId', 'errorCode', 'errorMessage', 'createdAt',
    ];
    return toCsv(jobs, headers);
  }

  async exportAuditLogs(logs: AuditLog[], format: ExportFormat): Promise<string> {
    if (format === 'json') return JSON.stringify(logs, null, 2);
    const headers: (keyof AuditLog)[] = [
      'id', 'traceId', 'action', 'actorId', 'actorEmail',
      'resourceType', 'resourceId', 'occurredAt',
    ];
    return toCsv(logs, headers);
  }

  async exportPrinters(printers: Printer[], format: ExportFormat): Promise<string> {
    if (format === 'json') return JSON.stringify(printers, null, 2);
    const headers: (keyof Printer)[] = [
      'id', 'code', 'name', 'location', 'protocol',
      'connectionUri', 'isActive', 'maxCopiesPerJob', 'createdAt',
    ];
    return toCsv(printers, headers);
  }
}
