import type { Printer, CreatePrinterInput, PrinterRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryPrinterRepository implements PrinterRepositoryPort {
  private store = new Map<string, Printer>();

  async findById(id: string): Promise<Printer | undefined> {
    return this.store.get(id);
  }

  async findByCode(code: string): Promise<Printer | undefined> {
    return Array.from(this.store.values()).find((p) => p.code === code && p.isActive);
  }

  async findAll(opts?: ListOptions): Promise<Printer[]> {
    const all = Array.from(this.store.values());
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async create(input: CreatePrinterInput): Promise<Printer> {
    const now = new Date();
    const code = (input.code ?? input.name.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')) || `PRINTER_${generateId().slice(0, 8)}`;
    const printer: Printer = {
      ...input,
      id: generateId(),
      code,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(printer.id, printer);
    return printer;
  }

  async update(id: string, patch: Partial<Printer>): Promise<Printer> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Printer ${id} not found`);
    const updated: Printer = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
