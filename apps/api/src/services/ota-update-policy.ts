import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OtaUpdateServicePort } from './ota-update.service.js';

export interface OtaPolicyState {
  failureCount: number;
  /** Candidate release to which failureCount belongs. */
  failureVersion: string | null;
  blockedVersion: string | null;
  nextAttemptAt: string | null;
  /** External handoff whose terminal outcome is still to be observed. */
  pendingVersion: string | null;
  /** A failed native rollback leaves maintenance fail-closed until an operator recovers it. */
  operatorRecoveryRequired: boolean;
  /** Release whose failed rollback requires explicit operator recovery. */
  rollbackFailedVersion: string | null;
  updatedAt: string;
}

export interface OtaPolicyStateStorePort {
  load(): Promise<OtaPolicyState | null>;
  save(value: OtaPolicyState): Promise<void>;
}

export class FileOtaPolicyStateStore implements OtaPolicyStateStorePort {
  constructor(private readonly path: string) {}

  async load(): Promise<OtaPolicyState | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      return isPolicyState(value) ? value : null;
    } catch {
      return null;
    }
  }

  async save(value: OtaPolicyState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await rm(temporary, { force: true });
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, this.path);
  }
}

interface OtaPolicyLogger {
  info?(context: Record<string, unknown>, message: string): void;
  warn?(context: Record<string, unknown>, message: string): void;
  error?(context: Record<string, unknown>, message: string): void;
}

export interface OtaUpdatePolicyConfig {
  enabled: boolean;
  checkIntervalMs: number;
  jitterMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  maxFailures: number;
}

export type OtaPolicyRunResult =
  | { kind: 'disabled' | 'persistence-unavailable' | 'waiting' | 'blocked' | 'duplicate'; nextDelayMs?: number; version?: string }
  | { kind: 'no-update' | 'installed' | 'deferred'; nextDelayMs: number; version?: string }
  | { kind: 'failed'; nextDelayMs: number; version?: string; blocked: boolean };

const EMPTY_STATE = (): OtaPolicyState => ({
  failureCount: 0,
  failureVersion: null,
  blockedVersion: null,
  nextAttemptAt: null,
  pendingVersion: null,
  operatorRecoveryRequired: false,
  rollbackFailedVersion: null,
  updatedAt: new Date(0).toISOString(),
});

/**
 * Local-only automatic application OTA policy. The update service remains the
 * authority for manifest trust, artifact verification, print-idle gating, and
 * native handoff; this worker only schedules those operations and remembers
 * bounded retry state across API restarts.
 */
