import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OtaUpdateServicePort } from './ota-update.service.js';

export interface OtaPolicyState {
  failureCount: number;
  blockedVersion: string | null;
  nextAttemptAt: string | null;
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
  | { kind: 'no-update' | 'installed'; nextDelayMs: number; version?: string }
  | { kind: 'failed'; nextDelayMs: number; version?: string; blocked: boolean };

const EMPTY_STATE = (): OtaPolicyState => ({
  failureCount: 0,
  blockedVersion: null,
  nextAttemptAt: null,
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

    const now = this.now();
    if (this.state.nextAttemptAt && Date.parse(this.state.nextAttemptAt) > now.getTime()) {
      return {
        kind: 'waiting',
        nextDelayMs: Math.max(1, Date.parse(this.state.nextAttemptAt) - now.getTime()),
      };
    }

    this.running = true;
    let targetVersion: string | undefined;
    try {
      const check = await this.deps.service.checkForUpdate();
      targetVersion = check.latestVersion;
      if (!check.available || !check.latestVersion) {
        await this.recordSuccess();
        return { kind: 'no-update', nextDelayMs: this.nextInterval() };
      }

      if (this.state.blockedVersion && this.state.blockedVersion === check.latestVersion) {
        return { kind: 'blocked', version: check.latestVersion };
      }
      if (this.state.blockedVersion && this.state.blockedVersion !== check.latestVersion) {
        this.state = EMPTY_STATE();
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
      });
      await this.recordSuccess();
      if (install.state === 'RESTART_PENDING') this.stop();
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
        if (loaded) this.state = loaded;
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
      blockedVersion: null,
      nextAttemptAt: null,
      updatedAt: this.now().toISOString(),
    };
    await this.saveState();
  }

  private async recordFailure(version: string | undefined, error: unknown): Promise<{
    nextDelayMs: number;
    blocked: boolean;
  }> {
    const failureCount = this.state.failureCount + 1;
    const blocked = Boolean(version && failureCount >= this.deps.config.maxFailures);
    const nextAttemptAt = blocked
      ? null
      : new Date(this.now().getTime() + this.backoff(failureCount)).toISOString();
    this.state = {
      failureCount,
      blockedVersion: blocked ? version ?? null : this.state.blockedVersion,
      nextAttemptAt,
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
}

function isPolicyState(value: unknown): value is OtaPolicyState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isSafeInteger(record['failureCount'])
    && (record['failureCount'] as number) >= 0
    && (record['blockedVersion'] === null || typeof record['blockedVersion'] === 'string')
    && (record['nextAttemptAt'] === null || typeof record['nextAttemptAt'] === 'string')
    && typeof record['updatedAt'] === 'string';
}
