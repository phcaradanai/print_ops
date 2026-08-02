import type {
  ImportedDesign,
  CreateImportedDesignInput,
  ImportedDesignRepositoryPort,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

export class InMemoryImportedDesignRepository
  implements ImportedDesignRepositoryPort
{
  private store = new Map<string, ImportedDesign>();

  async findById(id: string): Promise<ImportedDesign | undefined> {
    return this.store.get(id);
  }

  async findBySha256(sha256: string): Promise<ImportedDesign | undefined> {
    return Array.from(this.store.values()).find((d) => d.sha256 === sha256);
  }

  async findByPaperProfileId(
    paperProfileId: string,
  ): Promise<ImportedDesign | undefined> {
    return Array.from(this.store.values()).find(
      (d) => d.paperProfileId === paperProfileId,
    );
  }

  async create(input: CreateImportedDesignInput): Promise<ImportedDesign> {
    const now = new Date();
    const design: ImportedDesign = {
      ...input,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(design.id, design);
    return design;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
