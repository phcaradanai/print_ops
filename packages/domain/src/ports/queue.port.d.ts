export interface JobQueueMessage {
    jobId: string;
    printerId: string;
    traceId: string;
    correlationId: string;
    priority: number;
    enqueuedAt: Date;
}
export interface JobQueuePort {
    enqueue(message: JobQueueMessage): Promise<void>;
    dequeue(): Promise<JobQueueMessage | undefined>;
    ack(jobId: string): Promise<void>;
    nack(jobId: string): Promise<void>;
    size(): Promise<number>;
}
//# sourceMappingURL=queue.port.d.ts.map