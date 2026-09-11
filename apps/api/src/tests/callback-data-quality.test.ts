import { describe, expect, it } from 'vitest';
import type { Job, JobCallbackIntent, PrintJobTerminal } from '@printerops/domain';
import { buildResultCallbackPayload, extractRenderQuality } from '../services/result-callback-dispatcher.js';

function jobWith(metadata: Record<string, unknown>): Job {
  return {
    id: 'job-1',
    printerId: 'printer-1',
    createdBy: 'test',
    status: 'SUCCESS',
    priority: 50,
    priorityLabel: 'normal',
    traceId: 'trace-1',
    correlationId: 'corr-1',
    mimeType: 'text/plain',
    copies: 1,
    duplex: false,
    colorMode: 'auto',
    retryCount: 0,
    maxRetries: 0,
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const terminalEvent: PrintJobTerminal = {
  eventId: 'evt-1',
  eventType: 'PrintJobTerminal',
  traceId: 'trace-1',
  correlationId: 'corr-1',
  occurredAt: new Date(),
  jobId: 'job-1',
  status: 'SUCCESS',
} as PrintJobTerminal;

const intent: JobCallbackIntent = {
  enabled: true,
  transports: ['HTTP'],
  httpUrl: 'http://receiver.local/cb',
} as JobCallbackIntent;

describe('callback data quality (I-3)', () => {
  it('reports OK with empty lists when there were no render warnings', () => {
    const payload = buildResultCallbackPayload(terminalEvent, jobWith({}), intent);
    expect(payload['data_quality']).toBe('OK');
    expect(payload['missing_fields']).toEqual([]);
    expect(payload['render_warnings']).toEqual([]);
  });

  it('reports WITH_WARNINGS and parses missing fields out of the warnings', () => {
    const job = jobWith({
      renderWarnings: ['Missing field: hn', 'Missing field: barcode', "Could not render qrcode for 'x': boom"],
    });
    const payload = buildResultCallbackPayload(terminalEvent, job, intent);
    expect(payload['status']).toBe('SUCCESS');
    expect(payload['data_quality']).toBe('WITH_WARNINGS');
    expect(payload['missing_fields']).toEqual(['hn', 'barcode']);
    expect(payload['render_warnings']).toHaveLength(3);
  });

  it('ignores a malformed renderWarnings value instead of crashing the callback', () => {
    const quality = extractRenderQuality(jobWith({ renderWarnings: 'not-an-array' }));
    expect(quality.dataQuality).toBe('OK');
    expect(quality.warnings).toEqual([]);
  });
});
