import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { AppError } from '@printerops/shared';
import type { OtaInstallInput, OtaInstallerPort } from './ota-update.service.js';

export interface ExternalUpdaterConfig {
  executablePath: string;
  requestDirectory: string;
  statePath: string;
  installRoot: string;
  desktopPath: string;
  desktopPid: number;
  apiUrl: string;
  healthToken: string;
  publicKey?: string;
  requireSignature: boolean;
  healthCheckTimeoutMs: number;
  shutdownTimeoutMs: number;
  handoffDelayMs: number;
  databasePath?: string;
  currentSchemaVersion: number;
}

export interface ExternalInstallLaunch {
  kind: 'external';
  operationId: string;
}

export function externalUpdaterConfigured(config: ExternalUpdaterConfig | undefined): boolean {
  return Boolean(
    config
    && config.executablePath
    && existsSync(config.executablePath)
    && config.requestDirectory
    && config.statePath
    && config.installRoot
    && config.desktopPath
    && config.desktopPid > 0
    && config.apiUrl
    && config.healthToken,
  );
}

/**
 * Adapter boundary between the API's print-safe orchestration and the native
 * updater. It only writes a signed, already-verified handoff request and
 * launches the external process. Networking, manifest policy, and binary
 * replacement remain outside the API process.
 */
export class ExternalUpdaterInstaller implements OtaInstallerPort {
  constructor(private readonly config: ExternalUpdaterConfig) {}

  async install(input: OtaInstallInput): Promise<ExternalInstallLaunch> {
    if (!externalUpdaterConfigured(this.config)) {
      throw new AppError('OTA_INSTALL_UNAVAILABLE', 'External updater is not fully configured', 501);
    }
    if (!input.previousVersion?.trim()) {
      throw new AppError('OTA_INSTALL_INVALID', 'Previous application version is required for rollback health verification', 422);
    }

    const operationId = randomUUID();
    const requestPath = join(this.config.requestDirectory, `${operationId}.json`);
    const request = {
      mode: 'apply',
      operation_id: operationId,
      artifact_path: input.artifactPath,
      artifact_sha256: input.sha256,
      artifact_signature: input.signature,
      artifact_format: input.format ?? 'nsis-installer',
      previous_version: input.previousVersion ?? '',
      require_signature: this.config.requireSignature,
      public_key: this.config.publicKey ?? '',
      version: input.version,
      install_root: this.config.installRoot,
      desktop_path: this.config.desktopPath,
      desktop_pid: this.config.desktopPid,
      api_url: this.config.apiUrl,
      health_token: this.config.healthToken,
      database_path: input.databasePath ?? this.config.databasePath ?? '',
      database_schema_version: input.databaseSchemaVersion ?? this.config.currentSchemaVersion,
      target_schema_version: input.targetSchemaVersion ?? this.config.currentSchemaVersion,
      state_path: this.config.statePath,
      health_check_timeout_ms: this.config.healthCheckTimeoutMs,
      shutdown_timeout_ms: this.config.shutdownTimeoutMs,
      handoff_delay_ms: this.config.handoffDelayMs,
    };

    await mkdir(dirname(requestPath), { recursive: true });
    await mkdir(dirname(this.config.statePath), { recursive: true });
    const timestamp = new Date().toISOString();
    await this.writeAtomicJson(this.config.statePath, {
      operation_id: operationId,
      version: input.version,
      phase: 'RECEIVED',
      started_at: timestamp,
      updated_at: timestamp,
      request,
    });
    const temporary = `${requestPath}.${process.pid}.tmp`;
    await rm(temporary, { force: true });
    try {
      await writeFile(temporary, `${JSON.stringify(request, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, requestPath);

      await this.launch(['apply', '--request', requestPath]);
    } catch (error) {
      await rm(temporary, { force: true });
      await rm(requestPath, { force: true });
      await rm(this.config.statePath, { force: true });
      throw error;
    }
    return { kind: 'external', operationId };
  }

  async rollback(): Promise<ExternalInstallLaunch> {
    if (!externalUpdaterConfigured(this.config)) {
      throw new AppError('OTA_ROLLBACK_UNAVAILABLE', 'External updater is not fully configured', 501);
    }
    const operationId = `rollback-${randomUUID()}`;
    await this.launch([
      'rollback',
      '--state',
      this.config.statePath,
      '--desktop-pid',
      String(this.config.desktopPid),
    ]);
    return { kind: 'external', operationId };
  }

  private async launch(args: string[]): Promise<void> {
    const child = spawn(this.config.executablePath, args, {
      cwd: this.config.installRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onError);
        child.unref();
        resolve();
      };
      const onError = (error: Error) => {
        child.off('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  async healthCheck(): Promise<boolean> {
    // External mode deliberately does not ask the old API to declare itself
    // healthy. The bootstrapper probes the newly started process and requires
    // both /health and /api/v1/system/readiness after replacement.
    return false;
  }

  private async writeAtomicJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${process.pid}.tmp`;
    await rm(temporary, { force: true });
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
  }

}
