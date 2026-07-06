import type { Job, CreateJobInput, JobRepositoryPort, ListOptions, JobStatus } from '@printerops/domain';
import { generateId, generateTraceId, generateCorrelationId } from '@printerops/shared';

export class InMemoryJobRepository implements JobRepositoryPort {
  private store = new Map<string, Job>();

  async findById(id: string): Promise<Job | undefined> {
    return this.store.get(id);
  }

  async findAll(opts?: ListOptions & { status?: JobStatus }): Promise<Job[]> {
    let all = Array.from(this.store.values());
    if (opts?.status) {
      all = all.filter((j) => j.status === opts.status);
    }
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(
    input: CreateJobInput & { id: string; traceId: string; correlationId: string }
  ): Promise<Job> {
    const now = new Date();
    const job: Job = {
      id: input.id,
      printerId: input.printerId,
      createdBy: input.createdBy,
      status: 'PENDING',
      priority: input.priority ?? 0,
      traceId: input.traceId,
      correlationId: input.correlationId,
      documentUrl: input.documentUrl,
      documentBase64: input.documentBase64,
      mimeType: input.mimeType,
      copies: input.copies,
      duplex: input.duplex,
      colorMode: input.colorMode,
      mediaType: input.mediaType,
      resolution: input.resolution,
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(job.id, job);
    return job;
  }

  async update(id: string, patch: Partial<Job>): Promise<Job> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Job ${id} not found`);
    const updated: Job = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}
