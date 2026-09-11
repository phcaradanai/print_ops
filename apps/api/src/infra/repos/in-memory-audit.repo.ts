import type { AuditLog, CreateAuditLogInput, AuditRepositoryPort, ListOptions } from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryAuditRepository implements AuditRepositoryPort {
  private store: AuditLog[] = [];

  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const log: AuditLog = { ...input, id: generateId(), occurredAt: new Date() };
    this.store.push(log);
    return log;
  }

  async findAll(
    opts?: ListOptions & { resourceType?: string; resourceId?: string }
  ): Promise<AuditLog[]> {
    let results = [...this.store];
    if (opts?.resourceType) {
      results = results.filter((l) => l.resourceType === opts.resourceType);
    }
    if (opts?.resourceId) {
      results = results.filter((l) => l.resourceId === opts.resourceId);
    }
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }
}
