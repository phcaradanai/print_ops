import type { Job, CreateJobInput, JobRepositoryPort, ListOptions, JobStatus, JobPriority } from '@printerops/domain';

const PRIORITY_MAP: Record<JobPriority, number> = {
  urgent: 100, high: 75, normal: 50, low: 25,
};

export class InMemoryJobRepository implements JobRepositoryPort {
  private store = new Map<string, Job>();

  async findById(id: string): Promise<Job | undefined> {
    return this.store.get(id);
  }

  async findByRequestId(requestId: string, sourceSystem: string): Promise<Job | undefined> {
    return Array.from(this.store.values()).find(
      (j) => j.requestId === requestId && j.sourceSystem === sourceSystem
    );
  }

  async findAll(opts?: ListOptions & { status?: JobStatus; printerId?: string }): Promise<Job[]> {
    let all = Array.from(this.store.values());
    if (opts?.status) all = all.filter((j) => j.status === opts.status);
    if (opts?.printerId) all = all.filter((j) => j.printerId === opts.printerId);
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
      printerCode: input.printerCode,
      templateCode: input.templateCode,
      resolvedTemplateCode: input.resolvedTemplateCode,
      paperProfileId: input.paperProfileId,
      routePolicyId: input.routePolicyId,
      renderedPrintPayload: input.renderedPrintPayload,
      createdBy: input.createdBy,
      sourceSystem: input.sourceSystem,
      sourceReference: input.sourceReference,
      requestId: input.requestId,
      status: 'ACCEPTED',
      priority: input.priority ?? PRIORITY_MAP[input.priorityLabel ?? 'normal'],
      priorityLabel: input.priorityLabel ?? 'normal',
      traceId: input.traceId,
      correlationId: input.correlationId,
      documentUrl: input.documentUrl,
      documentBase64: input.documentBase64,
      payloadSnapshot: input.payloadSnapshot,
      mimeType: input.mimeType,
      copies: input.copies,
      duplex: input.duplex,
      colorMode: input.colorMode,
      mediaType: input.mediaType,
      resolution: input.resolution,
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      receivedAt: now,
      templateTiming: input.templateTiming,
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

  async claim(id: string, fromStatuses: JobStatus[], patch: Partial<Job>): Promise<Job | undefined> {
    // Read and write with no await in between: on Node's single thread nothing
    // else can observe the old status once this starts, which is what makes the
    // claim atomic without a lock.
    const existing = this.store.get(id);
    if (!existing || !fromStatuses.includes(existing.status)) return undefined;
    const updated: Job = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}
