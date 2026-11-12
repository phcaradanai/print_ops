import type {
  CreateLocationPrinterBindingInput,
  LocationPrinterBinding,
  LocationPrinterBindingRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryLocationPrinterBindingRepository implements LocationPrinterBindingRepositoryPort {
  private store = new Map<string, LocationPrinterBinding>();

  async findById(id: string): Promise<LocationPrinterBinding | undefined> {
    return this.store.get(id);
  }

  async findAll(opts?: { locationCode?: string }): Promise<LocationPrinterBinding[]> {
    return [...this.store.values()]
      .filter((b) => !opts?.locationCode || b.locationCode === opts.locationCode)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  async create(input: CreateLocationPrinterBindingInput): Promise<LocationPrinterBinding> {
    if ([...this.store.values()].some((b) => b.locationCode === input.locationCode && b.printerIp === input.printerIp)) {
      throw new Error('UNIQUE constraint failed: location_printer_bindings.location_code, printer_ip');
    }
    const now = new Date();
    const binding: LocationPrinterBinding = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    this.store.set(binding.id, binding);
    return binding;
  }

  async update(id: string, patch: Partial<CreateLocationPrinterBindingInput>): Promise<LocationPrinterBinding> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`LocationPrinterBinding ${id} not found`);
    const updated: LocationPrinterBinding = { ...existing, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
