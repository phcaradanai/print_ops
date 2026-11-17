import type { ControlSyncedJob, Job } from '@printerops/domain';

export type RedactedJob = Omit<Job, 'renderedPrintPayload'> & {
  renderedPrintPayload?: never;
};

const SENSITIVE_KEY_PATTERN = /secret|token|password|api_?key/i;
const INTERNAL_PAYLOAD_KEYS = new Set([
  '_renderedPayload',
  'callbackIntent',
  'paperProfile',
  'printerCalibration',
  'templateSnapshot',
  'sandboxInput',
  'recovery',
  'printEvidence',
  'nats',
]);

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function sanitizePayloadRecord(source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(source)) {
    if (INTERNAL_PAYLOAD_KEYS.has(key)) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (val === undefined) continue;
    result[key] = val;
  }
  return result;
}

export function extractSafeJobPayload(job: Job): Record<string, unknown> {
  const meta = asPlainRecord(job.metadata);
  const direct = asPlainRecord(meta?.['payload']);
  const mapped = asPlainRecord(meta?.['mappedPayload']);
  const intake = asPlainRecord(meta?.['intakePayload']);
  const sandboxInput = asPlainRecord(meta?.['sandboxInput']);
  const sandboxSample = asPlainRecord(sandboxInput?.['samplePayload']);
  const sandboxScenarios = Array.isArray(sandboxInput?.['scenarios'])
    ? sandboxInput['scenarios'] as Array<Record<string, unknown>>
    : undefined;
  const firstScenarioSample = sandboxScenarios
    ? asPlainRecord(sandboxScenarios.find((item) => asPlainRecord(item?.['samplePayload']))?.['samplePayload'])
    : undefined;

  let merged: Record<string, unknown> = {
    ...(intake ?? {}),
    ...(mapped ?? {}),
    ...(direct ?? {}),
    ...(sandboxSample ?? firstScenarioSample ?? {}),
  };

  if (Object.keys(merged).length === 0 && typeof job.payloadSnapshot === 'string') {
    const trimmed = job.payloadSnapshot.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = asPlainRecord(JSON.parse(trimmed));
        if (parsed) {
          const nestedSample = asPlainRecord(parsed['samplePayload']);
          if (nestedSample) {
            merged = nestedSample;
          } else if (Array.isArray(parsed['scenarios'])) {
            const scenario = (parsed['scenarios'] as Array<Record<string, unknown>>)
              .find((item) => asPlainRecord(item?.['samplePayload']));
            merged = asPlainRecord(scenario?.['samplePayload']) ?? parsed;
          } else {
            merged = parsed;
          }
        }
      } catch {
        // Ignore non-JSON snapshot summaries like "keys=[a,b] len=12"
      }
    }
  }

  return sanitizePayloadRecord(merged);
}

function toIsoString(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function jobToControlSyncedJob(job: Job, deviceId: string): ControlSyncedJob {
  const meta = asPlainRecord(job.metadata);
  return {
    id: job.id,
    deviceId,
    ...(job.requestId ? { requestId: job.requestId } : {}),
    printerId: job.printerId,
    ...(job.printerCode ? { printerCode: job.printerCode } : {}),
    ...(job.templateCode ? { templateCode: job.templateCode } : {}),
    ...(job.resolvedTemplateCode ? { resolvedTemplateCode: job.resolvedTemplateCode } : {}),
    ...(job.paperProfileId ? { paperProfileId: job.paperProfileId } : {}),
    ...(job.sourceSystem ? { sourceSystem: job.sourceSystem } : {}),
    ...(job.sourceReference ? { sourceReference: job.sourceReference } : {}),
    status: job.status,
    copies: job.copies,
    ...(job.priorityLabel ? { priorityLabel: job.priorityLabel } : {}),
    ...(job.runnerId ? { runnerId: job.runnerId } : {}),
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
    ...(job.payloadSnapshot ? { payloadSnapshot: job.payloadSnapshot } : {}),
    payload: extractSafeJobPayload(job),
    createdAt: toIsoString(job.createdAt) ?? new Date().toISOString(),
    ...(job.completedAt ? { completedAt: toIsoString(job.completedAt) } : {}),
    ...(job.finishedAt ? { finishedAt: toIsoString(job.finishedAt) } : {}),
    ...(job.updatedAt ? { updatedAt: toIsoString(job.updatedAt) } : {}),
    ...(job.latency?.totalLatencyMs != null ? { latencyMs: job.latency.totalLatencyMs } : {}),
    ...(typeof meta?.['reprintOfJobId'] === 'string' ? { reprintOfJobId: meta['reprintOfJobId'] } : {}),
    ...(typeof meta?.['reprintOfRequestId'] === 'string' ? { reprintOfRequestId: meta['reprintOfRequestId'] } : {}),
    ...(typeof meta?.['reprintReason'] === 'string' ? { reprintReason: meta['reprintReason'] } : {}),
  };
}

export function redactJob(job: Job): RedactedJob {
  const { renderedPrintPayload: _renderedPrintPayload, ...safeJob } = job;
  return safeJob;
}

export function redactJobs(jobs: Job[]): RedactedJob[] {
  return jobs.map(redactJob);
}
