import type {
  ContentHistoryRecord,
  ContentHistoryRepositoryPort,
  ContentType,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryContentHistoryRepository implements ContentHistoryRepositoryPort {
  private store: ContentHistoryRecord[] = [];

  async create(input: Omit<ContentHistoryRecord, 'id'>): Promise<ContentHistoryRecord> {
    const record: ContentHistoryRecord = { ...input, id: generateId() };
    this.store.push(record);
    return record;
  }

  async findByType(contentType: ContentType, limit = 50): Promise<ContentHistoryRecord[]> {
    return this.store
      .filter((r) => r.contentType === contentType)
      .sort((a, b) => b.version - a.version)
      .slice(0, limit);
  }

  async findByTypeAndVersion(
    contentType: ContentType,
    version: number,
  ): Promise<ContentHistoryRecord | undefined> {
    return this.store.find((r) => r.contentType === contentType && r.version === version);
  }
}
