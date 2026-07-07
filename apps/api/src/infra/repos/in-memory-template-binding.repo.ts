import type {
  CreatePrinterTemplateBindingInput,
  ListOptions,
  PrinterTemplateBinding,
  PrinterTemplateBindingRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryPrinterTemplateBindingRepository implements PrinterTemplateBindingRepositoryPort {
  private store = new Map<string, PrinterTemplateBinding>();

  async findById(id: string): Promise<PrinterTemplateBinding | undefined> {
    return this.store.get(id);
  }

  async findAll(opts?: ListOptions & { printerCode?: string; templateCode?: string }): Promise<PrinterTemplateBinding[]> {
    let all = Array.from(this.store.values());
    if (opts?.printerCode) all = all.filter((b) => b.printerCode === opts.printerCode);
    if (opts?.templateCode) all = all.filter((b) => b.templateCode === opts.templateCode);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: CreatePrinterTemplateBindingInput): Promise<PrinterTemplateBinding> {
    const now = new Date();
    const binding: PrinterTemplateBinding = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    this.store.set(binding.id, binding);
    return binding;
  }

  async update(id: string, patch: Partial<PrinterTemplateBinding>): Promise<PrinterTemplateBinding> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`PrinterTemplateBinding ${id} not found`);
    const updated: PrinterTemplateBinding = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}
