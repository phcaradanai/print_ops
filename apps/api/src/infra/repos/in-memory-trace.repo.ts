import type { JobTrace, TraceRepositoryPort } from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryTraceRepository implements TraceRepositoryPort {
  private store = new Map<string, JobTrace>();
  private byJobId = new Map<string, string>();

  async findByJobId(jobId: string): Promise<JobTrace | undefined> {
    const id = this.byJobId.get(jobId);
    return id ? this.store.get(id) : undefined;
  }

  async create(input: Omit<JobTrace, 'id'>): Promise<JobTrace> {
    const trace: JobTrace = { ...input, id: generateId() };
    this.store.set(trace.id, trace);
    this.byJobId.set(trace.jobId, trace.id);
    return trace;
  }

  async update(id: string, patch: Partial<JobTrace>): Promise<JobTrace> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Trace ${id} not found`);
    const updated: JobTrace = { ...existing, ...patch, id };
    this.store.set(id, updated);
    this.byJobId.set(updated.jobId, id);
    return updated;
  }
}
