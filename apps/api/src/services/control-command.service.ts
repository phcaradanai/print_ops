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

    // Idempotency check: if command with same idempotency_key already exists for this device
    const existing = await this.commands.findByIdempotencyKey(input.deviceId, input.idempotencyKey.trim());
    if (existing) {
      // Replay safe: return the existing command without creating duplicates
      return existing;
    }

    const command = await this.commands.create(input);

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
    if (this.natsPublisher) {
      try {
        await this.natsPublisher(subject, envelope as unknown as Record<string, unknown>, {
          msgId: command.commandId,
          durable: true,
        });
        await this.commands.update(command.commandId, { status: 'DELIVERED' });
        command.status = 'DELIVERED';
      } catch (err) {
        // If NATS publication fails, mark command pending retry or throw
        await this.commands.update(command.commandId, {
          status: 'PENDING',
          failureReason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (this.audit) {
      await this.audit.record({
        actor: input.requestedBy,
        deviceId: command.deviceId,
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

    return command;
  }

  async handleDeviceEvent(event: ControlOtaTransitionEvent): Promise<void> {
    if (!event.deviceId) return;

    // Update device registry with authoritative OTA state
    await this.devices.update(event.deviceId, {
      otaState: event.state,
      lastOtaOperation: event.commandId ?? event.state,
      lastSeenAt: new Date(event.timestamp),
      connectionState: 'ONLINE',
    });

    // Update command if event references a command_id
    if (event.commandId) {
      const command = await this.commands.findById(event.commandId);
      if (command) {
        const patch: Partial<ControlCommandRecord> = {
          terminalState: event.state,
        };

        if (event.state === 'ACCEPTED') {
          patch.status = 'ACCEPTED';
          patch.acceptedAt = new Date(event.timestamp);
        } else if (event.state === 'COMPLETED' || event.state === 'ROLLED_BACK') {
          patch.status = 'COMPLETED';
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
