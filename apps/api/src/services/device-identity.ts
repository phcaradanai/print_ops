import type {
  ControlCommandProgress,
  ControlCommandType,
  ControlOtaTransitionEvent,
  DeviceIdentity,
  OtaTransitionState,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import os from 'node:os';

export type DeviceCommandReplayStatus = 'PROCESSING' | 'PROCESSED';

export interface StoredDeviceCommand {
  commandId: string;
  idempotencyKey?: string;
  commandType?: ControlCommandType;
  targetVersion?: string;
  lastAuthoritativeOtaState?: OtaTransitionState;
  lastAuthoritativeOtaAt?: string;
  lastCommandState?: OtaTransitionState;
  lastCommandAt?: string;
  progress?: ControlCommandProgress;
  lastLocalOtaState?: string;
  replayStatus: DeviceCommandReplayStatus;
  executionStarted?: boolean;
  executionStartedAt?: string;
}

export interface StoredDeviceIdentity {
  installationId: string;
  siteId: string;
  deviceId?: string;
  deviceToken?: string;
  enrolledAt?: string;
  hostname?: string;
  platform?: string;
  architecture?: string;
  createdAt: string;
  currentControlCommandId?: string;
  controlCommands?: StoredDeviceCommand[];
  controlEventOutbox?: ControlOtaTransitionEvent[];
}

export interface DeviceIdentityOptions {
  storagePath?: string;
  defaultSiteId?: string;
  appVersion?: string;
  schemaVersion?: number;
  runnerVersion?: string;
}

export class DeviceIdentityStore {
  private readonly filePath: string;
  private readonly defaultSiteId: string;
  private readonly appVersion: string;
  private readonly schemaVersion: number;
  private readonly runnerVersion: string;
  private identity: StoredDeviceIdentity;

  constructor(opts: DeviceIdentityOptions = {}) {
    const defaultDataDir = process.env['PRINTOPS_DATA_DIR'] || './data';
    this.filePath = resolve(
      opts.storagePath ||
      process.env['PRINTOPS_DEVICE_IDENTITY_PATH'] ||
      `${defaultDataDir}/device-identity.json`
    );
    this.defaultSiteId = opts.defaultSiteId || process.env['PRINTOPS_SITE_ID'] || 'default-site';
    this.appVersion = opts.appVersion || process.env['PRINTOPS_APP_VERSION'] || '0.1.32';
    this.schemaVersion = opts.schemaVersion ?? 7;
    this.runnerVersion = opts.runnerVersion || process.env['PRINTOPS_RUNNER_VERSION'] || '0.1.28';

    this.identity = this.loadOrInitialize();
  }

  private loadOrInitialize(): StoredDeviceIdentity {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<StoredDeviceIdentity>;
        if (parsed.installationId) {
          return {
            installationId: parsed.installationId,
            siteId: parsed.siteId || this.defaultSiteId,
            deviceId: parsed.deviceId,
            deviceToken: parsed.deviceToken,
            enrolledAt: parsed.enrolledAt,
            hostname: os.hostname(),
            platform: process.platform,
            architecture: process.arch,
            createdAt: parsed.createdAt || new Date().toISOString(),
            currentControlCommandId: parsed.currentControlCommandId,
            controlCommands: Array.isArray(parsed.controlCommands) ? parsed.controlCommands : undefined,
            controlEventOutbox: Array.isArray(parsed.controlEventOutbox) ? parsed.controlEventOutbox : undefined,
          };
        }
      }
    } catch {
      // If reading/parsing fails, initialize new identity below
    }

    // Initialize fresh installation identity
    const fresh: StoredDeviceIdentity = {
      installationId: `inst_${generateId()}`,
      siteId: this.defaultSiteId,
      hostname: os.hostname(),
      platform: process.platform,
      architecture: process.arch,
      createdAt: new Date().toISOString(),
    };
    this.save(fresh);
    return fresh;
  }

  private save(data: StoredDeviceIdentity): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[DeviceIdentityStore] Failed to persist identity to ${this.filePath}:`, err instanceof Error ? err.message : err);
    }
  }

  getControlCommand(commandId: string, idempotencyKey?: string): StoredDeviceCommand | undefined {
    const commands = this.identity.controlCommands ?? [];
    for (let index = commands.length - 1; index >= 0; index -= 1) {
      const command = commands[index]!;
      if (command.commandId === commandId
        || (idempotencyKey && command.idempotencyKey === idempotencyKey)) {
        return command;
      }
    }
    return undefined;
  }

  markControlCommandStarted(commandId: string): void {
    const controlCommands = [...(this.identity.controlCommands ?? [])];
    const index = controlCommands.findIndex((command) => command.commandId === commandId);
    if (index < 0) throw new Error(`Cannot mark unknown control command ${commandId} as started`);
    const command = controlCommands[index]!;
    if (command.executionStarted) return;
    controlCommands[index] = {
      ...command,
      executionStarted: true,
      executionStartedAt: new Date().toISOString(),
    };
    this.identity = { ...this.identity, controlCommands };
    this.save(this.identity);
  }
  resumeDeferredControlCommand(commandId: string): void {
    const controlCommands = [...(this.identity.controlCommands ?? [])];
    const index = controlCommands.findIndex((command) => command.commandId === commandId);
    if (index < 0) throw new Error(`Cannot resume unknown control command ${commandId}`);
    const command = controlCommands[index]!;
    if (!command.executionStarted
      || command.lastAuthoritativeOtaState !== 'WAITING_FOR_IDLE'
      || command.lastLocalOtaState !== 'WAITING_FOR_IDLE') {
      throw new Error(`Control command ${commandId} is not a persisted deferred install`);
    }
    controlCommands[index] = {
      ...command,
      executionStarted: false,
      executionStartedAt: undefined,
    };
    this.identity = { ...this.identity, controlCommands };
    this.save(this.identity);
  }

  getCurrentControlCommand(): StoredDeviceCommand | undefined {
    const commandId = this.identity.currentControlCommandId;
    return commandId
      ? this.identity.controlCommands?.find((command) => command.commandId === commandId)
      : undefined;
  }

  getPendingControlEvents(): ControlOtaTransitionEvent[] {
    return [...(this.identity.controlEventOutbox ?? [])];
  }
  getLatestControlCommand(): StoredDeviceCommand | undefined {
    try {
      // The API and packaged control agent share this file but have separate
      // in-memory stores. Read the latest valid command snapshot for the UI.
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<StoredDeviceIdentity>;
      if (parsed.installationId === this.identity.installationId && Array.isArray(parsed.controlCommands)) {
        const commands = parsed.controlCommands;
        return commands[commands.length - 1];
      }
    } catch {
      // Keep the in-memory state if a sibling process is partway through a write.
    }
    const commands = this.identity.controlCommands ?? [];
    return commands[commands.length - 1];
  }

  persistControlTransitions(
    events: ControlOtaTransitionEvent[],
    command?: {
      idempotencyKey?: string;
      commandType?: ControlCommandType;
      targetVersion?: string;
      localOtaState?: string;
    },
  ): void {
    const controlCommands = [...(this.identity.controlCommands ?? [])];
    let currentControlCommandId = this.identity.currentControlCommandId;

    for (const event of events) {
      if (!event.commandId) continue;
      const index = controlCommands.findIndex((entry) => entry.commandId === event.commandId);
      const previous = index >= 0 ? controlCommands[index]! : undefined;
      const commandType = command?.commandType ?? previous?.commandType;
      const isContentCommand = commandType === 'CONTENT_SYNC' || commandType === 'CONTENT_LIST' || commandType === 'CONTENT_PULL';
      const terminal = event.state === 'COMPLETED'
        || event.state === 'INSTALL_FAILED'
        || event.state === 'HEALTH_CHECK_FAILED'
        || event.state === 'ROLLED_BACK'
        || event.state === 'ROLLBACK_FAILED'
        || event.state === 'RECOVERY_REQUIRED'
        || (event.state === 'VERIFIED' && commandType === 'OTA_DOWNLOAD');
      const next: StoredDeviceCommand = {
        commandId: event.commandId,
        idempotencyKey: command?.idempotencyKey ?? previous?.idempotencyKey,
        commandType,
        targetVersion: event.targetVersion ?? command?.targetVersion ?? previous?.targetVersion,
        lastAuthoritativeOtaState: isContentCommand ? previous?.lastAuthoritativeOtaState : event.state,
        lastAuthoritativeOtaAt: isContentCommand ? previous?.lastAuthoritativeOtaAt : event.timestamp,
        lastCommandState: event.state,
        lastCommandAt: event.timestamp,
        progress: event.progress ?? previous?.progress,
        lastLocalOtaState: command?.localOtaState ?? previous?.lastLocalOtaState,
        replayStatus: terminal ? 'PROCESSED' : previous?.replayStatus ?? 'PROCESSING',
        executionStarted: previous?.executionStarted ?? false,
        executionStartedAt: previous?.executionStartedAt,
      };
      if (index >= 0) controlCommands[index] = next;
      else controlCommands.push(next);
      if (!isContentCommand && (event.state === 'ACCEPTED' || currentControlCommandId === event.commandId)) {
        currentControlCommandId = event.commandId;
      }
    }

    const knownEventIds = new Set((this.identity.controlEventOutbox ?? []).map((event) => event.eventId));
    const newEvents = events.filter((event) => !knownEventIds.has(event.eventId));
    this.identity = {
      ...this.identity,
      currentControlCommandId,
      controlCommands,
      controlEventOutbox: [...(this.identity.controlEventOutbox ?? []), ...newEvents],
    };
    this.save(this.identity);
  }

  acknowledgeControlEvent(eventId: string): void {
    const pending = this.identity.controlEventOutbox ?? [];
    if (!pending.some((event) => event.eventId === eventId)) return;
    this.identity = {
      ...this.identity,
      controlEventOutbox: pending.filter((event) => event.eventId !== eventId),
    };
    this.save(this.identity);
  }

  getInstallationId(): string {
    return this.identity.installationId;
  }

  getDeviceId(): string | undefined {
    return this.identity.deviceId;
  }

  getDeviceToken(): string | undefined {
    return this.identity.deviceToken;
  }

  getSiteId(): string {
    return this.identity.siteId;
  }

  isEnrolled(): boolean {
    return Boolean(this.identity.deviceId && this.identity.deviceToken);
  }

  getIdentity(): DeviceIdentity {
    return {
      deviceId: this.identity.deviceId || `unregistered_${this.identity.installationId}`,
      installationId: this.identity.installationId,
      siteId: this.identity.siteId,
      hostname: os.hostname(),
      platform: process.platform,
      architecture: process.arch,
      appVersion: this.appVersion,
      schemaVersion: this.schemaVersion,
      runnerVersion: this.runnerVersion,
    };
  }

  recordEnrollment(deviceId: string, deviceToken: string, siteId?: string): void {
    this.identity = {
      ...this.identity,
      deviceId,
      deviceToken,
      siteId: siteId || this.identity.siteId,
      enrolledAt: new Date().toISOString(),
    };
    this.save(this.identity);
  }

  clearEnrollment(): void {
    this.identity = {
      ...this.identity,
      deviceId: undefined,
      deviceToken: undefined,
      enrolledAt: undefined,
      hostname: os.hostname(),
      platform: process.platform,
      architecture: process.arch,
    };
    this.save(this.identity);
  }
}
