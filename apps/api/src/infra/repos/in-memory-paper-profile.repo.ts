import type {
  CreatePaperProfileInput,
  ListOptions,
  PaperProfile,
  PaperProfileRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryPaperProfileRepository implements PaperProfileRepositoryPort {
  private store = new Map<string, PaperProfile>();

  async findById(id: string): Promise<PaperProfile | undefined> {
    return this.store.get(id);
  }

  async findByCode(code: string): Promise<PaperProfile | undefined> {
    return Array.from(this.store.values()).find((p) => p.code === code);
  }

  async findAll(opts?: ListOptions): Promise<PaperProfile[]> {
    const all = Array.from(this.store.values()).sort((a, b) => a.code.localeCompare(b.code));
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: CreatePaperProfileInput): Promise<PaperProfile> {
    // Check for duplicate code
    const existing = await this.findByCode(input.code);
    if (existing) {
      throw new Error(`PaperProfile with code "${input.code}" already exists`);
    }
    const now = new Date();
    const profile: PaperProfile = {
      ...input,
      fields: input.fields ?? [],
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(profile.id, profile);
    return profile;
  }

  async update(id: string, patch: Partial<PaperProfile>): Promise<PaperProfile> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`PaperProfile ${id} not found`);
    const updated: PaperProfile = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
