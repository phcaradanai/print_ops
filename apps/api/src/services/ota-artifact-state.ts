import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ArtifactComponent, ArtifactPlatform } from '@printerops/domain';
import type { OtaSource } from './ota-update.service.js';

/**
 * Durable descriptor for the last verified artifact. The binary itself lives
 * in the content-addressed-by-version cache; this small record lets an API
 * restart recover the exact component, platform, digest, and signature
 * instead of trusting only an in-memory object or a filename.
 */
export interface PersistedStagedArtifact {
  version: string;
  component: ArtifactComponent;
  platform: ArtifactPlatform;
  artifactPath: string;
  bytes: number;
  sha256: string;
  signature: string;
  format?: string;
  previousVersion?: string;
  source: OtaSource;
  updatedAt: string;
}

export interface OtaArtifactStateStorePort {
  load(): Promise<PersistedStagedArtifact | null>;
  save(value: PersistedStagedArtifact): Promise<void>;
  clear(): Promise<void>;
}

export class FileOtaArtifactStateStore implements OtaArtifactStateStorePort {
  constructor(private readonly path: string) {}

  async load(): Promise<PersistedStagedArtifact | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!isPersistedStagedArtifact(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async save(value: PersistedStagedArtifact): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await rm(temporary, { force: true });
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, this.path);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

function isPersistedStagedArtifact(value: unknown): value is PersistedStagedArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record['version'] === 'string'
    && typeof record['component'] === 'string'
    && typeof record['platform'] === 'string'
    && typeof record['artifactPath'] === 'string'
    && typeof record['bytes'] === 'number'
    && Number.isSafeInteger(record['bytes'])
    && record['bytes'] > 0
    && typeof record['sha256'] === 'string'
    && /^[0-9a-f]{64}$/i.test(record['sha256'] as string)
    && typeof record['signature'] === 'string'
    && (record['source'] === 'lan' || record['source'] === 'wan' || record['source'] === 'cache')
    && typeof record['updatedAt'] === 'string';
}
