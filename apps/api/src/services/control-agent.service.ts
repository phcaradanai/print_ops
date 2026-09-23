import type {
  ControlCommandEnvelope,
  ControlOtaTransitionEvent,
  DeviceHeartbeatPayload,
  DevicePrintState,
  OtaTransitionState,
} from '@printerops/domain';
import { BLOCKING_RECOVERY_STATES } from '@printerops/domain';
import { AppError, ConflictError, generateId } from '@printerops/shared';
import type { DeviceIdentityStore } from './device-identity.js';
import type { OtaUpdateServicePort } from './ota-update.service.js';
import type { PrintAdmissionGatePort } from './print-admission-gate.js';

export type EventPublisher = (
  subject: string,
  event: ControlOtaTransitionEvent,
) => Promise<void>;

export type HeartbeatPublisher = (
  subject: string,
  heartbeat: DeviceHeartbeatPayload,
) => Promise<void>;

export interface ControlAgentDeps {
  identityStore: DeviceIdentityStore;
  otaService: OtaUpdateServicePort;
  printAdmissionGate?: PrintAdmissionGatePort;
  eventPublisher?: EventPublisher;
  heartbeatPublisher?: HeartbeatPublisher;
  getPrintStatus?: () => { state: DevicePrintState; queueDepth: number; readiness: string };
  logger?: { info: (msg: string, ...args: unknown[]) => void; error: (msg: string, ...args: unknown[]) => void; warn: (msg: string, ...args: unknown[]) => void };
}

export class PrintOpsControlAgent {
  private readonly identityStore: DeviceIdentityStore;
  private readonly otaService: OtaUpdateServicePort;
  private readonly printAdmissionGate?: PrintAdmissionGatePort;
  private readonly eventPublisher?: EventPublisher;
  private readonly heartbeatPublisher?: HeartbeatPublisher;
  private readonly getPrintStatus: () => { state: DevicePrintState; queueDepth: number; readiness: string };
  private readonly logger?: ControlAgentDeps['logger'];
  private readonly processedCommandIds = new Map<string, OtaTransitionState>();
  private heartbeatInterval?: NodeJS.Timeout;
  private isProcessingCommand = false;

  constructor(deps: ControlAgentDeps) {
    this.identityStore = deps.identityStore;
    this.otaService = deps.otaService;
    this.printAdmissionGate = deps.printAdmissionGate;
    this.eventPublisher = deps.eventPublisher;
    this.heartbeatPublisher = deps.heartbeatPublisher;
    this.getPrintStatus = deps.getPrintStatus ?? (() => ({ state: 'IDLE', queueDepth: 0, readiness: 'READY' }));
    this.logger = deps.logger;
  }

  get identity() {
    return this.identityStore.getIdentity();
  }

  async emitTransition(
    commandId: string | undefined,
    state: OtaTransitionState,
    opts: { targetVersion?: string; errorMessage?: string; details?: Record<string, unknown> } = {},
  ): Promise<void> {
    const event: ControlOtaTransitionEvent = {
      eventId: `evt_${generateId()}`,
      deviceId: this.identity.deviceId,
      commandId,
      state,
      targetVersion: opts.targetVersion,
      currentVersion: this.identity.appVersion,
      errorMessage: opts.errorMessage,
      details: opts.details,
      timestamp: new Date().toISOString(),
    };

    if (commandId) {
      this.processedCommandIds.set(commandId, state);
    }

    if (this.eventPublisher) {
      const subject = `printops.control.event.${this.identity.deviceId}`;
      try {
        await this.eventPublisher(subject, event);
      } catch (err) {
        this.logger?.error('Failed to publish OTA transition event', err);
      }
    }
  }

