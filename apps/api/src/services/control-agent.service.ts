import type {
  ControlCommandProgress,
  ControlContentBundle,
  ControlCommandEnvelope,
  ControlOtaTransitionEvent,
  ControlContentIndex,
  ControlContentKind,
  DeviceHeartbeatPayload,
  DevicePrintState,
  OtaTransitionState,
  UpdateState,
} from '@printerops/domain';
import { BLOCKING_RECOVERY_STATES } from '@printerops/domain';
import { AppError, generateId } from '@printerops/shared';
import type { ControlContentSyncResult } from './control-content-sync.service.js';
import type { DeviceIdentityStore } from './device-identity.js';
import type {
  DownloadUpdateResult,
  OtaArtifactDownloadProgress,
  OtaUpdateServicePort,
  UpdateCheckResult,
} from './ota-update.service.js';

const CONTROL_INSTALL_RETRY_DELAY_MS = 1_000;
function isContentCommand(type: ControlCommandEnvelope['type']): boolean {
  return type === 'CONTENT_SYNC' || type === 'CONTENT_LIST' || type === 'CONTENT_PULL';
}

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

function stepProgress(
  phase: ControlCommandProgress['phase'],
  current: number,
  total: number,
  item?: string,
): ControlCommandProgress {
  return {
    current,
    total,
    percent: total > 0 ? Math.floor((current / total) * 100) : 100,
    mode: 'steps',
    phase,
    ...(item ? { item } : {}),
  };
}

function commandProgress(
  type: ControlCommandEnvelope['type'] | undefined,
  state: OtaTransitionState,
  item?: string,
): ControlCommandProgress | undefined {
  switch (type) {
    case 'OTA_CHECK':
      if (state === 'ACCEPTED') return stepProgress('queued', 0, 1, item);
      if (state === 'CHECKING') return stepProgress('checking', 0, 1, item);
      if (state === 'COMPLETED') return stepProgress('completed', 1, 1, item);
      return undefined;
    case 'OTA_DOWNLOAD':
      if (state === 'ACCEPTED') return stepProgress('queued', 0, 1, item);
      if (state === 'DOWNLOADING') return stepProgress('downloading', 0, 1, item);
      if (state === 'VERIFIED' || state === 'COMPLETED') return stepProgress('completed', 1, 1, item);
      return undefined;
    case 'OTA_INSTALL':
      if (state === 'ACCEPTED') return stepProgress('queued', 0, 4, item);
      if (state === 'CHECKING') return stepProgress('checking', 0, 4, item);
      if (state === 'DOWNLOADING') return stepProgress('downloading', 1, 4, item);
      if (state === 'VERIFIED') return stepProgress('verifying', 2, 4, item);
      if (state === 'WAITING_FOR_IDLE') return stepProgress('waiting-for-idle', 2, 4, item);
      if (state === 'INSTALLING') return stepProgress('installing', 3, 4, item);
      if (state === 'RESTARTING') return stepProgress('restarting', 3, 4, item);
      if (state === 'COMPLETED') return stepProgress('completed', 4, 4, item);
      return undefined;
    case 'OTA_ROLLBACK':
      if (state === 'ACCEPTED') return stepProgress('queued', 0, 2, item);
      if (state === 'ROLLING_BACK') return stepProgress('rolling-back', 0, 2, item);
      if (state === 'RESTARTING') return stepProgress('restarting', 1, 2, item);
      if (state === 'ROLLED_BACK' || state === 'COMPLETED') return stepProgress('completed', 2, 2, item);
      return undefined;
    case 'CONTENT_SYNC':
      if (state === 'ACCEPTED') return stepProgress('syncing-content', 0, 1, item);
      if (state === 'COMPLETED') return stepProgress('completed', 1, 1, item);
      return undefined;
    case 'CONTENT_LIST':
      if (state === 'ACCEPTED') return stepProgress('listing-content', 0, 1, item);
      if (state === 'COMPLETED') return stepProgress('completed', 1, 1, item);
      return undefined;
    case 'CONTENT_PULL':
      if (state === 'ACCEPTED') return stepProgress('pulling-content', 0, 1, item);
      if (state === 'COMPLETED') return stepProgress('completed', 1, 1, item);
      return undefined;
    default:
      return undefined;
  }
}

