import type {
  ControlCommandRecord,
  ControlCommandType,
  ControlCommandEnvelope,
  ControlOtaTransitionEvent,
  ControlContentBundle,
  ControlContentIndex,
  CreateControlCommandInput,
  ControlCommandRepositoryPort,
  DeviceRegistryRepositoryPort,
  ControlAuditRepositoryPort,
  OtaTransitionState,
} from '@printerops/domain';
import { BLOCKING_RECOVERY_STATES } from '@printerops/domain';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@printerops/shared';
import { signControlMessage } from './control-message-auth.js';
import { MAX_CONTROL_CONTENT_BYTES } from './control-content-sync.service.js';

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

function isContentCommand(type: ControlCommandType | undefined): boolean {
  return type === 'CONTENT_SYNC' || type === 'CONTENT_LIST' || type === 'CONTENT_PULL';
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
    if (input.manifestUrl !== undefined) {
      if (!['OTA_CHECK', 'OTA_DOWNLOAD', 'OTA_INSTALL'].includes(input.type)) {
        throw new ValidationError('manifestUrl is only valid for OTA commands');
      }
      if (input.manifestUrl.length > 2048) throw new ValidationError('manifestUrl is too long');
      try {
        const manifestUrl = new URL(input.manifestUrl);
        if (!['http:', 'https:'].includes(manifestUrl.protocol) || manifestUrl.username || manifestUrl.password) {
          throw new Error('unsupported manifest URL');
        }
      } catch {
        throw new ValidationError('manifestUrl must be an absolute http(s) URL without credentials');
      }
    }
    if (input.type === 'CONTENT_SYNC') {
      if (!input.contentType || !input.contentKey || !input.contentPayload) {
        throw new ValidationError('CONTENT_SYNC requires contentType, contentKey, and contentPayload');
      }
      const payloadSize = Buffer.byteLength(JSON.stringify(input.contentPayload), 'utf8');
      if (payloadSize > MAX_CONTROL_CONTENT_BYTES) {
        throw new ValidationError(`Content bundle exceeds the ${MAX_CONTROL_CONTENT_BYTES} byte control-channel limit`);
      }
    } else if (input.type === 'CONTENT_PULL') {
      if ((input.contentType !== 'paper-profile' && input.contentType !== 'template')
        || !input.contentKey?.trim() || input.contentKey.length > 128 || input.contentPayload) {
        throw new ValidationError('CONTENT_PULL requires a valid contentType and contentKey without a payload');
      }
    } else if (input.contentPayload || input.contentType || input.contentKey) {
      throw new ValidationError('Content payload fields are only valid for CONTENT_SYNC and content identity fields only for CONTENT_PULL');
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
    if (!isContentCommand(input.type) && BLOCKING_RECOVERY_STATES[device.otaState]) {
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
      ...(command.manifestUrl ? { manifest_url: command.manifestUrl } : {}),
      requested_at: command.requestedAt.toISOString(),
      expires_at: command.expiresAt.toISOString(),
      requested_by: command.requestedBy,
      idempotency_key: command.idempotencyKey,
      ...(command.contentType ? { content_type: command.contentType } : {}),
      ...(command.contentKey ? { content_key: command.contentKey } : {}),
      ...(command.contentPayload ? { content_payload: command.contentPayload } : {}),
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
      const recoveryEscalation = command.terminalState === 'ROLLBACK_FAILED'
        && event.state === 'RECOVERY_REQUIRED'
        && command.completedAt
        && eventAt >= command.completedAt.getTime();
      if (command.completedAt && !recoveryEscalation && (
        !terminalStates[event.state]
        || eventAt <= command.completedAt.getTime()
      )) return;
      if (!command.completedAt && command.terminalState) {
        const previousOrder = transitionOrder[command.terminalState as OtaTransitionState];
        const nextOrder = transitionOrder[event.state];
        if (previousOrder !== undefined && nextOrder !== undefined && nextOrder < previousOrder) return;
      }
    }


    let contentResultValid: boolean | undefined;

    // Events may be replayed from the durable outbox; only heartbeats prove current liveness.
    if (!isContentCommand(command?.type)) {
      await this.devices.update(event.deviceId, {
        otaState: event.state,
        lastOtaOperation: event.commandId ?? event.state,
      });
    }

    // Update command if event references a command_id
    if (event.commandId && command) {
      const patch: Partial<ControlCommandRecord> = {
        terminalState: event.state,
      };

      if (event.state === 'ACCEPTED') {
        patch.status = 'ACCEPTED';
        patch.acceptedAt = new Date(event.timestamp);
      } else if (event.state === 'COMPLETED') {
        if (command.type === 'CONTENT_LIST' || command.type === 'CONTENT_PULL') {
          const resultPayload = validateClientReadResult(command, event.details);
          contentResultValid = Boolean(resultPayload);
          if (resultPayload) {
            patch.status = 'COMPLETED';
            patch.resultPayload = resultPayload;
          } else {
            patch.status = 'FAILED';
            patch.failureReason = 'Client returned an invalid or oversized content result';
          }
        } else {
          patch.status = 'COMPLETED';
        }
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
        action: `${isContentCommand(command?.type) ? 'content' : 'ota'}.transition.${event.state.toLowerCase()}`,
        targetVersion: event.targetVersion,
        sourceVersion: event.currentVersion,
        requestedAt: new Date(event.timestamp),
        terminalState: event.state,
        failureReason: event.errorMessage,
        metadata: command && (command.type === 'CONTENT_LIST' || command.type === 'CONTENT_PULL')
          ? {
            contentType: command.contentType,
            contentKey: command.contentKey,
            resultValidated: event.state === 'COMPLETED' && contentResultValid === true,
          }
          : event.details,
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

function validateClientReadResult(
  command: ControlCommandRecord,
  details: Record<string, unknown> | undefined,
): ControlCommandRecord['resultPayload'] | undefined {
  if (!details) return undefined;
  const candidate = command.type === 'CONTENT_LIST' ? details['index'] : details['bundle'];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  let byteLength: number;
  try {
    byteLength = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
  } catch {
    return undefined;
  }
  if (byteLength > MAX_CONTROL_CONTENT_BYTES) return undefined;

  if (command.type === 'CONTENT_LIST') {
    const index = candidate as Partial<ControlContentIndex>;
    if (index.version !== 1 || typeof index.generatedAt !== 'string'
      || !Array.isArray(index.profiles) || index.profiles.length > 500
      || !Array.isArray(index.templates) || index.templates.length > 500
      || typeof index.truncated !== 'boolean') return undefined;
    const validProfiles = index.profiles.every((item) => item && typeof item.code === 'string'
      && typeof item.name === 'string' && Number.isFinite(item.widthMm)
      && Number.isFinite(item.heightMm) && Number.isFinite(item.dpi)
      && typeof item.orientation === 'string' && typeof item.updatedAt === 'string');
    const validTemplates = index.templates.every((item) => item && typeof item.templateCode === 'string'
      && typeof item.name === 'string' && typeof item.engine === 'string'
      && typeof item.status === 'string' && typeof item.updatedAt === 'string');
    return validProfiles && validTemplates ? { index: index as ControlContentIndex } : undefined;
  }

  if (command.type !== 'CONTENT_PULL') return undefined;
  const bundle = candidate as Partial<ControlContentBundle>;
  if (bundle.version !== 1 || bundle.kind !== command.contentType || bundle.overwriteExisting !== false
    || typeof bundle.key !== 'string' || !bundle.key.startsWith(`${command.contentType}:${command.contentKey}:`)
    || typeof bundle.publishedBy !== 'string') return undefined;
  const code = bundle.kind === 'paper-profile'
    ? bundle.profile?.code
    : bundle.template?.templateCode;
  if (code !== command.contentKey) return undefined;
  return { bundle: bundle as ControlContentBundle };
}
