import { readFileSync } from 'node:fs';
import type {
  ControlCommandProgress,
  ControlContentBundle,
  ControlContentIndex,
  ControlContentKind,
} from '@printerops/domain';
import type { ControlContentSyncResult } from './control-content-sync.service.js';
import type {
  DownloadUpdateRequest,
  DownloadUpdateResult,
  OtaArtifactDownloadProgress,
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
  private async requestWithProgress<T, P>(
    path: string,
    method: string,
    body: unknown,
    onProgress?: (progress: P) => void | Promise<void>,
  ): Promise<T> {
    const token = readFileSync(this.tokenPath, 'utf8').trim();
    if (!token) throw new Error('PrintOps local OTA token is empty');
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        'x-printops-ota-token': token,
        accept: 'application/x-ndjson',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`PrintOps OTA API ${method} ${path} returned ${response.status}: ${detail}`);
    }
    if (!response.body) throw new Error(`PrintOps OTA API ${method} ${path} returned no progress stream`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: T | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      if (done) buffer += decoder.decode();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { type?: string; progress?: P; result?: T; message?: string };
        if (event.type === 'progress' && event.progress) {
          await onProgress?.(event.progress);
        } else if (event.type === 'result') {
          result = event.result;
        } else if (event.type === 'error') {
          throw new Error(event.message || `PrintOps OTA API ${method} ${path} failed`);
        } else {
          throw new Error(`PrintOps OTA API ${method} ${path} returned an unknown progress event`);
        }
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const event = JSON.parse(buffer) as { type?: string; progress?: P; result?: T; message?: string };
      if (event.type === 'progress' && event.progress) await onProgress?.(event.progress);
      else if (event.type === 'result') result = event.result;
      else if (event.type === 'error') throw new Error(event.message || `PrintOps OTA API ${method} ${path} failed`);
      else throw new Error(`PrintOps OTA API ${method} ${path} returned an unknown progress event`);
    }
    if (result === undefined) throw new Error(`PrintOps OTA API ${method} ${path} ended without a result`);
    return result;
  }

  async getStatus() {
    const status = await this.request<Awaited<ReturnType<OtaUpdateServicePort['getStatus']>>>('/api/v1/ota/status');
    return { ...status, state: { ...status.state, updatedAt: new Date(status.state.updatedAt) } };
  }

  async recordControlAgentHeartbeat(): Promise<void> {
    await this.request<{ accepted: boolean }>('/api/v1/ota/control-agent-heartbeat', 'POST');
  }

  checkForUpdate(manifestUrl?: string) {
    return this.request<Awaited<ReturnType<OtaUpdateServicePort['checkForUpdate']>>>('/api/v1/ota/check', 'POST',
      manifestUrl ? { manifestUrl } : undefined);
  }

  downloadUpdate(request: DownloadUpdateRequest) {
    const { onProgress, ...body } = request;
    return this.requestWithProgress<DownloadUpdateResult, OtaArtifactDownloadProgress>(
      '/api/v1/ota/download', 'POST', body, onProgress);
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

  applyContentBundle(
    bundle: ControlContentBundle,
    onProgress?: (progress: ControlCommandProgress) => void | Promise<void>,
  ): Promise<ControlContentSyncResult> {
    return this.requestWithProgress<ControlContentSyncResult, ControlCommandProgress>(
      '/api/v1/ota/content-sync',
      'POST',
      bundle,
      onProgress,
    );
  }

  getClientContentIndex(): Promise<ControlContentIndex> {
    return this.request('/api/v1/ota/content-index');
  }

  exportClientContent(kind: ControlContentKind, code: string): Promise<ControlContentBundle> {
    return this.request('/api/v1/ota/content-export', 'POST', { kind, code });
  }
}
