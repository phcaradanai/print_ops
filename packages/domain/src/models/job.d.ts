export type JobStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'RETRYING';
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
export interface Job {
    id: string;
    printerId: string;
    createdBy: string;
    status: JobStatus;
    priority: number;
    traceId: string;
    correlationId: string;
    documentUrl?: string;
    documentBase64?: string;
    mimeType: string;
    copies: number;
    duplex: boolean;
    colorMode: 'color' | 'monochrome' | 'auto';
    mediaType?: string;
    resolution?: string;
    retryCount: number;
    maxRetries: number;
    queuedAt?: Date;
    startedAt?: Date;
    finishedAt?: Date;
    errorCode?: string;
    errorMessage?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export type CreateJobInput = Pick<Job, 'printerId' | 'createdBy' | 'mimeType' | 'copies' | 'duplex' | 'colorMode' | 'metadata'> & {
    documentUrl?: string;
    documentBase64?: string;
    priority?: number;
    maxRetries?: number;
    mediaType?: string;
    resolution?: string;
};
//# sourceMappingURL=job.d.ts.map