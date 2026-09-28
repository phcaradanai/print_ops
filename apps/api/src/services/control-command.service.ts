import type {
  ControlCommandRecord,
  ControlCommandType,
  ControlCommandEnvelope,
  ControlOtaTransitionEvent,
  CreateControlCommandInput,
  ControlCommandRepositoryPort,
  DeviceRegistryRepositoryPort,
  ControlAuditRepositoryPort,
  OtaTransitionState,
} from '@printerops/domain';
import { BLOCKING_RECOVERY_STATES } from '@printerops/domain';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@printerops/shared';
import { signControlMessage } from './control-message-auth.js';

export type ControlNatsPublisher = (
  subject: string,
  payload: Record<string, unknown>,
  opts?: { msgId?: string; durable?: boolean },
) => Promise<{ acknowledged: boolean }>;

export interface ControlCommandServiceDeps {
  commands: ControlCommandRepositoryPort;
  devices: DeviceRegistryRepositoryPort;
  audit?: ControlAuditRepositoryPort;
  natsPublisher?: ControlNatsPublisher;
  offlineThresholdMs?: number; // default 90s
}
const transitionOrder: Partial<Record<OtaTransitionState, number>> = {
  REQUESTED: 0,
  DELIVERED: 1,
  ACCEPTED: 2,
  CHECKING: 3,
  DOWNLOADING: 4,
  VERIFIED: 5,
  WAITING_FOR_IDLE: 6,
  INSTALLING: 7,
  RESTARTING: 8,
  ROLLING_BACK: 9,
};

const terminalStates: Partial<Record<OtaTransitionState, true>> = {
  COMPLETED: true,
  INSTALL_FAILED: true,
  HEALTH_CHECK_FAILED: true,
  ROLLED_BACK: true,
  ROLLBACK_FAILED: true,
  RECOVERY_REQUIRED: true,
};

export class ControlCommandService {
  private readonly commands: ControlCommandRepositoryPort;
  private readonly devices: DeviceRegistryRepositoryPort;
  private readonly audit?: ControlAuditRepositoryPort;
  private readonly natsPublisher?: ControlNatsPublisher;
  private readonly offlineThresholdMs: number;

  constructor(deps: ControlCommandServiceDeps) {
    this.commands = deps.commands;
    this.devices = deps.devices;
    this.audit = deps.audit;
    this.natsPublisher = deps.natsPublisher;
    this.offlineThresholdMs = deps.offlineThresholdMs ?? 90_000;
  }

  async issueCommand(input: CreateControlCommandInput): Promise<ControlCommandRecord> {
    if (!input.deviceId || input.deviceId.trim().length === 0) {
      throw new ValidationError('deviceId is required');
    }
    if (!input.type) {
      throw new ValidationError('type is required');
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
      throw new ValidationError('idempotencyKey is required');
    }

    const device = await this.devices.findById(input.deviceId);
    if (!device) {
      throw new NotFoundError('Device', input.deviceId);
    }
    if (device.status !== 'ACTIVE') {
      throw new ConflictError(`Device is ${device.status}, cannot receive commands`);
    }

    // Verify device is not offline
    const isOffline =
      device.connectionState === 'OFFLINE' ||
      !device.lastSeenAt ||
      Date.now() - new Date(device.lastSeenAt).getTime() > this.offlineThresholdMs;

    if (isOffline) {
      throw new AppError(
        'DEVICE_OFFLINE',
        `Device ${input.deviceId} is OFFLINE; command cannot be accepted by device`,
        409,
      );
    }

    // Block remote OTA if device is in a recovery-required state
    if (BLOCKING_RECOVERY_STATES[device.otaState]) {
      throw new ConflictError(
        `Device is in ${device.otaState} state. Remote updates are blocked until resolved locally.`,
      );
    }

    // Idempotent retries retry the stable JetStream message ID while PENDING.
    const existing = await this.commands.findByIdempotencyKey(input.deviceId, input.idempotencyKey.trim());
    if (existing) {
      if (existing.status === 'PENDING' && this.natsPublisher) {
        return this.publishPendingCommand(existing, device.deviceTokenHash);
      }
      return existing;
    }

    const command = await this.commands.create(input);
    const result = this.natsPublisher
      ? await this.publishPendingCommand(command, device.deviceTokenHash)
      : command;

    if (this.audit) {
      await this.audit.record({
        actor: input.requestedBy,
        deviceId: input.deviceId,
        commandId: command.commandId,
        action: `control.command_${input.type.toLowerCase()}`,
        sourceVersion: device.appVersion,
        targetVersion: command.targetVersion,
        requestedAt: new Date(),
        metadata: {
          idempotencyKey: command.idempotencyKey,
          expiresAt: command.expiresAt.toISOString(),
        },
      });
    }

    return result;
  }

