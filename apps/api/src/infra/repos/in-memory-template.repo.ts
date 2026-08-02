import type {
  PrintTemplate,
  CreatePrintTemplateInput,
  PrintTemplateRepositoryPort,
  ListOptions,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryPrintTemplateRepository implements PrintTemplateRepositoryPort {
  private store = new Map<string, PrintTemplate>();

  async findById(id: string): Promise<PrintTemplate | undefined> {
    return this.store.get(id);
  }

  async findByCode(templateCode: string): Promise<PrintTemplate | undefined> {
    return Array.from(this.store.values()).find((t) => t.templateCode === templateCode);
  }

  async findAll(opts?: ListOptions & { status?: string }): Promise<PrintTemplate[]> {
    let all = Array.from(this.store.values());
    if (opts?.status) all = all.filter((t) => t.status === opts.status);
    all.sort((a, b) => a.templateCode.localeCompare(b.templateCode));
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: CreatePrintTemplateInput): Promise<PrintTemplate> {
    const now = new Date();
    const template: PrintTemplate = {
      ...input,
      id: generateId(),
      version: input.version ?? 1,
      status: input.status ?? 'DRAFT',
      updatedBy: input.updatedBy ?? input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(template.id, template);
    return template;
  }

  async update(id: string, patch: Partial<PrintTemplate>): Promise<PrintTemplate> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`PrintTemplate ${id} not found`);
    const updated: PrintTemplate = {
      ...existing,
      ...patch,
      id,
      version: patch.content && patch.content !== existing.content ? existing.version + 1 : patch.version ?? existing.version,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
