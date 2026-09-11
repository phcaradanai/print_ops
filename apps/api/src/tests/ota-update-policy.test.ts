import { describe, expect, it, vi } from 'vitest';
import type { OtaUpdateServicePort } from '../services/ota-update.service.js';
import {
  OtaUpdatePolicyWorker,
  type OtaPolicyState,
  type OtaPolicyStateStorePort,
} from '../services/ota-update-policy.js';

function store(initial: OtaPolicyState | null = null): OtaPolicyStateStorePort & { value: OtaPolicyState | null } {
  return {
    value: initial,
    async load() { return this.value; },
    async save(value) { this.value = { ...value }; },
  };
}

function service(overrides: Partial<Record<keyof OtaUpdateServicePort, unknown>> = {}): OtaUpdateServicePort {
  return {
    getStatus: vi.fn(),
    checkForUpdate: vi.fn(async () => ({
      enabled: true,
      available: true,
      currentVersion: '0.1.28',
      latestVersion: '0.1.29',
      channel: 'stable',
    })),
    downloadUpdate: vi.fn(async () => ({
      downloaded: true,
      alreadyCurrent: false,
      version: '0.1.29',
      component: 'desktop',
      platform: 'windows-x64',
      bytes: 10,
      sha256: 'a'.repeat(64),
      source: 'wan',
      signatureVerification: 'verified',
    })),
    installUpdate: vi.fn(async () => ({
      installed: false,
      version: '0.1.29',
      component: 'desktop',
      platform: 'windows-x64',
      state: 'RESTART_PENDING',
      restartRequired: true,
    })),
    rollbackUpdate: vi.fn(),
    recordExternalOutcome: vi.fn(),
    ...overrides,
  } as OtaUpdateServicePort;
}

