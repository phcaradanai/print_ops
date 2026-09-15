import type {
  DiscoveredPrinter,
  CreateDiscoveredPrinterInput,
  DiscoveredPrinterRepositoryPort,
  ListOptions,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryDiscoveredPrinterRepository implements DiscoveredPrinterRepositoryPort {
  private store = new Map<string, DiscoveredPrinter>();

  async findById(id: string): Promise<DiscoveredPrinter | undefined> {
    return this.store.get(id);
  }

  async findAll(opts?: ListOptions & { runnerId?: string }): Promise<DiscoveredPrinter[]> {
    let all = Array.from(this.store.values());
    if (opts?.runnerId) all = all.filter((p) => p.runnerId === opts.runnerId);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  /** Upsert keyed on (runnerId, localPrinterName) — updates lastSeenAt on subsequent syncs. */
  async upsert(input: CreateDiscoveredPrinterInput): Promise<DiscoveredPrinter> {
    const existing = Array.from(this.store.values()).find(
      (p) => p.runnerId === input.runnerId && p.localPrinterName === input.localPrinterName
    );
    const now = new Date();
    if (existing) {
      const updated: DiscoveredPrinter = {
        ...existing,
        driverName: input.driverName ?? existing.driverName,
        portName: input.portName ?? existing.portName,
        connectionType: input.connectionType,
        isDefault: input.isDefault,
        isShared: input.isShared,
        attributes: input.attributes ?? existing.attributes,
        computerName: input.computerName ?? existing.computerName,
        osName: input.osName ?? existing.osName,
        lastSeenAt: now,
      };
      this.store.set(existing.id, updated);
      return updated;
    }
    const created: DiscoveredPrinter = {
      id: generateId(),
      runnerId: input.runnerId,
      localPrinterName: input.localPrinterName,
      driverName: input.driverName,
      portName: input.portName,
      connectionType: input.connectionType,
      isDefault: input.isDefault,
      isShared: input.isShared,
      attributes: input.attributes ?? {},
      computerName: input.computerName,
      osName: input.osName,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    this.store.set(created.id, created);
    return created;
  }

  async update(id: string, patch: Partial<DiscoveredPrinter>): Promise<DiscoveredPrinter> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`DiscoveredPrinter ${id} not found`);
    const updated: DiscoveredPrinter = { ...existing, ...patch, id };
    this.store.set(id, updated);
    return updated;
  }
}
