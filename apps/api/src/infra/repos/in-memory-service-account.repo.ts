import type { ServiceAccount, CreateServiceAccountInput, ServiceAccountRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryServiceAccountRepository implements ServiceAccountRepositoryPort {
  private store = new Map<string, ServiceAccount>();

  async findById(id: string): Promise<ServiceAccount | undefined> {
    return this.store.get(id);
  }

  async findBySourceSystem(sourceSystem: string): Promise<ServiceAccount | undefined> {
    return Array.from(this.store.values()).find((s) => s.sourceSystem === sourceSystem && s.isActive);
  }

  async findAll(opts?: ListOptions): Promise<ServiceAccount[]> {
    const all = Array.from(this.store.values());
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: CreateServiceAccountInput): Promise<ServiceAccount> {
    const now = new Date();
    const account: ServiceAccount = {
      ...input,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(account.id, account);
    return account;
  }

  async update(id: string, patch: Partial<ServiceAccount>): Promise<ServiceAccount> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`ServiceAccount ${id} not found`);
    const updated: ServiceAccount = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  seed(account: ServiceAccount): void {
    this.store.set(account.id, account);
  }
}