describe('OtaUpdatePolicyWorker', () => {
  it('downloads during the policy cycle and delegates idle-safe install to the OTA engine', async () => {
    const client = service();
    const worker = new OtaUpdatePolicyWorker({
      service: client,
      config: {
        enabled: true,
        checkIntervalMs: 1_000,
        jitterMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 100,
        maxFailures: 3,
      },
      random: () => 0,
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'waiting', version: '0.1.29' });
    expect(client.downloadUpdate).toHaveBeenCalledWith({
      version: '0.1.29',
      component: 'desktop',
      platform: 'windows-x64',
    });
    expect(client.installUpdate).toHaveBeenCalledWith({
      version: '0.1.29',
      component: 'desktop',
      platform: 'windows-x64',
      mode: 'automatic',
    });
  });

  it('persists a failed target as blocked after bounded retries instead of looping forever', async () => {
    const state = store();
    const client = service({
      downloadUpdate: vi.fn(async () => { throw new Error('corrupt artifact'); }),
    });
    let now = new Date('2026-09-10T00:00:00Z');
    const worker = new OtaUpdatePolicyWorker({
      service: client,
      stateStore: state,
      config: {
        enabled: true,
        checkIntervalMs: 1_000,
        jitterMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 100,
        maxFailures: 2,
      },
      now: () => now,
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'failed', blocked: false });
    now = new Date(now.getTime() + 11);
    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'failed', blocked: true });
    expect(state.value).toMatchObject({ failureCount: 2, blockedVersion: '0.1.29', nextAttemptAt: null });
    expect(client.downloadUpdate).toHaveBeenCalledTimes(2);

    const restarted = new OtaUpdatePolicyWorker({
      service: client,
      stateStore: state,
      config: {
        enabled: true,
        checkIntervalMs: 1_000,
        jitterMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 100,
        maxFailures: 2,
      },
    });
    await expect(restarted.runOnce()).resolves.toMatchObject({ kind: 'blocked' });
    expect(client.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it('resets the failure budget only when the candidate version changes', async () => {
    const state = store();
    let latestVersion = '0.1.29';
    const client = service({
      checkForUpdate: vi.fn(async () => ({
        enabled: true,
        available: true,
        currentVersion: '0.1.28',
        latestVersion,
        channel: 'stable' as const,
      })),
      downloadUpdate: vi.fn(async () => { throw new Error('candidate is invalid'); }),
    });
    let now = new Date('2026-09-10T00:00:00Z');
    const worker = new OtaUpdatePolicyWorker({
      service: client,
      stateStore: state,
      config: {
        enabled: true,
        checkIntervalMs: 1_000,
        jitterMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 100,
        maxFailures: 2,
      },
      now: () => now,
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'failed', blocked: false, version: '0.1.29' });
    now = new Date(now.getTime() + 11);
    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'failed', blocked: true, version: '0.1.29' });
    expect(state.value).toMatchObject({ failureCount: 2, failureVersion: '0.1.29', blockedVersion: '0.1.29' });

    latestVersion = '0.1.30';
    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'failed', blocked: false, version: '0.1.30' });
    expect(state.value).toMatchObject({ failureCount: 1, failureVersion: '0.1.30', blockedVersion: null });
    expect(client.downloadUpdate).toHaveBeenCalledTimes(3);
  });

  it('defers a busy automatic install without recording a failure', async () => {
    const state = store();
    const client = service({
      installUpdate: vi.fn(async () => ({
        installed: false,
        version: '0.1.29',
        component: 'desktop' as const,
        platform: 'windows-x64' as const,
        state: 'WAITING_FOR_IDLE' as const,
        deferred: true,
      })),
    });
    const worker = new OtaUpdatePolicyWorker({
      service: client,
      stateStore: state,
      config: {
        enabled: true,
        checkIntervalMs: 1_000,
        jitterMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 100,
        maxFailures: 2,
      },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'deferred', version: '0.1.29' });
    expect(state.value).toMatchObject({ failureCount: 0, blockedVersion: null, pendingVersion: null });
  });

  it('reconciles an external rollback against the exact pending version', async () => {
    const state = store({
      failureCount: 0,
      failureVersion: null,
      blockedVersion: null,
      nextAttemptAt: null,
      pendingVersion: '0.1.29',
      operatorRecoveryRequired: false,
      rollbackFailedVersion: null,
      updatedAt: '2026-09-10T00:00:00.000Z',
    });
    const client = service({
      getStatus: vi.fn(async () => ({
        enabled: true,
        configured: true,
        currentVersion: '0.1.28',
        currentSchemaVersion: 7,
        channel: 'stable' as const,
        signatureVerification: 'required' as const,
        installerConfigured: true,
        state: {
          state: 'ROLLED_BACK' as const,
          targetVersion: '0.1.29',
          startedAt: null,
          updatedAt: new Date(),
          errorMessage: 'health check failed',
          retryCount: 1,
        },
        stagedArtifact: null,
      })),
    });
    const worker = new OtaUpdatePolicyWorker({
      service: client,
      stateStore: state,
      config: {
        enabled: true,
        checkIntervalMs: 1_000,
        jitterMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 100,
        maxFailures: 2,
      },
    });

    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'failed', blocked: false, version: '0.1.29' });
    expect(client.checkForUpdate).not.toHaveBeenCalled();
    expect(state.value).toMatchObject({ failureCount: 1, failureVersion: '0.1.29', pendingVersion: null });
  });

  it('hard-stops automatic OTA after a persisted ROLLBACK_FAILED across restart', async () => {
    const state = store({
      failureCount: 0,
      failureVersion: null,
      blockedVersion: null,
      nextAttemptAt: null,
      pendingVersion: '0.1.29',
      operatorRecoveryRequired: false,
      rollbackFailedVersion: null,
      updatedAt: '2026-09-10T00:00:00.000Z',
    });
    const client = service({
      getStatus: vi.fn(async () => ({
        enabled: true,
        configured: true,
        currentVersion: '0.1.28',
        currentSchemaVersion: 7,
        channel: 'stable' as const,
        signatureVerification: 'required' as const,
        installerConfigured: true,
        state: {
          state: 'ROLLBACK_FAILED' as const,
          targetVersion: '0.1.29',
          startedAt: null,
          updatedAt: new Date(),
          errorMessage: 'rollback installer could not restore A',
          retryCount: 1,
        },
        stagedArtifact: null,
      })),
    });
    const config = {
      enabled: true,
      checkIntervalMs: 1_000,
      jitterMs: 0,
      retryBaseMs: 10,
      retryMaxMs: 100,
      maxFailures: 99,
    };

    const worker = new OtaUpdatePolicyWorker({ service: client, stateStore: state, config });
    await expect(worker.runOnce()).resolves.toMatchObject({ kind: 'failed', blocked: true, version: '0.1.29' });
    expect(state.value).toMatchObject({
      operatorRecoveryRequired: true,
      rollbackFailedVersion: '0.1.29',
      blockedVersion: '0.1.29',
      nextAttemptAt: null,
    });
    expect(client.checkForUpdate).not.toHaveBeenCalled();

    const restarted = new OtaUpdatePolicyWorker({ service: client, stateStore: state, config });
    await expect(restarted.runOnce()).resolves.toMatchObject({ kind: 'blocked', version: '0.1.29' });
    expect(client.checkForUpdate).not.toHaveBeenCalled();
    expect(client.downloadUpdate).not.toHaveBeenCalled();
    expect(client.installUpdate).not.toHaveBeenCalled();
  });

  it('does not start a second policy operation while the first check is in flight', async () => {
    let release!: () => void;
    const check = vi.fn(() => new Promise<{
      enabled: boolean;
      available: boolean;
      currentVersion: string;
      latestVersion?: string;
      channel: 'stable';
    }>((resolve) => {
      release = () => resolve({ enabled: true, available: false, currentVersion: '0.1.28', channel: 'stable' });
    }));
    const client = service({ checkForUpdate: check });
    const worker = new OtaUpdatePolicyWorker({
      service: client,
      config: {
        enabled: true,
        checkIntervalMs: 1_000,
        jitterMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 100,
        maxFailures: 2,
      },
    });

    const first = worker.runOnce();
    await Promise.resolve();
    await expect(worker.runOnce()).resolves.toEqual({ kind: 'duplicate' });
    release();
    await expect(first).resolves.toMatchObject({ kind: 'no-update' });
  });

  it('fails closed when automatic policy state cannot be persisted', async () => {
    const client = service();
    const check = client.checkForUpdate as ReturnType<typeof vi.fn>;
    const stateStore: OtaPolicyStateStorePort = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => { throw new Error('state directory is read-only'); }),
    };
    const worker = new OtaUpdatePolicyWorker({
      service: client,
      stateStore,
      config: {
        enabled: true,
        checkIntervalMs: 1_000,
        jitterMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 100,
        maxFailures: 2,
      },
    });

    await expect(worker.runOnce()).resolves.toEqual({ kind: 'persistence-unavailable' });
    expect(check).not.toHaveBeenCalled();
    expect(client.downloadUpdate).not.toHaveBeenCalled();
    expect(client.installUpdate).not.toHaveBeenCalled();
  });
});
