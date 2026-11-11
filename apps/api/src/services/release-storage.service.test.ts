import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReleaseStorageService } from './release-storage.service.js';
import * as Minio from 'minio';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReleaseStorageService OTA metadata', () => {
  it('gets an uploaded MinIO installer size from its object metadata', async () => {
    vi.spyOn(Minio.Client.prototype, 'statObject').mockImplementation(async (bucket, object) => {
      if (bucket !== 'releases' || object !== 'apps/PrintOps.exe') throw new Error('Object not found');
      return { size: 12345, etag: 'etag', metaData: {}, lastModified: new Date() };
    });
    const service = new ReleaseStorageService(undefined, { provider: 'minio' });
    await expect(service.getArtifactMetadata('minio://releases/apps/PrintOps.exe')).resolves.toEqual({ size: 12345 });
  });

  it('derives an external installer checksum from file bytes rather than its URL', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url !== 'https://releases.local/PrintOps.exe') throw new Error('Unexpected artifact URL');
      return new Response('abc');
    });
    const service = new ReleaseStorageService(undefined, { provider: 'local' });
    await expect(service.getArtifactMetadata('https://releases.local/PrintOps.exe')).resolves.toEqual({
      size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  });
});

describe('ReleaseStorageService provider defaults', () => {
  it('honors an explicit local provider even when a MinIO endpoint is configured', () => {
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('MINIO_ENDPOINT', 'minio');
    vi.stubEnv('MINIO_ACCESS_KEY', '');
    vi.stubEnv('MINIO_SECRET_KEY', '');

    const config = new ReleaseStorageService().getConfig();
    expect(config.provider).toBe('local');
    expect(config.minio.accessKey).toBe('');
    expect(config.minio.secretKey).toBe('');
  });

  it('selects MinIO when explicitly configured', () => {
    vi.stubEnv('STORAGE_PROVIDER', 'minio');
    vi.stubEnv('MINIO_ENDPOINT', 'minio');

    expect(new ReleaseStorageService().getConfig().provider).toBe('minio');
  });

  it('retains endpoint-based MinIO selection when no provider is configured', () => {
    vi.stubEnv('STORAGE_PROVIDER', '');
    vi.stubEnv('MINIO_ENDPOINT', 'external-minio');

    expect(new ReleaseStorageService().getConfig().provider).toBe('minio');
  });

  it('rejects unsupported provider values', () => {
    vi.stubEnv('STORAGE_PROVIDER', 's3');

    expect(() => new ReleaseStorageService()).toThrow("Invalid STORAGE_PROVIDER 's3'; expected 'local' or 'minio'");
  });
});