export class OtaUpdatePolicyWorker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopped = true;
  private persistenceUnavailable = false;
  private state: OtaPolicyState = EMPTY_STATE();
  private stateLoaded: Promise<void> | undefined;

  constructor(
    private readonly deps: {
      service: OtaUpdateServicePort;
      config: OtaUpdatePolicyConfig;
      stateStore?: OtaPolicyStateStorePort;
      now?: () => Date;
      random?: () => number;
      logger?: OtaPolicyLogger;
    },
  ) {}

  start(): void {
    if (!this.deps.config.enabled || !this.stopped) return;
    this.stopped = false;
    void this.ensureState().then(() => {
      if (!this.persistenceUnavailable) this.schedule(this.jitterDelay());
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async runOnce(): Promise<OtaPolicyRunResult> {
    if (!this.deps.config.enabled) return { kind: 'disabled' };
    await this.ensureState();
    if (this.persistenceUnavailable) {
      return { kind: 'persistence-unavailable' };
    }
    if (this.running) return { kind: 'duplicate' };
    this.running = true;
    let targetVersion: string | undefined;
    try {
      const pendingOutcome = await this.observePendingHandoff();
      if (pendingOutcome) return pendingOutcome;

      // A failed native rollback is distinct from an install/health failure:
      // do not discover, download, or install any further candidate until an
      // operator has restored a known-good installation and cleared this state.
      if (this.state.operatorRecoveryRequired) {
        return { kind: 'blocked', version: this.state.rollbackFailedVersion ?? undefined };
      }

      const now = this.now();
      if (this.state.nextAttemptAt && Date.parse(this.state.nextAttemptAt) > now.getTime()) {
        return {
          kind: 'waiting',
          nextDelayMs: Math.max(1, Date.parse(this.state.nextAttemptAt) - now.getTime()),
        };
      }

      const check = await this.deps.service.checkForUpdate();
      targetVersion = check.latestVersion;
      if (!check.available || !check.latestVersion) {
        await this.recordSuccess();
        return { kind: 'no-update', nextDelayMs: this.nextInterval() };
      }

      if (this.state.blockedVersion && this.state.blockedVersion === check.latestVersion) {
        return { kind: 'blocked', version: check.latestVersion };
      }
      if (this.state.failureVersion !== check.latestVersion || this.state.blockedVersion !== null && this.state.blockedVersion !== check.latestVersion) {
        this.state = {
          ...this.state,
          failureCount: 0,
          failureVersion: check.latestVersion,
          blockedVersion: null,
          nextAttemptAt: null,
        };
        await this.saveState();
      }

      await this.deps.service.downloadUpdate({
        version: check.latestVersion,
        component: 'desktop',
        platform: 'windows-x64',
      });
      const install = await this.deps.service.installUpdate({
        version: check.latestVersion,
        component: 'desktop',
        platform: 'windows-x64',
        mode: 'automatic',
      });
      if (install.deferred || install.state === 'WAITING_FOR_IDLE') {
        return {
          kind: 'deferred',
          nextDelayMs: this.nextInterval(),
          version: check.latestVersion,
        };
      }
      if (install.state === 'RESTART_PENDING') {
        // Handoff acceptance is not update success. Persist the candidate so
        // the next process can reconcile the external updater outcome and
        // count a rollback against this exact release.
        this.state = { ...this.state, pendingVersion: check.latestVersion, nextAttemptAt: null };
        await this.saveState();
        this.stop();
        return { kind: 'waiting', version: check.latestVersion };
      }
      await this.recordSuccess();
      return { kind: 'installed', nextDelayMs: this.nextInterval(), version: check.latestVersion };
    } catch (error) {
      const result = await this.recordFailure(targetVersion, error);
      return { kind: 'failed', ...result, version: targetVersion };
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      const result = await this.runOnce();
      if (this.stopped) return;
      const next = result.nextDelayMs ?? this.nextInterval();
      this.schedule(next + this.jitterDelay());
    }, Math.max(1, delayMs));
    this.timer.unref?.();
  }

  private async ensureState(): Promise<void> {
    if (!this.stateLoaded) {
      this.stateLoaded = (async () => {
        const loaded = await this.deps.stateStore?.load();
        if (loaded) {
          // Accept policy files written before failureVersion/pendingVersion
          // existed, but make the in-memory contract complete immediately.
          this.state = {
            ...EMPTY_STATE(),
            ...loaded,
            failureVersion: loaded.failureVersion ?? null,
            pendingVersion: loaded.pendingVersion ?? null,
            operatorRecoveryRequired: loaded.operatorRecoveryRequired ?? false,
            rollbackFailedVersion: loaded.rollbackFailedVersion ?? null,
          };
        }
        if (this.deps.stateStore) await this.deps.stateStore.save(this.state);
      })().catch((error) => {
        this.persistenceUnavailable = true;
        this.deps.logger?.warn?.({ error }, 'OTA automatic policy state could not be loaded or persisted; automatic updates are paused');
      });
    }
    await this.stateLoaded;
  }

  private async recordSuccess(): Promise<void> {
    this.state = {
      failureCount: 0,
      failureVersion: null,
      blockedVersion: null,
      nextAttemptAt: null,
      pendingVersion: null,
      operatorRecoveryRequired: false,
      rollbackFailedVersion: null,
      updatedAt: this.now().toISOString(),
    };
    await this.saveState();
  }

  private async recordFailure(version: string | undefined, error: unknown): Promise<{
    nextDelayMs: number;
    blocked: boolean;
  }> {
    const sameVersion = version !== undefined && version === this.state.failureVersion;
    const failureCount = version === undefined
      ? (this.state.failureVersion === null ? this.state.failureCount + 1 : 1)
      : (sameVersion ? this.state.failureCount + 1 : 1);
    const blocked = Boolean(version && failureCount >= this.deps.config.maxFailures);
    const nextAttemptAt = blocked
      ? null
      : new Date(this.now().getTime() + this.backoff(failureCount)).toISOString();
    this.state = {
      failureCount,
      failureVersion: version ?? null,
      blockedVersion: blocked ? version ?? null : null,
      nextAttemptAt,
      pendingVersion: null,
      operatorRecoveryRequired: false,
      rollbackFailedVersion: null,
      updatedAt: this.now().toISOString(),
    };
    await this.saveState();
    this.deps.logger?.warn?.({
      error,
      version,
      failureCount,
      blocked,
      nextAttemptAt,
    }, blocked
      ? 'Automatic OTA paused for the failed release; a newer release or operator action is required'
      : 'Automatic OTA attempt failed; bounded retry scheduled');
    return { nextDelayMs: blocked ? this.nextInterval() : this.backoff(failureCount), blocked };
  }

  private async saveState(): Promise<void> {
    if (this.persistenceUnavailable) return;
    try {
      await this.deps.stateStore?.save(this.state);
    } catch (error) {
      this.persistenceUnavailable = true;
      this.deps.logger?.error?.({ error }, 'OTA automatic policy state could not be persisted');
    }
  }

  private async recordRollbackFailure(version: string, error: unknown): Promise<{
    nextDelayMs: number;
    blocked: boolean;
  }> {
    this.state = {
      failureCount: Math.max(1, this.state.failureCount),
      failureVersion: version,
      blockedVersion: version,
      nextAttemptAt: null,
      pendingVersion: null,
      operatorRecoveryRequired: true,
      rollbackFailedVersion: version,
      updatedAt: this.now().toISOString(),
    };
    await this.saveState();
    this.deps.logger?.error?.({ error, version }, 'Automatic OTA blocked: native rollback failed and operator recovery is required');
    return { nextDelayMs: this.nextInterval(), blocked: true };
  }

  private backoff(failureCount: number): number {
    return Math.min(
      this.deps.config.retryMaxMs,
      this.deps.config.retryBaseMs * (2 ** Math.max(0, failureCount - 1)),
    );
  }

  private nextInterval(): number {
    return Math.max(1_000, this.deps.config.checkIntervalMs);
  }

  private jitterDelay(): number {
    const random = Math.min(1, Math.max(0, this.deps.random?.() ?? Math.random()));
    return Math.floor(random * Math.max(0, this.deps.config.jitterMs));
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** Reconcile a handoff before allowing the policy to start another cycle. */
  private async observePendingHandoff(): Promise<OtaPolicyRunResult | null> {
    const version = this.state.pendingVersion;
    if (!version) return null;

    const status = await this.deps.service.getStatus();
    const state = status?.state;
    if (!state || state.targetVersion !== version) {
      return { kind: 'waiting', version, nextDelayMs: this.nextInterval() };
    }
    if (state.state === 'RESTART_PENDING'
      || state.state === 'INSTALLING'
      || state.state === 'INSTALLING_COMPLETE'
      || state.state === 'HEALTH_CHECK'
      || state.state === 'ROLLING_BACK') {
      return { kind: 'waiting', version, nextDelayMs: this.nextInterval() };
    }
    if (state.state === 'COMPLETED') {
      await this.recordSuccess();
      return { kind: 'no-update', nextDelayMs: this.nextInterval(), version };
    }
    if (state.state === 'ROLLBACK_FAILED') {
      return {
        kind: 'failed',
        ...(await this.recordRollbackFailure(version, state.errorMessage ?? 'external updater rollback failed')),
        version,
      };
    }
    if (state.state === 'ROLLED_BACK'
      || state.state === 'INSTALL_FAILED'
      || state.state === 'HEALTH_CHECK_FAILED') {
      return {
        kind: 'failed',
        ...(await this.recordFailure(version, state.errorMessage ?? `external updater ended in ${state.state}`)),
        version,
      };
    }
    return { kind: 'waiting', version, nextDelayMs: this.nextInterval() };
  }
}

function isPolicyState(value: unknown): value is OtaPolicyState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isSafeInteger(record['failureCount'])
    && (record['failureCount'] as number) >= 0
    && (record['failureVersion'] === undefined || record['failureVersion'] === null || typeof record['failureVersion'] === 'string')
    && (record['blockedVersion'] === null || typeof record['blockedVersion'] === 'string')
    && (record['nextAttemptAt'] === null || typeof record['nextAttemptAt'] === 'string')
    && (record['pendingVersion'] === undefined || record['pendingVersion'] === null || typeof record['pendingVersion'] === 'string')
    && (record['operatorRecoveryRequired'] === undefined || typeof record['operatorRecoveryRequired'] === 'boolean')
    && (record['rollbackFailedVersion'] === undefined || record['rollbackFailedVersion'] === null || typeof record['rollbackFailedVersion'] === 'string')
    && typeof record['updatedAt'] === 'string';
}
