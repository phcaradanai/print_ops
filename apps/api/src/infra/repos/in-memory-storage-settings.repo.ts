import type {
  StorageConfig,
  StorageSettingsRepositoryPort,
} from '../../services/release-storage.service.js';

export class InMemoryStorageSettingsRepository implements StorageSettingsRepositoryPort {
  private settings?: StorageConfig;

  async getSettings(): Promise<StorageConfig | undefined> {
    return this.settings ? { ...this.settings, minio: { ...this.settings.minio } } : undefined;
  }

  async saveSettings(config: StorageConfig): Promise<void> {
    this.settings = { ...config, minio: { ...config.minio } };
  }
}
