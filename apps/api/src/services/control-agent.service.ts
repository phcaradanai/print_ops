import type {
  ControlCommandEnvelope,
  ControlOtaTransitionEvent,
  DeviceHeartbeatPayload,
  DevicePrintState,
  OtaTransitionState,
  UpdateState,
} from '@printerops/domain';
import { BLOCKING_RECOVERY_STATES } from '@printerops/domain';
import { AppError, generateId } from '@printerops/shared';
import type { DeviceIdentityStore } from './device-identity.js';
import type {
  DownloadUpdateResult,
  OtaUpdateServicePort,
  UpdateCheckResult,
} from './ota-update.service.js';

const CONTROL_INSTALL_RETRY_DELAY_MS = 1_000;
function localTerminalTransition(state: UpdateState): OtaTransitionState | undefined {
  switch (state) {
    case 'COMPLETED': return 'COMPLETED';
    case 'ROLLED_BACK': return 'ROLLED_BACK';
    case 'HEALTH_CHECK_FAILED': return 'HEALTH_CHECK_FAILED';
    case 'INSTALL_FAILED': return 'INSTALL_FAILED';
    case 'ROLLBACK_FAILED': return 'RECOVERY_REQUIRED';
    default: return undefined;
  }
}

function localInFlightTransition(state: UpdateState): OtaTransitionState | undefined {
  switch (state) {
    case 'WAITING_FOR_IDLE': return 'WAITING_FOR_IDLE';
    case 'INSTALLING':
    case 'INSTALLING_COMPLETE':
    case 'HEALTH_CHECK': return 'INSTALLING';
    case 'RESTART_PENDING': return 'RESTARTING';
    case 'ROLLING_BACK': return 'ROLLING_BACK';
    default: return undefined;
  }
}

function updaterStateUpdatedAfter(
  status: Awaited<ReturnType<OtaUpdateServicePort['getStatus']>>,
  timestamp: string | undefined,
): boolean {
  const since = timestamp ? Date.parse(timestamp) : Number.NaN;
  const updatedAt = status.state.updatedAt.getTime();
  return Number.isFinite(since) && Number.isFinite(updatedAt) && updatedAt > since;
}

