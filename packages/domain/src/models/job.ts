export type JobStatus =
  | 'ACCEPTED'
  | 'VALIDATED'
  | 'QUEUED'
  | 'DISPATCHED'
  | 'PRINTING'
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'DUPLICATE_RETURNED';

export type JobPriority = 'urgent' | 'high' | 'normal' | 'low';

export const PRIORITY_WEIGHT: Record<JobPriority, number> = {
  urgent: 100,
  high: 75,
  normal: 50,
  low: 25,
};

export interface TraceStep {
  stepName: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  status: 'running' | 'success' | 'failed' | 'skipped';
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
}

export interface JobTrace {
  id: string;
  jobId: string;
  traceId: string;
  correlationId: string;
  source: string;
  destination: string;
  runnerId?: string;
  printerId: string;
  adapterName: string;
  queuedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  status: JobStatus;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  evidence: Record<string, unknown>;
  steps: TraceStep[];
}

/** Fast-print-path timing measurements (all in milliseconds). */
export interface JobLatency {
  totalLatencyMs?: number;
  validationMs?: number;
  queueWaitMs?: number;
  dispatchMs?: number;
  runnerExecMs?: number;
  spoolerMs?: number;
  printerAckMs?: number;
}

export interface Job {
  id: string;
  printerId: string;
  printerCode?: string;
  templateCode?: string;
  createdBy: string;
  sourceSystem?: string;
  sourceReference?: string;
  requestId?: string;
  status: JobStatus;
  priority: number;
  priorityLabel: JobPriority;
  traceId: string;
  correlationId: string;
  documentUrl?: string;
  documentBase64?: string;
  payloadSnapshot?: string;
  mimeType: string;
  copies: number;
  duplex: boolean;
  colorMode: 'color' | 'monochrome' | 'auto';
  mediaType?: string;
  resolution?: string;
  retryCount: number;
  maxRetries: number;
  receivedAt?: Date;
  validatedAt?: Date;
  queuedAt?: Date;
  dispatchedAt?: Date;
  runnerReceivedAt?: Date;
  spoolerSentAt?: Date;
  printerAckAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  completedAt?: Date;
  latency?: JobLatency;
  errorCode?: string;
  errorMessage?: string;
  runnerId?: string;
  adapterUsed?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateJobInput = Pick<
  Job,
  | 'printerId'
  | 'createdBy'
  | 'mimeType'
  | 'copies'
  | 'duplex'
  | 'colorMode'
  | 'metadata'
> & {
  documentUrl?: string;
  documentBase64?: string;
  priority?: number;
  priorityLabel?: JobPriority;
  maxRetries?: number;
  mediaType?: string;
  resolution?: string;
  printerCode?: string;
  templateCode?: string;
  sourceSystem?: string;
  sourceReference?: string;
  requestId?: string;
  payloadSnapshot?: string;
};
