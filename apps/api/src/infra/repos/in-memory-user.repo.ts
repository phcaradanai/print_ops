import type { User, UserRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryUserRepository implements UserRepositoryPort {
  private store = new Map<string, User>();
  private authVersions = new Map<string, number>();
  private recoveryCodes = new Map<string, string>();

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
    this.authVersions.set(user.id, 0);
    return user;
  }

  async update(id: string, patch: Partial<User>): Promise<User> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`User ${id} not found`);
    const updated: User = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    if ('passwordHash' in patch || 'role' in patch || 'allowedPages' in patch || 'isActive' in patch) {
      this.authVersions.set(id, (this.authVersions.get(id) ?? 0) + 1);
    }
    return updated;
  }

  async getAuthVersion(id: string): Promise<number> {
    return this.authVersions.get(id) ?? 0;
  }

  async issuePasswordRecoveryCode(id: string, codeHash: string): Promise<boolean> {
    const user = this.store.get(id);
    if (!user?.isActive) return false;
    this.recoveryCodes.set(id, codeHash);
    return true;
  }

  async resetPasswordWithRecoveryCode(email: string, codeHash: string, passwordHash: string, nextCodeHash: string): Promise<boolean> {
    const user = Array.from(this.store.values()).find((candidate) =>
      candidate.isActive && candidate.email.toLowerCase() === email.toLowerCase(),
    );
    if (!user || this.recoveryCodes.get(user.id) !== codeHash) return false;
    this.store.set(user.id, { ...user, passwordHash, updatedAt: new Date() });
    this.recoveryCodes.set(user.id, nextCodeHash);
    this.authVersions.set(user.id, (this.authVersions.get(user.id) ?? 0) + 1);
    return true;
  }

  seed(user: User): void {
    this.store.set(user.id, user);
    if (!this.authVersions.has(user.id)) this.authVersions.set(user.id, 0);
  }
}