  async handleCommand(
    envelope: ControlCommandEnvelope,
    opts: { waitForCompletion?: boolean } = {},
  ): Promise<{ accepted: boolean; reason?: string }> {
    // 1. Device identity check
    if (envelope.device_id !== this.identity.deviceId) {
      this.logger?.warn(`Ignoring command intended for device ${envelope.device_id}, local is ${this.identity.deviceId}`);
      return { accepted: false, reason: 'DEVICE_ID_MISMATCH' };
    }

    // 2. Command expiration check
    const expiresAt = new Date(envelope.expires_at).getTime();
    if (Date.now() > expiresAt) {
      this.logger?.warn(`Command ${envelope.command_id} expired at ${envelope.expires_at}`);
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: 'Command expired before execution',
      });
      return { accepted: false, reason: 'COMMAND_EXPIRED' };
    }

    // 3. Replay protection / idempotency check
    if (this.processedCommandIds.has(envelope.command_id)) {
      this.logger?.info(`Command ${envelope.command_id} already processed, skipping duplicate`);
      return { accepted: true, reason: 'DUPLICATE_ALREADY_PROCESSED' };
    }

    // 4. Check for blocking recovery states
    const currentOtaStatus = await this.otaService.getStatus();
    if (BLOCKING_RECOVERY_STATES[currentOtaStatus.state.state]) {
      const reason = `Device in ${currentOtaStatus.state.state}; remote commands are blocked until resolved locally.`;
      this.logger?.error(reason);
      await this.emitTransition(envelope.command_id, 'RECOVERY_REQUIRED', {
        errorMessage: reason,
      });
      return { accepted: false, reason: 'RECOVERY_REQUIRED' };
    }

    // 5. Concurrency check: only one OTA operation at a time
    if (this.isProcessingCommand) {
      return { accepted: false, reason: 'DEVICE_BUSY' };
    }

    // Acknowledge acceptance
    await this.emitTransition(envelope.command_id, 'ACCEPTED', {
      targetVersion: envelope.target_version,
    });

    // Execute command asynchronously unless caller explicitly requested waiting
    if (opts.waitForCompletion) {
      await this.executeCommand(envelope);
    } else {
      void this.executeCommand(envelope);
    }

    return { accepted: true };
  }

  private async executeCommand(envelope: ControlCommandEnvelope): Promise<void> {
    this.isProcessingCommand = true;
    try {
      switch (envelope.type) {
        case 'OTA_CHECK':
          await this.executeCheck(envelope);
          break;
        case 'OTA_DOWNLOAD':
          await this.executeDownload(envelope);
          break;
        case 'OTA_INSTALL':
          await this.executeInstall(envelope);
          break;
        case 'OTA_ROLLBACK':
          await this.executeRollback(envelope);
          break;
        default:
          await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
            errorMessage: `Unknown command type: ${String(envelope.type)}`,
          });
      }
    } catch (err) {
      this.logger?.error('Error executing control command', err);
    } finally {
      this.isProcessingCommand = false;
    }
  }

  private async executeCheck(envelope: ControlCommandEnvelope): Promise<void> {
    await this.emitTransition(envelope.command_id, 'CHECKING');
    try {
      const result = await this.otaService.checkForUpdate();
      await this.emitTransition(envelope.command_id, 'COMPLETED', {
        targetVersion: result.latestVersion,
        details: { available: result.available, notes: result.releaseNotes },
      });
    } catch (err) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async executeDownload(envelope: ControlCommandEnvelope): Promise<void> {
    const version = envelope.target_version;
    if (!version) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: 'target_version is required for OTA_DOWNLOAD',
      });
      return;
    }

    await this.emitTransition(envelope.command_id, 'DOWNLOADING', { targetVersion: version });
    try {
      const result = await this.otaService.downloadUpdate({ version });
      await this.emitTransition(envelope.command_id, 'VERIFIED', {
        targetVersion: version,
        details: { bytes: result.bytes, sha256: result.sha256 },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        targetVersion: version,
        errorMessage: msg,
      });
    }
  }

  private async executeInstall(envelope: ControlCommandEnvelope): Promise<void> {
    const version = envelope.target_version;
    if (!version) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: 'target_version is required for OTA_INSTALL',
      });
      return;
    }

    // Check print safety
    const printStatus = this.getPrintStatus();
    if (printStatus.state === 'PRINTING' || printStatus.queueDepth > 0) {
      this.logger?.info('Printer is active; waiting for idle before installing OTA');
      await this.emitTransition(envelope.command_id, 'WAITING_FOR_IDLE', { targetVersion: version });
    }

    try {
      await this.emitTransition(envelope.command_id, 'INSTALLING', { targetVersion: version });
      const installResult = await this.otaService.installUpdate({ version });

      if (installResult.deferred) {
        await this.emitTransition(envelope.command_id, 'WAITING_FOR_IDLE', { targetVersion: version });
        return;
      }

      await this.emitTransition(envelope.command_id, 'RESTARTING', { targetVersion: version });
      // When external updater takes over and restarts process, state reconciliation occurs
      // on startup. If this point returns without process exit, complete transition:
      await this.emitTransition(envelope.command_id, 'COMPLETED', { targetVersion: version });
    } catch (err) {
      const status = await this.otaService.getStatus();
      const otaState = status.state.state;
      const msg = err instanceof Error ? err.message : String(err);

      if (otaState === 'ROLLBACK_FAILED') {
        await this.emitTransition(envelope.command_id, 'ROLLBACK_FAILED', {
          targetVersion: version,
          errorMessage: msg,
        });
        await this.emitTransition(envelope.command_id, 'RECOVERY_REQUIRED', {
          targetVersion: version,
          errorMessage: 'Rollback failed; manual recovery required',
        });
      } else if (otaState === 'ROLLED_BACK') {
        await this.emitTransition(envelope.command_id, 'ROLLED_BACK', {
          targetVersion: version,
          errorMessage: msg,
        });
      } else if (otaState === 'HEALTH_CHECK_FAILED') {
        await this.emitTransition(envelope.command_id, 'HEALTH_CHECK_FAILED', {
          targetVersion: version,
          errorMessage: msg,
        });
      } else {
        await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
          targetVersion: version,
          errorMessage: msg,
        });
      }
    }
  }

  private async executeRollback(envelope: ControlCommandEnvelope): Promise<void> {
    await this.emitTransition(envelope.command_id, 'ROLLING_BACK');
    try {
      await this.otaService.rollbackUpdate();
      await this.emitTransition(envelope.command_id, 'ROLLED_BACK');
    } catch (err) {
      const status = await this.otaService.getStatus();
      if (status.state.state === 'ROLLBACK_FAILED') {
        await this.emitTransition(envelope.command_id, 'ROLLBACK_FAILED', {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        await this.emitTransition(envelope.command_id, 'RECOVERY_REQUIRED', {
          errorMessage: 'Rollback failed. Manual recovery required.',
        });
      } else {
        await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async buildHeartbeat(): Promise<DeviceHeartbeatPayload> {
    const printStatus = this.getPrintStatus();
    const otaStatus = await this.otaService.getStatus();

    return {
      deviceId: this.identity.deviceId,
      installationId: this.identity.installationId,
      siteId: this.identity.siteId,
      hostname: this.identity.hostname,
      platform: this.identity.platform,
      architecture: this.identity.architecture,
      appVersion: this.identity.appVersion,
      schemaVersion: this.identity.schemaVersion,
      runnerVersion: this.identity.runnerVersion,
      runnerStatus: 'RUNNING',
      printReadinessSummary: printStatus.readiness,
      printState: printStatus.state,
      otaState: otaStatus.state.state,
      lastOtaOperation: otaStatus.state.targetVersion,
      timestamp: new Date().toISOString(),
    };
  }

  async publishHeartbeat(): Promise<void> {
    if (!this.heartbeatPublisher) return;
    try {
      const heartbeat = await this.buildHeartbeat();
      const subject = `printops.control.heartbeat.${this.identity.deviceId}`;
      await this.heartbeatPublisher(subject, heartbeat);
    } catch (err) {
      this.logger?.warn('Failed to publish device heartbeat', err);
    }
  }

  startHeartbeat(intervalMs = 10_000): void {
    this.stopHeartbeat();
    void this.publishHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      void this.publishHeartbeat();
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }
}
