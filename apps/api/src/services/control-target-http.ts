import { readFileSync } from 'node:fs';
import type { ControlContentBundle, ControlContentIndex, ControlContentKind } from '@printerops/domain';
import type { ControlContentSyncResult } from './control-content-sync.service.js';
import type {
  DownloadUpdateRequest,
  OtaExternalOutcome,
  OtaInstallRequest,
  OtaUpdateServicePort,
} from './ota-update.service.js';

/** The independent device agent only talks to the local PrintOps API. */
export class ControlTargetHttp implements OtaUpdateServicePort {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly tokenPath: string) {
    const parsed = new URL(baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
      throw new Error('Control target API must be on loopback');
    }
    this.baseUrl = parsed.origin;
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = readFileSync(this.tokenPath, 'utf8').trim();
    if (!token) throw new Error('PrintOps local OTA token is empty');
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        'x-printops-ota-token': token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`PrintOps OTA API ${method} ${path} returned ${response.status}: ${detail}`);
    }
    return response.json() as Promise<T>;
  }

  async getStatus() {
    const status = await this.request<Awaited<ReturnType<OtaUpdateServicePort['getStatus']>>>('/api/v1/ota/status');
    return { ...status, state: { ...status.state, updatedAt: new Date(status.state.updatedAt) } };
  }

  checkForUpdate(manifestUrl?: string) {
    return this.request<Awaited<ReturnType<OtaUpdateServicePort['checkForUpdate']>>>('/api/v1/ota/check', 'POST',
      manifestUrl ? { manifestUrl } : undefined);
  }

  downloadUpdate(request: DownloadUpdateRequest) {
    return this.request<Awaited<ReturnType<OtaUpdateServicePort['downloadUpdate']>>>('/api/v1/ota/download', 'POST', request);
  }

  async installUpdate(request: OtaInstallRequest) {
    return this.request<Awaited<ReturnType<OtaUpdateServicePort['installUpdate']>>>('/api/v1/ota/install', 'POST', {
      version: request.version,
      component: request.component,
      platform: request.platform,
      manifestUrl: request.manifestUrl,
    });
  }

  rollbackUpdate() {
    return this.request<Awaited<ReturnType<OtaUpdateServicePort['rollbackUpdate']>>>('/api/v1/ota/rollback', 'POST');
  }

  async recordExternalOutcome(_input: OtaExternalOutcome): Promise<void> {
    throw new Error('External updater reports outcomes directly to PrintOps');
  }

  getPrintSystemStatus() {
    return this.request<{ state: 'IDLE' | 'PRINTING' | 'PAUSED' | 'ERROR'; queueDepth: number; readiness: string }>('/api/v1/ota/print-status');
  }

  async getDeviceInfo(): Promise<{
    hostname?: string;
    installationPath?: string;
    dataPath?: string;
    osVersion?: string;
    ipAddresses?: string[];
    capabilities?: string[];
  } | undefined> {
    try {
      return await this.request<{
        hostname?: string;
        installationPath?: string;
        dataPath?: string;
        osVersion?: string;
        ipAddresses?: string[];
        capabilities?: string[];
      }>('/api/v1/ota/device-info');
    } catch (error) {
      if (error instanceof Error && error.message.includes('returned 404')) return undefined;
      throw error;
    }
  }

  applyContentBundle(bundle: ControlContentBundle): Promise<ControlContentSyncResult> {
    return this.request('/api/v1/ota/content-sync', 'POST', bundle);
  }

  getClientContentIndex(): Promise<ControlContentIndex> {
    return this.request('/api/v1/ota/content-index');
  }

  exportClientContent(kind: ControlContentKind, code: string): Promise<ControlContentBundle> {
    return this.request('/api/v1/ota/content-export', 'POST', { kind, code });
  }
}
