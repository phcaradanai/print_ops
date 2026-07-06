import type { User, UserRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryUserRepository implements UserRepositoryPort {
  private store = new Map<string, User>();

  async findById(id: string): Promise<User | undefined> {
    return this.store.get(id);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.store.values()).find((u) => u.email === email);
  }

  async findAll(opts?: ListOptions): Promise<User[]> {
    const all = Array.from(this.store.values());
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const now = new Date();
    const user: User = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    this.store.set(user.id, user);
    return user;
  }

  async update(id: string, patch: Partial<User>): Promise<User> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`User ${id} not found`);
    const updated: User = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  seed(user: User): void {
    this.store.set(user.id, user);
  }
}
