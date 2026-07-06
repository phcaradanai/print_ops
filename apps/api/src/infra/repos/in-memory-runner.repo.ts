import type { Runner, RegisterRunnerInput, RunnerRepositoryPort, ListOptions } from '@printerops/domain';

export class InMemoryRunnerRepository implements RunnerRepositoryPort {
  private store = new Map<string, Runner>();

  async findById(id: string): Promise<Runner | undefined> {
    return this.store.get(id);
  }

  async findAll(opts?: ListOptions): Promise<Runner[]> {
    const all = Array.from(this.store.values());
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: RegisterRunnerInput & { id: string }): Promise<Runner> {
    const runner: Runner = {
      id: input.id,
      name: input.name,
      hostname: input.hostname,
      ipAddress: input.ipAddress,
      status: 'online',
      supportedProtocols: input.supportedProtocols,
      registeredAt: new Date(),
      metadata: input.metadata,
    };
    this.store.set(runner.id, runner);
    return runner;
  }

  async update(id: string, patch: Partial<Runner>): Promise<Runner> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Runner ${id} not found`);
    const updated: Runner = { ...existing, ...patch, id };
    this.store.set(id, updated);
    return updated;
  }
}