class ControlEventDeliveryError extends Error {
  constructor(eventId: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to publish control event ${eventId}: ${reason}`);
    this.name = 'ControlEventDeliveryError';
  }
}
export type EventPublisher = (
  subject: string,
  event: ControlOtaTransitionEvent,
) => Promise<void>;

export type HeartbeatPublisher = (
  subject: string,
  heartbeat: DeviceHeartbeatPayload,
) => Promise<void>;
export interface ControlAgentPrintStatus {
  state: DevicePrintState;
  queueDepth: number;
  readiness: string;
}

export type ControlAgentPrintStatusProvider = () =>
  | ControlAgentPrintStatus
  | Promise<ControlAgentPrintStatus>;

export interface ControlAgentDeps {
  identityStore: DeviceIdentityStore;
  otaService: OtaUpdateServicePort;
  eventPublisher?: EventPublisher;
  heartbeatPublisher?: HeartbeatPublisher;
  getPrintStatus?: ControlAgentPrintStatusProvider;
  logger?: { info: (msg: string, ...args: unknown[]) => void; error: (msg: string, ...args: unknown[]) => void; warn: (msg: string, ...args: unknown[]) => void };
}

export class PrintOpsControlAgent {
  private readonly identityStore: DeviceIdentityStore;
  private readonly otaService: OtaUpdateServicePort;
  private readonly eventPublisher?: EventPublisher;
  private readonly heartbeatPublisher?: HeartbeatPublisher;
  private readonly getPrintStatus: ControlAgentPrintStatusProvider;
  private readonly logger?: ControlAgentDeps['logger'];
  private heartbeatInterval?: NodeJS.Timeout;
  private isProcessingCommand = false;
  private startupReconciliation: Promise<void>;

  constructor(deps: ControlAgentDeps) {
    this.identityStore = deps.identityStore;
    this.otaService = deps.otaService;
    this.eventPublisher = deps.eventPublisher;
    this.heartbeatPublisher = deps.heartbeatPublisher;
    this.getPrintStatus = deps.getPrintStatus ?? (() => ({ state: 'IDLE', queueDepth: 0, readiness: 'READY' }));
    this.logger = deps.logger;
    this.startupReconciliation = this.reconcileStartupState();
    void this.startupReconciliation.catch((err) => {
      this.logger?.error('Failed to reconcile persisted OTA command state', err);
    });
  }

  get identity() {
    return this.identityStore.getIdentity();
  }

  async emitTransition(
    commandId: string | undefined,
    state: OtaTransitionState,
    opts: {
      targetVersion?: string;
      errorMessage?: string;
      details?: Record<string, unknown>;
      localOtaState?: string;
      command?: {
        idempotencyKey?: string;
        commandType?: ControlCommandEnvelope['type'];
        targetVersion?: string;
      };
    } = {},
  ): Promise<void> {
    const otaStatus = await this.otaService.getStatus();
    const event: ControlOtaTransitionEvent = {
      eventId: `evt_${generateId()}`,
      deviceId: this.identity.deviceId,
      commandId,
      state,
      targetVersion: opts.targetVersion,
      currentVersion: otaStatus.currentVersion,
      errorMessage: opts.errorMessage,
      details: opts.details,
      timestamp: new Date().toISOString(),
    };

    this.identityStore.persistControlTransitions([event], {
      ...opts.command,
      targetVersion: opts.targetVersion ?? opts.command?.targetVersion,
      localOtaState: opts.localOtaState,
    });
    await this.flushPendingTransitions();
  }

  private async flushPendingTransitions(): Promise<void> {
    if (!this.eventPublisher) return;
    for (const event of this.identityStore.getPendingControlEvents()) {
      const subject = `printops.control.event.${event.deviceId}`;
      try {
        await this.eventPublisher(subject, event);
      } catch (err) {
        this.logger?.error('Failed to publish OTA transition event', err);
        throw new ControlEventDeliveryError(event.eventId, err);
      }
      try {
        this.identityStore.acknowledgeControlEvent(event.eventId);
      } catch (err) {
        throw new ControlEventDeliveryError(event.eventId, err);
      }
    }
  }

  private async reconcileStartupState(): Promise<void> {
    await this.flushPendingTransitions();
    const command = this.identityStore.getCurrentControlCommand();
    if (!command || command.commandType !== 'OTA_INSTALL' || !command.targetVersion) return;
    const recoveryGate = command.lastAuthoritativeOtaState === 'RECOVERY_REQUIRED';
    if (!recoveryGate && (command.replayStatus !== 'PROCESSING' || !command.executionStarted)) return;

    const status = await this.otaService.getStatus();
    const localState = status.state.state;
    const targetMatches = status.state.targetVersion === command.targetVersion;
    const terminalState = localTerminalTransition(localState);

    if (command.lastAuthoritativeOtaState === 'RECOVERY_REQUIRED') {
      if (targetMatches
        && terminalState
        && terminalState !== 'RECOVERY_REQUIRED'
        && updaterStateUpdatedAfter(status, command.lastAuthoritativeOtaAt)) {
        await this.emitTransition(command.commandId, terminalState, {
          targetVersion: command.targetVersion,
          localOtaState: localState,
          errorMessage: status.state.errorMessage ?? undefined,
          details: { otaState: localState, reconciledAfterRecoveryRequired: true },
        });
      }
      return;
    }

    if (command.replayStatus !== 'PROCESSING' || !command.executionStarted) return;

    if (!targetMatches || !updaterStateUpdatedAfter(status, command.executionStartedAt)) {
      const reason = !targetMatches
        ? `Local OTA target ${status.state.targetVersion ?? 'none'} does not match command target ${command.targetVersion}`
        : 'No local updater state proves this install command reached a recoverable operation';
      await this.emitTransition(command.commandId, 'RECOVERY_REQUIRED', {
        targetVersion: command.targetVersion,
        localOtaState: localState,
        errorMessage: reason,
        details: {
          reason: 'AMBIGUOUS_INSTALL_RECOVERY',
          updaterState: localState,
          updaterTargetVersion: status.state.targetVersion,
        },
      });
      return;
    }

    if (terminalState) {
      await this.emitTransition(command.commandId, terminalState, {
        targetVersion: command.targetVersion,
        localOtaState: localState,
        errorMessage: status.state.errorMessage ?? undefined,
        ...(localState === 'ROLLBACK_FAILED'
          ? { details: { otaState: localState, recoveryRequired: true } }
          : { details: { otaState: localState } }),
      });
      return;
    }

    const inFlightState = localInFlightTransition(localState);
    if (inFlightState) {
      if (localState === 'WAITING_FOR_IDLE') {
        if (command.lastAuthoritativeOtaState !== inFlightState
          || command.lastLocalOtaState !== localState) {
          await this.emitTransition(command.commandId, inFlightState, {
            targetVersion: command.targetVersion,
            localOtaState: localState,
            details: { updaterState: localState, reconciledInFlight: true },
          });
        }
        this.identityStore.resumeDeferredControlCommand(command.commandId);
        return;
      }
      if (command.lastAuthoritativeOtaState !== inFlightState
        || command.lastLocalOtaState !== localState) {
        await this.emitTransition(command.commandId, inFlightState, {
          targetVersion: command.targetVersion,
          localOtaState: localState,
          details: { updaterState: localState, reconciledInFlight: true },
        });
      }
      return;
    }

    await this.emitTransition(command.commandId, 'RECOVERY_REQUIRED', {
      targetVersion: command.targetVersion,
      localOtaState: localState,
      errorMessage: `Local OTA state ${localState} does not prove a recoverable install outcome`,
      details: {
        reason: 'AMBIGUOUS_INSTALL_RECOVERY',
        updaterState: localState,
        updaterTargetVersion: status.state.targetVersion,
      },
    });
  }

  private async ensureStartupReconciled(): Promise<void> {
    if (this.isProcessingCommand) return;
    try {
      await this.startupReconciliation;
    } catch {
      this.startupReconciliation = this.reconcileStartupState();
      void this.startupReconciliation.catch((err) => {
        this.logger?.error('Failed to reconcile persisted OTA command state', err);
      });
      await this.startupReconciliation;
      return;
    }
    await this.reconcileStartupState();
  }
  private async startPersistedCommand(
    envelope: ControlCommandEnvelope,
    waitForCompletion: boolean,
  ): Promise<void> {
    if (waitForCompletion) {
      await this.executeCommand(envelope);
    } else {
      void this.executeCommand(envelope).catch((err) => {
        this.logger?.error('Error executing control command', err);
      });
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

    await this.ensureStartupReconciled();

    const recoveryCommand = this.identityStore.getCurrentControlCommand();
    if (recoveryCommand?.lastAuthoritativeOtaState === 'RECOVERY_REQUIRED') {
      const existing = this.identityStore.getControlCommand(envelope.command_id, envelope.idempotency_key);
      if (existing?.commandId === envelope.command_id
        && existing.lastAuthoritativeOtaState === 'RECOVERY_REQUIRED') {
        return { accepted: false, reason: 'RECOVERY_REQUIRED' };
      }
      await this.emitTransition(envelope.command_id, 'RECOVERY_REQUIRED', {
        targetVersion: envelope.target_version,
        errorMessage: 'A previous OTA command requires local recovery; remote commands remain blocked.',
        details: { reason: 'DEVICE_RECOVERY_REQUIRED', blockedByCommandId: recoveryCommand.commandId },
        command: {
          idempotencyKey: envelope.idempotency_key,
          commandType: envelope.type,
          targetVersion: envelope.target_version,
        },
      });
      return { accepted: false, reason: 'RECOVERY_REQUIRED' };
    }

    // Persisted command/idempotency identity suppresses replays across restarts.
    const processedCommand = this.identityStore.getControlCommand(
      envelope.command_id,
      envelope.idempotency_key,
    );
    if (processedCommand) {
      await this.flushPendingTransitions();
      const replay = this.identityStore.getControlCommand(
        envelope.command_id,
        envelope.idempotency_key,
      );
      if (replay?.commandId === envelope.command_id
        && replay.replayStatus === 'PROCESSING'
        && !replay.executionStarted
        && replay.lastAuthoritativeOtaState !== 'RESTARTING'
        && replay.lastLocalOtaState !== 'RESTART_PENDING'
        && !this.isProcessingCommand) {
        const expiresAt = new Date(envelope.expires_at).getTime();
        if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
          await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
            targetVersion: envelope.target_version,
            errorMessage: 'Command expired before execution could resume',
            command: {
              idempotencyKey: envelope.idempotency_key,
              commandType: envelope.type,
              targetVersion: envelope.target_version,
            },
          });
          return { accepted: false, reason: 'COMMAND_EXPIRED' };
        }
        this.logger?.info(`Resuming command ${envelope.command_id} after its persisted acceptance was delivered`);
        this.isProcessingCommand = true;
        await this.startPersistedCommand(envelope, opts.waitForCompletion ?? false);
        return { accepted: true };
      }
      this.logger?.info(`Command ${envelope.command_id} already processed, skipping duplicate`);
      return { accepted: true, reason: 'DUPLICATE_ALREADY_PROCESSED' };
    }

    // 2. Command expiration check
    const expiresAt = new Date(envelope.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      this.logger?.warn(`Command ${envelope.command_id} has expired or an invalid expiry`);
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        targetVersion: envelope.target_version,
        errorMessage: 'Command expired before execution',
        command: {
          idempotencyKey: envelope.idempotency_key,
          commandType: envelope.type,
          targetVersion: envelope.target_version,
        },
      });
      return { accepted: false, reason: 'COMMAND_EXPIRED' };
    }

    // 3. Check for blocking recovery states
    const currentOtaStatus = await this.otaService.getStatus();
    if (BLOCKING_RECOVERY_STATES[currentOtaStatus.state.state]) {
      const reason = `Device in ${currentOtaStatus.state.state}; remote commands are blocked until resolved locally.`;
      this.logger?.error(reason);
      await this.emitTransition(envelope.command_id, 'RECOVERY_REQUIRED', {
        targetVersion: envelope.target_version,
        errorMessage: reason,
        command: {
          idempotencyKey: envelope.idempotency_key,
          commandType: envelope.type,
          targetVersion: envelope.target_version,
        },
      });
      return { accepted: false, reason: 'RECOVERY_REQUIRED' };
    }

    const inFlightInstall = this.identityStore.getCurrentControlCommand();
    if (inFlightInstall?.commandType === 'OTA_INSTALL'
      && inFlightInstall.replayStatus === 'PROCESSING'
      && inFlightInstall.targetVersion === currentOtaStatus.state.targetVersion
      && localInFlightTransition(currentOtaStatus.state.state)) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        targetVersion: envelope.target_version,
        errorMessage: 'Another OTA install remains in progress on the local updater.',
        details: { reason: 'DEVICE_BUSY', activeCommandId: inFlightInstall.commandId },
        command: {
          idempotencyKey: envelope.idempotency_key,
          commandType: envelope.type,
          targetVersion: envelope.target_version,
        },
      });
      return { accepted: false, reason: 'DEVICE_BUSY' };
    }

    if (this.isProcessingCommand) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        targetVersion: envelope.target_version,
        errorMessage: 'Another remote OTA command is already in progress',
        command: {
          idempotencyKey: envelope.idempotency_key,
          commandType: envelope.type,
          targetVersion: envelope.target_version,
        },
      });
      return { accepted: false, reason: 'DEVICE_BUSY' };
    }
    this.isProcessingCommand = true;
    try {
      await this.emitTransition(envelope.command_id, 'ACCEPTED', {
        targetVersion: envelope.target_version,
        command: {
          idempotencyKey: envelope.idempotency_key,
          commandType: envelope.type,
          targetVersion: envelope.target_version,
        },
      });
      await this.startPersistedCommand(envelope, opts.waitForCompletion ?? false);
    } catch (err) {
      this.isProcessingCommand = false;
      throw err;
    }

    return { accepted: true };
  }

  private async executeCommand(envelope: ControlCommandEnvelope): Promise<void> {
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
      throw err;
    } finally {
      this.isProcessingCommand = false;
    }
  }

  private async executeCheck(envelope: ControlCommandEnvelope): Promise<void> {
    if (this.identityStore.getControlCommand(envelope.command_id)?.lastAuthoritativeOtaState !== 'CHECKING') {
      await this.emitTransition(envelope.command_id, 'CHECKING');
    }
    let result: UpdateCheckResult;
    try {
      this.identityStore.markControlCommandStarted(envelope.command_id);
      result = await this.otaService.checkForUpdate();
    } catch (err) {
      if (err instanceof ControlEventDeliveryError) throw err;
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    await this.emitTransition(envelope.command_id, 'COMPLETED', {
      targetVersion: result.latestVersion,
      details: { available: result.available, notes: result.releaseNotes },
    });
  }

  private async executeDownload(envelope: ControlCommandEnvelope): Promise<void> {
    const version = envelope.target_version;
    if (!version) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: 'target_version is required for OTA_DOWNLOAD',
      });
      return;
    }

    if (this.identityStore.getControlCommand(envelope.command_id)?.lastAuthoritativeOtaState !== 'DOWNLOADING') {
      await this.emitTransition(envelope.command_id, 'DOWNLOADING', { targetVersion: version });
    }
    let result: DownloadUpdateResult;
    try {
      this.identityStore.markControlCommandStarted(envelope.command_id);
      result = await this.otaService.downloadUpdate({ version });
    } catch (err) {
      if (err instanceof ControlEventDeliveryError) throw err;
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        targetVersion: version,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    await this.emitTransition(envelope.command_id, 'VERIFIED', {
      targetVersion: version,
      details: { bytes: result.bytes, sha256: result.sha256 },
    });
  }

  private async executeInstall(envelope: ControlCommandEnvelope): Promise<void> {
    const version = envelope.target_version;
    if (!version) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: 'target_version is required for OTA_INSTALL',
      });
      return;
    }

    let progressDeliveryFailed = false;
    let progressDeliveryError: unknown;
    try {
      const persistedCommand = this.identityStore.getControlCommand(envelope.command_id);
      let lastReportedState: string | undefined =
        persistedCommand?.lastLocalOtaState === 'WAITING_FOR_IDLE' ? 'WAITING_FOR_IDLE' : undefined;
      const commandExpiresAt = new Date(envelope.expires_at).getTime();
      const component = 'desktop';
      const platform = 'windows-x64';
      const status = await this.otaService.getStatus();
      const stagedArtifact = status.stagedArtifact;
      const lastState = persistedCommand?.lastAuthoritativeOtaState;
      if (stagedArtifact?.version === version
        && stagedArtifact.component === component
        && stagedArtifact.platform === platform) {
        if (lastState !== 'VERIFIED' && lastState !== 'WAITING_FOR_IDLE') {
          await this.emitTransition(envelope.command_id, 'VERIFIED', {
            targetVersion: version,
            localOtaState: 'VERIFIED',
            details: { alreadyStaged: true },
          });
        }
      } else {
        if (lastState !== 'CHECKING' && lastState !== 'DOWNLOADING') {
          await this.emitTransition(envelope.command_id, 'CHECKING', { targetVersion: version });
        }
        if (lastState !== 'DOWNLOADING') {
          await this.emitTransition(envelope.command_id, 'DOWNLOADING', { targetVersion: version });
        }
        const downloadResult = await this.otaService.downloadUpdate({ version });
        if (downloadResult.version !== version
          || downloadResult.component !== component
          || downloadResult.platform !== platform) {
          throw new AppError(
            'OTA_ARTIFACT_MISMATCH',
            `Downloaded OTA artifact does not match ${component}/${platform} ${version}`,
            409,
          );
        }
        await this.emitTransition(envelope.command_id, 'VERIFIED', {
          targetVersion: version,
          localOtaState: 'VERIFIED',
          details: { bytes: downloadResult.bytes, sha256: downloadResult.sha256 },
        });
      }

      for (;;) {
        if (Date.now() >= commandExpiresAt) {
          throw new AppError('OTA_COMMAND_EXPIRED', 'Command expired before the printer became idle', 409);
        }

        this.identityStore.markControlCommandStarted(envelope.command_id);
        const installResult = await this.otaService.installUpdate({
          version,
          mode: 'automatic',
          onProgress: async (state) => {
            if (state === lastReportedState) return;
            lastReportedState = state;
            const controlState = state === 'RESTART_PENDING' ? 'RESTARTING' : state;
            try {
              await this.emitTransition(envelope.command_id, controlState, {
                targetVersion: version,
                localOtaState: state,
              });
            } catch (err) {
              if (!(err instanceof ControlEventDeliveryError)) throw err;
              progressDeliveryFailed = true;
              progressDeliveryError = err;
            }
          },
        });
        if (progressDeliveryFailed) throw progressDeliveryError;

        if (installResult.deferred || installResult.state === 'WAITING_FOR_IDLE') {
          await new Promise<void>((resolve) => setTimeout(resolve, CONTROL_INSTALL_RETRY_DELAY_MS));
          continue;
        }

        if (installResult.state === 'RESTART_PENDING') {
          if (lastReportedState !== 'RESTART_PENDING') {
            await this.emitTransition(envelope.command_id, 'RESTARTING', {
              targetVersion: version,
              localOtaState: 'RESTART_PENDING',
            });
          }
          return;
        }
        if (installResult.state === 'ROLLED_BACK') {
          await this.emitTransition(envelope.command_id, 'ROLLED_BACK', {
            targetVersion: version,
            localOtaState: 'ROLLED_BACK',
          });
          return;
        }
        await this.emitTransition(envelope.command_id, 'COMPLETED', {
          targetVersion: version,
          localOtaState: 'COMPLETED',
        });
        return;
      }
    } catch (err) {
      if (progressDeliveryFailed) throw progressDeliveryError;
      if (err instanceof ControlEventDeliveryError) throw err;
      const status = await this.otaService.getStatus();
      const otaState = status.state.state;
      const msg = err instanceof Error ? err.message : String(err);

      if (otaState === 'ROLLBACK_FAILED') {
        await this.emitTransition(envelope.command_id, 'ROLLBACK_FAILED', {
          targetVersion: version,
          localOtaState: otaState,
          errorMessage: msg,
        });
        await this.emitTransition(envelope.command_id, 'RECOVERY_REQUIRED', {
          targetVersion: version,
          localOtaState: otaState,
          errorMessage: 'Rollback failed; manual recovery required',
        });
      } else if (otaState === 'ROLLED_BACK') {
        await this.emitTransition(envelope.command_id, 'ROLLED_BACK', {
          targetVersion: version,
          localOtaState: otaState,
          errorMessage: msg,
        });
      } else if (otaState === 'HEALTH_CHECK_FAILED') {
        await this.emitTransition(envelope.command_id, 'HEALTH_CHECK_FAILED', {
          targetVersion: version,
          localOtaState: otaState,
          errorMessage: msg,
        });
      } else {
        await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
          targetVersion: version,
          localOtaState: otaState,
          errorMessage: msg,
        });
      }
    }
  }

  private async executeRollback(envelope: ControlCommandEnvelope): Promise<void> {
    if (this.identityStore.getControlCommand(envelope.command_id)?.lastAuthoritativeOtaState !== 'ROLLING_BACK') {
      await this.emitTransition(envelope.command_id, 'ROLLING_BACK');
    }
    try {
      this.identityStore.markControlCommandStarted(envelope.command_id);
      await this.otaService.rollbackUpdate();
    } catch (err) {
      if (err instanceof ControlEventDeliveryError) throw err;
      const status = await this.otaService.getStatus();
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (status.state.state === 'ROLLBACK_FAILED') {
        await this.emitTransition(envelope.command_id, 'ROLLBACK_FAILED', {
          errorMessage,
          localOtaState: status.state.state,
        });
        await this.emitTransition(envelope.command_id, 'RECOVERY_REQUIRED', {
          errorMessage: 'Rollback failed. Manual recovery required.',
          localOtaState: status.state.state,
        });
      } else {
        await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
          errorMessage,
          localOtaState: status.state.state,
        });
      }
      return;
    }

    await this.emitTransition(envelope.command_id, 'ROLLED_BACK', {
      localOtaState: 'ROLLED_BACK',
    });
  }

  async buildHeartbeat(): Promise<DeviceHeartbeatPayload> {
    const printStatus = await this.getPrintStatus();
    const otaStatus = await this.otaService.getStatus();

    return {
      deviceId: this.identity.deviceId,
      installationId: this.identity.installationId,
      siteId: this.identity.siteId,
      hostname: this.identity.hostname,
      platform: this.identity.platform,
      architecture: this.identity.architecture,
      appVersion: otaStatus.currentVersion,
      schemaVersion: otaStatus.currentSchemaVersion,
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
      await this.ensureStartupReconciled();
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
