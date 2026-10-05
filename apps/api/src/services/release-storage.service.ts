import * as Minio from 'minio';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';

export type StorageProviderType = 'local' | 'minio';

export interface MinioStorageConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  prefix: string;
  publicUrl?: string;
}

export interface StorageConfig {
  provider: StorageProviderType;
  localPath: string;
  minio: MinioStorageConfig;
}

export interface StorageSettingsRepositoryPort {
  getSettings(): Promise<StorageConfig | undefined>;
  saveSettings(config: StorageConfig): Promise<void>;
}

export class ReleaseStorageService {
  private config: StorageConfig;
  private minioClient?: Minio.Client;

  constructor(
    private readonly repo?: StorageSettingsRepositoryPort,
    initialConfig?: Partial<StorageConfig>,
  ) {
    const defaultLocalPath = process.env['PRINTOPS_RELEASES_DIR']
      || resolve(process.cwd(), 'data/releases');

    const defaultMinio: MinioStorageConfig = {
      endPoint: process.env['MINIO_ENDPOINT'] || 'localhost',
      port: Number(process.env['MINIO_PORT'] || 9000),
      useSSL: process.env['MINIO_USE_SSL'] === 'true',
      accessKey: process.env['MINIO_ACCESS_KEY'] || '',
      secretKey: process.env['MINIO_SECRET_KEY'] || '',
      bucket: process.env['MINIO_BUCKET'] || 'printops-releases',
      prefix: process.env['MINIO_PREFIX'] || '',
      publicUrl: process.env['MINIO_PUBLIC_URL'] || '',
    };

    const configuredProvider = process.env['STORAGE_PROVIDER'];
    if (configuredProvider && configuredProvider !== 'local' && configuredProvider !== 'minio') {
      throw new Error(`Invalid STORAGE_PROVIDER '${configuredProvider}'; expected 'local' or 'minio'`);
    }
    const defaultProvider: StorageProviderType = configuredProvider === 'minio'
      ? 'minio'
      : configuredProvider === 'local'
        ? 'local'
        : process.env['MINIO_ENDPOINT'] ? 'minio' : 'local';

    this.config = {
      provider: initialConfig?.provider || defaultProvider,
      localPath: initialConfig?.localPath || defaultLocalPath,
      minio: {
        ...defaultMinio,
        ...(initialConfig?.minio || {}),
      },
    };

    this.initMinioClient();
  }

  async initialize(): Promise<void> {
    if (this.repo) {
      const persisted = await this.repo.getSettings();
      if (persisted) {
        this.config = persisted;
        this.initMinioClient();
      } else {
        await this.repo.saveSettings(this.config);
      }
    }
  }

  private initMinioClient(): void {
    if (this.config.provider === 'minio' || this.config.minio.endPoint) {
      try {
        this.minioClient = new Minio.Client({
          endPoint: this.config.minio.endPoint,
          port: this.config.minio.port,
          useSSL: this.config.minio.useSSL,
          accessKey: this.config.minio.accessKey,
          secretKey: this.config.minio.secretKey,
        });
      } catch (err) {
        this.minioClient = undefined;
      }
    }
  }

  getConfig(): StorageConfig {
    return {
      provider: this.config.provider,
      localPath: this.config.localPath,
      minio: {
        ...this.config.minio,
        // Mask secret key when exposing config
        secretKey: this.config.minio.secretKey ? '********' : '',
      },
    };
  }

  async updateConfig(patch: {
    provider?: StorageProviderType;
    localPath?: string;
    minio?: Partial<MinioStorageConfig>;
  }): Promise<StorageConfig> {
    const nextProvider = patch.provider || this.config.provider;
    const nextLocalPath = patch.localPath ? patch.localPath.trim() : this.config.localPath;

    let nextSecretKey = this.config.minio.secretKey;
    if (patch.minio?.secretKey && patch.minio.secretKey !== '********') {
      nextSecretKey = patch.minio.secretKey;
    }

    const nextMinio: MinioStorageConfig = {
      ...this.config.minio,
      ...(patch.minio || {}),
      secretKey: nextSecretKey,
    };

    this.config = {
      provider: nextProvider,
      localPath: nextLocalPath,
      minio: nextMinio,
    };

    this.initMinioClient();

    if (this.repo) {
      await this.repo.saveSettings(this.config);
    }

    return this.getConfig();
  }