function initialCommandProgress(envelope: ControlCommandEnvelope): ControlCommandProgress | undefined {
  if (envelope.type === 'CONTENT_PULL') {
    return stepProgress('pulling-content', 0, 1, envelope.content_key);
  }
  if (envelope.type === 'CONTENT_SYNC') {
    return stepProgress('syncing-content', 0, 1, envelope.content_key);
  }
  return commandProgress(envelope.type, 'ACCEPTED', envelope.target_version);
}

function downloadProgress(
  type: ControlCommandEnvelope['type'],
  version: string,
  progress: OtaArtifactDownloadProgress,
): ControlCommandProgress {
  const totalBytes = Math.max(1, progress.totalBytes);
  const currentBytes = Math.min(progress.downloadedBytes, totalBytes);
  if (type === 'OTA_DOWNLOAD') {
    return {
      current: currentBytes,
      total: totalBytes,
      percent: Math.min(100, Math.floor((currentBytes / totalBytes) * 100)),
      mode: 'bytes',
      phase: 'downloading',
      item: version,
    };
  }
  const stage = commandProgress(type, 'DOWNLOADING', version)!;
  return {
    ...stage,
    transfer: { currentBytes, totalBytes },
  };
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
  onHeartbeatAcknowledged?: () => void | Promise<void>;
  getPrintStatus?: ControlAgentPrintStatusProvider;
  getDeviceInfo?: () => Promise<{
    hostname?: string;
    installationPath?: string;
    dataPath?: string;
    osVersion?: string;
    ipAddresses?: string[];
    capabilities?: string[];
  } | undefined>;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  applyContentBundle?: (
    bundle: ControlContentBundle,
    onProgress?: (progress: ControlCommandProgress) => void | Promise<void>,
  ) => Promise<ControlContentSyncResult>;
  getClientContentIndex?: () => Promise<ControlContentIndex>;
  exportClientContent?: (kind: ControlContentKind, code: string) => Promise<ControlContentBundle>;
}

export class PrintOpsControlAgent {
  private readonly identityStore: DeviceIdentityStore;
  private readonly otaService: OtaUpdateServicePort;
  private readonly eventPublisher?: EventPublisher;
  private readonly heartbeatPublisher?: HeartbeatPublisher;
  private readonly onHeartbeatAcknowledged?: ControlAgentDeps['onHeartbeatAcknowledged'];
  private readonly getPrintStatus: ControlAgentPrintStatusProvider;
  private readonly getDeviceInfo?: ControlAgentDeps['getDeviceInfo'];
  private readonly applyContentBundle?: ControlAgentDeps['applyContentBundle'];
  private readonly getClientContentIndex?: ControlAgentDeps['getClientContentIndex'];
  private readonly exportClientContent?: ControlAgentDeps['exportClientContent'];
  private readonly logger?: ControlAgentDeps['logger'];
  private heartbeatInterval?: NodeJS.Timeout;
  private isProcessingCommand = false;
  private startupReconciliation: Promise<void>;

