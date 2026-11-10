import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReleaseStorageService } from './release-storage.service.js';

afterEach(() => {
  vi.unstubAllEnvs();
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