  async testConnection(testCfg?: {
    provider?: StorageProviderType;
    localPath?: string;
    minio?: Partial<MinioStorageConfig>;
  }): Promise<{ ok: boolean; message: string }> {
    const provider = testCfg?.provider || this.config.provider;

    if (provider === 'local') {
      const targetPath = resolve(testCfg?.localPath || this.config.localPath);
      try {
        mkdirSync(targetPath, { recursive: true });
        const testFile = join(targetPath, `.write-test-${Date.now()}.tmp`);
        writeFileSync(testFile, 'test');
        statSync(testFile);
        unlinkSync(testFile);
        return { ok: true, message: `Local directory '${targetPath}' is writable.` };
      } catch (err) {
        return { ok: false, message: `Failed to access local path: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // MinIO connection test
    const minioParams = {
      ...this.config.minio,
      ...(testCfg?.minio || {}),
      secretKey: (testCfg?.minio?.secretKey && testCfg.minio.secretKey !== '********')
        ? testCfg.minio.secretKey
        : this.config.minio.secretKey,
    };

    try {
      const client = new Minio.Client({
        endPoint: minioParams.endPoint,
        port: minioParams.port,
        useSSL: minioParams.useSSL,
        accessKey: minioParams.accessKey,
        secretKey: minioParams.secretKey,
      });

      const bucket = minioParams.bucket;
      const exists = await client.bucketExists(bucket);
      if (!exists) {
        await client.makeBucket(bucket);
        return { ok: true, message: `Connected to MinIO at ${minioParams.endPoint}:${minioParams.port}. Created bucket '${bucket}'.` };
      }
      return { ok: true, message: `Connected to MinIO at ${minioParams.endPoint}:${minioParams.port}. Bucket '${bucket}' verified.` };
    } catch (err) {
      return { ok: false, message: `MinIO connection error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async saveArtifact(
    filename: string,
    content: Buffer,
  ): Promise<{ artifactRef: string; sha256: string; storageType: 'local' | 'minio' }> {
    const sha256 = createHash('sha256').update(content).digest('hex');

    if (this.config.provider === 'minio') {
      if (!this.minioClient) {
        this.initMinioClient();
      }
      if (!this.minioClient) {
        throw new Error('MinIO client is not initialized');
      }

      const bucket = this.config.minio.bucket;
      const prefix = this.config.minio.prefix.replace(/^\/+|\/+$/g, '');
      const objectName = prefix ? `${prefix}/${filename}` : filename;

      const exists = await this.minioClient.bucketExists(bucket);
      if (!exists) {
        await this.minioClient.makeBucket(bucket);
      }

      await this.minioClient.putObject(bucket, objectName, content, content.length, {
        'Content-Type': 'application/octet-stream',
        'X-Amz-Meta-Sha256': sha256,
      });

      const artifactRef = `minio://${bucket}/${objectName}`;
      return { artifactRef, sha256, storageType: 'minio' };
    }

    // Local file storage
    const targetDir = resolve(this.config.localPath);
    mkdirSync(targetDir, { recursive: true });
    const destPath = join(targetDir, filename);
    writeFileSync(destPath, content);

    return { artifactRef: destPath, sha256, storageType: 'local' };
  }

  async getArtifactStream(
    artifactRef: string,
  ): Promise<{ stream?: NodeJS.ReadableStream; redirectUrl?: string; size?: number }> {
    // 1. MinIO artifact
    if (artifactRef.startsWith('minio://') || artifactRef.startsWith('s3://')) {
      const raw = artifactRef.replace(/^(minio|s3):\/\//, '');
      const slashIndex = raw.indexOf('/');
      if (slashIndex === -1) {
        throw new Error(`Invalid MinIO artifact reference: ${artifactRef}`);
      }
      const bucket = raw.slice(0, slashIndex);
      const objectName = raw.slice(slashIndex + 1);

      if (!this.minioClient) {
        this.initMinioClient();
      }
      if (!this.minioClient) {
        throw new Error('MinIO client is not configured');
      }

      const stat = await this.minioClient.statObject(bucket, objectName);
      const stream = await this.minioClient.getObject(bucket, objectName);
      return { stream, size: stat.size };
    }

    // 2. HTTP/HTTPS URL
    if (artifactRef.startsWith('http://') || artifactRef.startsWith('https://')) {
      return { redirectUrl: artifactRef };
    }

    // 3. Local disk path
    const candidatePaths = [
      artifactRef,
      resolve(process.cwd(), artifactRef),
      join(resolve(this.config.localPath), artifactRef),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        const stat = statSync(p);
        return { stream: createReadStream(p), size: stat.size };
      }
    }

    throw new Error(`Artifact file not found: ${artifactRef}`);
  }
}
