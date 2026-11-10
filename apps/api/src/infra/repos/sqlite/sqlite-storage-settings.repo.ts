import type { SqlValue } from 'sql.js';
import { getDb } from '../../db/sqlite.js';
import type {
  StorageConfig,
  StorageSettingsRepositoryPort,
  StorageProviderType,
} from '../../../services/release-storage.service.js';

export class SqliteStorageSettingsRepository implements StorageSettingsRepositoryPort {
  async getSettings(): Promise<StorageConfig | undefined> {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM control_storage_settings WHERE id = ?');
    stmt.bind(['default']);
    try {
      if (!stmt.step()) return undefined;
      const row = stmt.getAsObject() as Record<string, unknown>;
      return {
        provider: (row['provider'] as StorageProviderType) || 'local',
        localPath: (row['local_path'] as string) || '/data/releases',
        minio: {
          endPoint: (row['minio_endpoint'] as string) || 'localhost',
          port: Number(row['minio_port'] ?? 9000),
          useSSL: Boolean(row['minio_use_ssl']),
          accessKey: (row['minio_access_key'] as string) || '',
          secretKey: (row['minio_secret_key'] as string) || '',
          bucket: (row['minio_bucket'] as string) || 'printops-releases',
          prefix: (row['minio_prefix'] as string) || '',
          publicUrl: (row['minio_public_url'] as string) || '',
        },
      };
    } finally {
      stmt.free();
    }
  }

  async saveSettings(config: StorageConfig): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO control_storage_settings (
        id, provider, local_path, minio_endpoint, minio_port, minio_use_ssl,
        minio_access_key, minio_secret_key, minio_bucket, minio_prefix, minio_public_url, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        local_path = excluded.local_path,
        minio_endpoint = excluded.minio_endpoint,
        minio_port = excluded.minio_port,
        minio_use_ssl = excluded.minio_use_ssl,
        minio_access_key = excluded.minio_access_key,
        minio_secret_key = excluded.minio_secret_key,
        minio_bucket = excluded.minio_bucket,
        minio_prefix = excluded.minio_prefix,
        minio_public_url = excluded.minio_public_url,
        updated_at = excluded.updated_at`,
      [
        'default',
        config.provider,
        config.localPath,
        config.minio.endPoint,
        config.minio.port,
        config.minio.useSSL ? 1 : 0,
        config.minio.accessKey,
        config.minio.secretKey,
        config.minio.bucket,
        config.minio.prefix,
        config.minio.publicUrl || '',
        now,
      ] as SqlValue[],
    );
  }
}