  constructor(deps: ControlAgentDeps) {
    this.identityStore = deps.identityStore;
    this.otaService = deps.otaService;
    this.eventPublisher = deps.eventPublisher;
    this.heartbeatPublisher = deps.heartbeatPublisher;
    this.onHeartbeatAcknowledged = deps.onHeartbeatAcknowledged;
    this.getPrintStatus = deps.getPrintStatus ?? (() => ({ state: 'IDLE', queueDepth: 0, readiness: 'READY' }));
    this.getDeviceInfo = deps.getDeviceInfo;
    this.applyContentBundle = deps.applyContentBundle;
    this.getClientContentIndex = deps.getClientContentIndex;
    this.exportClientContent = deps.exportClientContent;
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
      progress?: ControlCommandProgress;
      localOtaState?: string;
      command?: {
        idempotencyKey?: string;
        commandType?: ControlCommandEnvelope['type'];
        targetVersion?: string;
      };
    } = {},
  ): Promise<void> {
    const otaStatus = await this.otaService.getStatus();
    const existing = commandId ? this.identityStore.getControlCommand(commandId) : undefined;
    const progress = opts.progress ?? commandProgress(
      opts.command?.commandType ?? existing?.commandType,
      state,
      opts.targetVersion ?? existing?.targetVersion,
    );
    const event: ControlOtaTransitionEvent = {
      eventId: `evt_${generateId()}`,
      deviceId: this.identity.deviceId,
      commandId,
      state,
      targetVersion: opts.targetVersion,
      currentVersion: otaStatus.currentVersion,
      ...(progress ? { progress } : {}),
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
    if (command?.commandType === 'OTA_ROLLBACK'
      && command.replayStatus === 'PROCESSING'
      && command.executionStarted) {
      const status = await this.otaService.getStatus();
      const localState = status.state.state;
      const hasNewOutcome = updaterStateUpdatedAfter(status, command.executionStartedAt);
      if (hasNewOutcome && localState === 'ROLLED_BACK') {
        await this.emitTransition(command.commandId, 'ROLLED_BACK', { localOtaState: localState });
      } else if (hasNewOutcome && localState === 'ROLLBACK_FAILED') {
        await this.emitTransition(command.commandId, 'RECOVERY_REQUIRED', {
          localOtaState: localState,
          errorMessage: status.state.errorMessage ?? 'Rollback failed; manual recovery required',
        });
      } else if (hasNewOutcome && (localState === 'RESTART_PENDING' || localState === 'ROLLING_BACK')) {
        const transition = localState === 'RESTART_PENDING' ? 'RESTARTING' : 'ROLLING_BACK';
        if (command.lastAuthoritativeOtaState !== transition) {
          await this.emitTransition(command.commandId, transition, { localOtaState: localState });
        }
      } else {
        await this.emitTransition(command.commandId, 'RECOVERY_REQUIRED', {
          localOtaState: localState,
          errorMessage: `Local OTA state ${localState} does not prove a completed rollback`,
          details: { reason: 'AMBIGUOUS_ROLLBACK_RECOVERY' },
        });
      }
      return;
    }
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
    if (!isContentCommand(envelope.type) && recoveryCommand?.lastAuthoritativeOtaState === 'RECOVERY_REQUIRED') {
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
    if (!isContentCommand(envelope.type) && BLOCKING_RECOVERY_STATES[currentOtaStatus.state.state]) {
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
        progress: initialCommandProgress(envelope),
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
        case 'CONTENT_SYNC':
          await this.executeContentSync(envelope);
          break;
        case 'CONTENT_LIST':
          await this.executeContentList(envelope);
          break;
        case 'CONTENT_PULL':
          await this.executeContentPull(envelope);
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
      result = await this.otaService.checkForUpdate(envelope.manifest_url);
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
    let progressDeliveryFailed = false;
    let result: DownloadUpdateResult;
    try {
      this.identityStore.markControlCommandStarted(envelope.command_id);
      result = await this.otaService.downloadUpdate({
        version,
        manifestUrl: envelope.manifest_url,
        onProgress: async (progress) => {
          if (progressDeliveryFailed) return;
          try {
            await this.emitTransition(envelope.command_id, 'DOWNLOADING', {
              targetVersion: version,
              progress: downloadProgress(envelope.type, version, progress),
            });
          } catch (error) {
            if (!(error instanceof ControlEventDeliveryError)) throw error;
            progressDeliveryFailed = true;
            this.logger?.warn('Skipping further OTA download progress events after delivery failed', error);
          }
        },
      });
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
    let downloadProgressDeliveryFailed = false;
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
        const downloadResult = await this.otaService.downloadUpdate({
          version,
          manifestUrl: envelope.manifest_url,
          onProgress: async (progress) => {
            if (downloadProgressDeliveryFailed) return;
            try {
              await this.emitTransition(envelope.command_id, 'DOWNLOADING', {
                targetVersion: version,
                progress: downloadProgress(envelope.type, version, progress),
              });
            } catch (error) {
              if (!(error instanceof ControlEventDeliveryError)) throw error;
              downloadProgressDeliveryFailed = true;
              this.logger?.warn('Skipping further OTA download progress events after delivery failed', error);
            }
          },
        });
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
          manifestUrl: envelope.manifest_url,
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
      const result = await this.otaService.rollbackUpdate();
      if (!result.rolledBack || result.state === 'RESTART_PENDING') {
        await this.emitTransition(envelope.command_id, 'RESTARTING', {
          localOtaState: result.state,
        });
        return;
      }
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

  private async executeContentSync(envelope: ControlCommandEnvelope): Promise<void> {
    const bundle = envelope.content_payload;
    if (!this.applyContentBundle || !bundle
      || envelope.content_type !== bundle.kind
      || envelope.content_key !== bundle.key) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        targetVersion: envelope.target_version,
        errorMessage: 'Content command is missing its authenticated content bundle',
        details: { reason: 'INVALID_CONTENT_COMMAND' },
      });
      return;
    }
    try {
      const result = await this.applyContentBundle(bundle, async (progress) => {
        try {
          await this.emitTransition(envelope.command_id, 'ACCEPTED', {
            targetVersion: envelope.target_version,
            progress,
          });
        } catch (error) {
          if (!(error instanceof ControlEventDeliveryError)) throw error;
          this.logger?.warn('Content update continues after progress event delivery failed', error);
        }
      });
      await this.emitTransition(envelope.command_id, 'COMPLETED', {
        targetVersion: envelope.target_version,
        details: { ...result },
      });
    } catch (error) {
      if (error instanceof ControlEventDeliveryError) throw error;
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        targetVersion: envelope.target_version,
        errorMessage: error instanceof Error ? error.message : String(error),
        details: { kind: bundle.kind, key: bundle.key },
      });
    }
  }

  private async executeContentList(envelope: ControlCommandEnvelope): Promise<void> {
    if (!this.getClientContentIndex) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: 'This PrintOps client does not support content inventory',
        details: { reason: 'CONTENT_INVENTORY_UNAVAILABLE' },
      });
      return;
    }
    try {
      const index = await this.getClientContentIndex();
      await this.emitTransition(envelope.command_id, 'COMPLETED', { details: { index } });
    } catch (error) {
      if (error instanceof ControlEventDeliveryError) throw error;
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: error instanceof Error ? error.message : String(error),
        details: { reason: 'CONTENT_INVENTORY_FAILED' },
      });
    }
  }

  private async executeContentPull(envelope: ControlCommandEnvelope): Promise<void> {
    const kind = envelope.content_type;
    const code = envelope.content_key;
    if (!this.exportClientContent || (kind !== 'paper-profile' && kind !== 'template') || !code) {
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: 'Content pull command is missing a valid content kind or code',
        details: { reason: 'INVALID_CONTENT_PULL_COMMAND' },
      });
      return;
    }
    try {
      const bundle = await this.exportClientContent(kind, code);
      const bundleCode = bundle.kind === 'paper-profile' ? bundle.profile?.code : bundle.template?.templateCode;
      if (bundle.kind !== kind || bundleCode !== code || bundle.overwriteExisting !== false) {
        throw new Error('Client content export did not match the requested item');
      }
      await this.emitTransition(envelope.command_id, 'COMPLETED', { details: { bundle } });
    } catch (error) {
      if (error instanceof ControlEventDeliveryError) throw error;
      await this.emitTransition(envelope.command_id, 'INSTALL_FAILED', {
        errorMessage: error instanceof Error ? error.message : String(error),
        details: { kind, code },
      });
    }
  }

  async buildHeartbeat(): Promise<DeviceHeartbeatPayload> {
    const printStatus = await this.getPrintStatus();
    const otaStatus = await this.otaService.getStatus();
    let deviceInfo: Awaited<ReturnType<NonNullable<ControlAgentDeps['getDeviceInfo']>>> = undefined;
    try {
      deviceInfo = await this.getDeviceInfo?.();
    } catch (error) {
      this.logger?.warn('Failed to read local installation details', error);
    }

    return {
      deviceId: this.identity.deviceId,
      installationId: this.identity.installationId,
      siteId: this.identity.siteId,
      hostname: deviceInfo?.hostname ?? this.identity.hostname,
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
      ...(deviceInfo?.installationPath ? { installationPath: deviceInfo.installationPath } : {}),
      ...(deviceInfo?.dataPath ? { dataPath: deviceInfo.dataPath } : {}),
      ...(deviceInfo?.osVersion ? { osVersion: deviceInfo.osVersion } : {}),
      ...(deviceInfo?.ipAddresses ? { ipAddresses: deviceInfo.ipAddresses } : {}),
      capabilities: deviceInfo?.capabilities ?? ['ota'],
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
      return;
    }

    try {
      await this.onHeartbeatAcknowledged?.();
    } catch (err) {
      this.logger?.warn('Failed to report acknowledged device heartbeat locally', err);
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
