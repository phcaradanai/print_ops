import { describe, expect, it } from 'vitest';
import type { AuditRepositoryPort, CreateImportedDesignInput, ImportedDesign } from '@printerops/domain';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryImportedDesignRepository } from '../infra/repos/in-memory-imported-design.repo.js';
import { InMemoryPaperProfileRepository } from '../infra/repos/in-memory-paper-profile.repo.js';
import { ImportPaperProfileService, type ImportRequest } from '../services/import-paper-profile.service.js';

function pngBase64(): string {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(100, 0);
  ihdr.writeUInt32BE(50, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 'ascii');
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

function request(): ImportRequest {
  return {
    fileName: 'label.png',
    declaredMimeType: 'image/png',
    dataBase64: pngBase64(),
    profile: {
      code: 'ROLLBACK_TEST',
      name: 'Rollback test',
      widthMm: 100,
      heightMm: 50,
      marginTopMm: 0,
      marginRightMm: 0,
      marginBottomMm: 0,
      marginLeftMm: 0,
      dpi: 300,
      orientation: 'landscape',
      unit: 'mm',
    },
    fitMode: 'cover',
  };
}

class FailingImportedDesignRepository extends InMemoryImportedDesignRepository {
  override async create(_input: CreateImportedDesignInput): Promise<ImportedDesign> {
    throw new Error('storage unavailable');
  }
}

describe('ImportPaperProfileService consistency', () => {
  it('rolls back the profile when artwork persistence fails', async () => {
    const papers = new InMemoryPaperProfileRepository();
    const service = new ImportPaperProfileService(papers, new FailingImportedDesignRepository(), new InMemoryAuditRepository());

    await expect(service.import(request())).rejects.toMatchObject({ code: 'ARTWORK_PERSIST_FAILED' });
    await expect(papers.findAll()).resolves.toHaveLength(0);
  });

  it('keeps the consistent profile/artwork pair when best-effort audit fails', async () => {
    const papers = new InMemoryPaperProfileRepository();
    const designs = new InMemoryImportedDesignRepository();
    const failingAudit: AuditRepositoryPort = {
      create: async () => { throw new Error('audit unavailable'); },
      findAll: async () => [],
    };
    const service = new ImportPaperProfileService(papers, designs, failingAudit);

    const result = await service.import(request(), 'test-actor');
    expect(result.duplicate).toBe(false);
    await expect(papers.findById(result.profile.id)).resolves.toBeDefined();
    await expect(designs.findByPaperProfileId(result.profile.id)).resolves.toMatchObject({ fitMode: 'cover' });
  });

  it('rejects noncanonical base64 before creating a profile', async () => {
    const papers = new InMemoryPaperProfileRepository();
    const service = new ImportPaperProfileService(papers, new InMemoryImportedDesignRepository(), new InMemoryAuditRepository());

    await expect(service.import({ ...request(), dataBase64: 'YWJj=' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(papers.findAll()).resolves.toHaveLength(0);
  });
});