  private async publishPendingCommand(
    command: ControlCommandRecord,
    deviceTokenHash: string,
  ): Promise<ControlCommandRecord> {
    const publisher = this.natsPublisher;
    if (!publisher) return command;

    const envelope: ControlCommandEnvelope = {
      command_id: command.commandId,
      device_id: command.deviceId,
      type: command.type,
      target_version: command.targetVersion,
      requested_at: command.requestedAt.toISOString(),
      expires_at: command.expiresAt.toISOString(),
      requested_by: command.requestedBy,
      idempotency_key: command.idempotencyKey,
    };
    const subject = `printops.control.command.${command.deviceId}`;
    try {
      const signedEnvelope = signControlMessage(deviceTokenHash, envelope);
      const ack = await publisher(
        subject,
        signedEnvelope as unknown as Record<string, unknown>,
        { msgId: command.commandId, durable: true },
      );
      if (!ack.acknowledged) {
        throw new AppError(
          'CONTROL_NATS_NOT_ACKNOWLEDGED',
          'JetStream did not acknowledge the command message',
          503,
        );
      }
    } catch {
      return this.commands.update(command.commandId, { status: 'PENDING' });
    }
    return this.commands.update(command.commandId, { status: 'DELIVERED' });
  }

  async handleDeviceEvent(event: ControlOtaTransitionEvent): Promise<void> {
    if (!event.deviceId) return;

    const command = event.commandId ? await this.commands.findById(event.commandId) : undefined;
    if (event.commandId && !command) return;
    if (command && command.deviceId !== event.deviceId) return;
    if (
      command?.targetVersion
      && (command.type === 'OTA_INSTALL' || command.type === 'OTA_DOWNLOAD')
      && event.targetVersion !== command.targetVersion
    ) return;
    if (command) {
      const eventAt = Date.parse(event.timestamp);
      if (!Number.isFinite(eventAt)) return;
      if (command.completedAt && (
        !terminalStates[event.state]
        || eventAt <= command.completedAt.getTime()
      )) return;
      if (!command.completedAt && command.terminalState) {
        const previousOrder = transitionOrder[command.terminalState as OtaTransitionState];
        const nextOrder = transitionOrder[event.state];
        if (previousOrder !== undefined && nextOrder !== undefined && nextOrder < previousOrder) return;
      }
    }


    // Events may be replayed from the durable outbox; only heartbeats prove current liveness.
    await this.devices.update(event.deviceId, {
      otaState: event.state,
      lastOtaOperation: event.commandId ?? event.state,
    });

    // Update command if event references a command_id
    if (event.commandId && command) {
      const patch: Partial<ControlCommandRecord> = {
        terminalState: event.state,
      };

      if (event.state === 'ACCEPTED') {
        patch.status = 'ACCEPTED';
        patch.acceptedAt = new Date(event.timestamp);
      } else if (event.state === 'COMPLETED') {
        patch.status = 'COMPLETED';
        patch.completedAt = new Date(event.timestamp);
      } else if (event.state === 'ROLLED_BACK') {
        patch.status = command.type === 'OTA_ROLLBACK' ? 'COMPLETED' : 'FAILED';
        patch.failureReason = command.type === 'OTA_INSTALL' ? 'Rolled back after installation failure' : undefined;
        patch.completedAt = new Date(event.timestamp);
      } else if (
        event.state === 'INSTALL_FAILED' ||
        event.state === 'HEALTH_CHECK_FAILED' ||
        event.state === 'ROLLBACK_FAILED' ||
        event.state === 'RECOVERY_REQUIRED'
      ) {
        patch.status = 'FAILED';
        patch.failureReason = event.errorMessage ?? event.state;
        patch.completedAt = new Date(event.timestamp);
      }

      await this.commands.update(event.commandId, patch);
    }

    if (this.audit) {
      await this.audit.record({
        actor: `device:${event.deviceId}`,
        deviceId: event.deviceId,
        commandId: event.commandId,
        action: `ota.transition.${event.state.toLowerCase()}`,
        targetVersion: event.targetVersion,
        sourceVersion: event.currentVersion,
        requestedAt: new Date(event.timestamp),
        terminalState: event.state,
        failureReason: event.errorMessage,
        metadata: event.details,
      });
    }
  }

  async getCommand(commandId: string): Promise<ControlCommandRecord | undefined> {
    return this.commands.findById(commandId);
  }

  async listDeviceCommands(deviceId: string, limit = 50): Promise<ControlCommandRecord[]> {
    return this.commands.findByDeviceId(deviceId, { limit });
  }
}
