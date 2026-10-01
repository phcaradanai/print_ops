import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  InMemoryDeviceRegistryRepository,
  InMemoryControlCommandRepository,
  InMemoryControlAuditRepository,
  InMemoryEnrollmentTokenRepository,
} from '../infra/repos/in-memory-control.repo.js';
import { ControlCommandService } from '../services/control-command.service.js';
import { PrintOpsControlAgent } from '../services/control-agent.service.js';
import { DeviceIdentityStore } from '../services/device-identity.js';
import { PrintAdmissionGate } from '../services/print-admission-gate.js';
import {
  AppError,
  ConflictError,
} from '@printerops/shared';
import type {
  ControlCommandEnvelope,
  ControlOtaTransitionEvent,
  UpdateState,
} from '@printerops/domain';
import type {
  OtaInstallProgressState,
  OtaStatus,
  OtaUpdateServicePort,
} from '../services/ota-update.service.js';
import { hashDeviceToken } from '../services/control-message-auth.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function issueTestCommandEnvelope(
  commandService: ControlCommandService,
  input: {
    deviceId: string;
    type: ControlCommandEnvelope['type'];
    idempotencyKey: string;
    targetVersion?: string;
  },
): Promise<ControlCommandEnvelope> {
  const command = await commandService.issueCommand({
    ...input,
    requestedBy: 'operator@hospital.local',
    expiresInSeconds: 60,
  });
  return {
    command_id: command.commandId,
    device_id: command.deviceId,
    type: command.type,
    ...(command.targetVersion ? { target_version: command.targetVersion } : {}),
    requested_at: command.requestedAt.toISOString(),
    expires_at: command.expiresAt.toISOString(),
    requested_by: command.requestedBy,
    idempotency_key: command.idempotencyKey,
  };
}

describe('Phase 9 — Failure Semantics & Robustness', () => {
  let tempDir: string;
  let deviceRepo: InMemoryDeviceRegistryRepository;
  let commandRepo: InMemoryControlCommandRepository;
  let auditRepo: InMemoryControlAuditRepository;
  let tokenRepo: InMemoryEnrollmentTokenRepository;
  let identityStore: DeviceIdentityStore;
  let commandService: ControlCommandService;
  let printAdmissionGate: PrintAdmissionGate;

  const deviceId = 'dev_fail_test_01';
  let recordedEvents: ControlOtaTransitionEvent[] = [];

  beforeEach(async () => {
    recordedEvents = [];
    tempDir = mkdtempSync(join(tmpdir(), 'printops-failure-test-'));

    identityStore = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity.json'),
    });
    identityStore.recordEnrollment(deviceId, 'devtok_secret_fail', 'site-icu');

    deviceRepo = new InMemoryDeviceRegistryRepository();
    commandRepo = new InMemoryControlCommandRepository();
    auditRepo = new InMemoryControlAuditRepository();
    tokenRepo = new InMemoryEnrollmentTokenRepository();
    printAdmissionGate = new PrintAdmissionGate();

    await deviceRepo.create({
      deviceId,
      installationId: identityStore.getInstallationId(),
      siteId: 'site-icu',
      hostname: 'icu-workstation',
      platform: 'windows-x64',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 8,
      runnerVersion: '0.1.28',
      deviceTokenHash: hashDeviceToken('devtok_secret_fail'),
    });

    commandService = new ControlCommandService({
      commands: commandRepo,
      devices: deviceRepo,
      audit: auditRepo,
      natsPublisher: async () => ({ acknowledged: true }),
    });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Web Control unavailable: printing continues, local queue continues, local app usable
  it('1. Web Control unavailable -> printing and admission continue unaffected', async () => {
    // When Web Control is completely offline/unreachable, PrintAdmissionGate runs prints normally
    let printExecuted = false;
    await printAdmissionGate.run(async () => {
      printExecuted = true;
    });

    expect(printExecuted).toBe(true);
    expect(printAdmissionGate.isMaintenanceActive()).toBe(false);
  });

  // 2. NATS/control connection unavailable: printing continues and failed PubAck remains replayable
  it('2. NATS/control connection unavailable -> printing continues and command delivery remains retryable', async () => {
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
      }),
      checkForUpdate: vi.fn().mockResolvedValue({
        enabled: true,
        available: true,
        currentVersion: '0.1.28',
        latestVersion: '0.1.29',
        channel: 'stable',
      }),
    } as unknown as OtaUpdateServicePort;

    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async () => {
        throw new Error('NATS_CONNECTION_REFUSED: broker unreachable');
      },
    });

    let printCompleted = false;
    await printAdmissionGate.run(async () => {
      printCompleted = true;
    });
    expect(printCompleted).toBe(true);

    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_nats_down',
      device_id: deviceId,
      type: 'OTA_CHECK',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_nats_down',
    };

    await expect(agent.handleCommand(envelope, { waitForCompletion: true }))
      .rejects.toThrow('Failed to publish control event');
    expect(mockOta.checkForUpdate).not.toHaveBeenCalled();
    const pendingEvent = identityStore.getPendingControlEvents()[0]!;

    const restartedIdentityStore = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity.json'),
    });
    const redeliveredEvents: ControlOtaTransitionEvent[] = [];
    const restartedAgent = new PrintOpsControlAgent({
      identityStore: restartedIdentityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        redeliveredEvents.push(event);
      },
    });

    const resumed = await restartedAgent.handleCommand(envelope, { waitForCompletion: true });
    expect(resumed.accepted).toBe(true);
    expect(redeliveredEvents[0]?.eventId).toBe(pendingEvent.eventId);
    expect(redeliveredEvents.map((event) => event.state)).toEqual(['ACCEPTED', 'CHECKING', 'COMPLETED']);
    expect(restartedIdentityStore.getPendingControlEvents()).toEqual([]);
    expect(mockOta.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('records local presence only after an acknowledged heartbeat and flushes persisted transitions', async () => {
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        state: {
          state: 'IDLE' as UpdateState,
          targetVersion: null,
          updatedAt: new Date(),
          errorMessage: null,
          retryCount: 0,
        },
        stagedArtifact: null,
      }),
    } as unknown as OtaUpdateServicePort;
    const disconnectedAgent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async () => {
        throw new Error('control transport is not connected');
      },
    });
    await expect(disconnectedAgent.emitTransition(undefined, 'RESTARTING'))
      .rejects.toThrow('Failed to publish control event');
    const pending = identityStore.getPendingControlEvents()[0]!;

    const heartbeatAcknowledged = vi.fn();
    const connectedSocket = true;
    const failedHeartbeatAgent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      heartbeatPublisher: async () => {
        expect(connectedSocket).toBe(true);
        throw new Error('JetStream heartbeat was not acknowledged');
      },
      onHeartbeatAcknowledged: heartbeatAcknowledged,
    });
    await failedHeartbeatAgent.publishHeartbeat();
    expect(heartbeatAcknowledged).not.toHaveBeenCalled();

    const restartedIdentityStore = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity.json'),
    });
    let connected = false;
    const published: string[] = [];
    const restartedAgent = new PrintOpsControlAgent({
      identityStore: restartedIdentityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        if (!connected) throw new Error('control transport is not connected');
        published.push(event.eventId);
      },
      heartbeatPublisher: async () => {
        if (!connected) throw new Error('control transport is not connected');
        published.push('heartbeat');
      },
      onHeartbeatAcknowledged: heartbeatAcknowledged,
    });
    connected = true;

    await restartedAgent.publishHeartbeat();
    expect(heartbeatAcknowledged).toHaveBeenCalledOnce();

    expect(published).toEqual([pending.eventId, 'heartbeat']);
    expect(restartedIdentityStore.getPendingControlEvents()).toEqual([]);
  });
  it('resumes a NAKed deferred install after its persisted WAITING_FOR_IDLE event is acknowledged', async () => {
    let currentState: UpdateState = 'IDLE';
    let currentTargetVersion: string | null = null;
    let updatedAt = new Date();
    let installLaunches = 0;
    let installAttempts = 0;
    const mockOta = {
      getStatus: vi.fn(async () => ({
        enabled: true,
        configured: true,
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        state: {
          state: currentState,
          targetVersion: currentTargetVersion,
          startedAt: null,
          updatedAt,
          errorMessage: null,
          retryCount: 0,
        },
        stagedArtifact: { version: '0.1.29', component: 'desktop', platform: 'windows-x64' },
      })),
      installUpdate: vi.fn(async ({
        version,
        onProgress,
      }: {
        version: string;
        onProgress?: (state: OtaInstallProgressState) => void | Promise<void>;
      }) => {
        if (installAttempts++ === 0) {
          currentState = 'WAITING_FOR_IDLE';
          currentTargetVersion = version;
          updatedAt = new Date(Date.now() + 100);
          await onProgress?.('WAITING_FOR_IDLE');
          return { installed: false, version, state: 'WAITING_FOR_IDLE' as const, deferred: true };
        }
        installLaunches++;
        currentState = 'RESTART_PENDING';
        currentTargetVersion = version;
        updatedAt = new Date(Date.now() + 100);
        await onProgress?.('RESTART_PENDING');
        return { installed: false, version, state: 'RESTART_PENDING' as const, restartRequired: true };
      }),
    } as unknown as OtaUpdateServicePort;
    let failWaitingOnce = true;
    const publishedStates: string[] = [];
    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        if (event.state === 'WAITING_FOR_IDLE' && failWaitingOnce) {
          failWaitingOnce = false;
          throw new Error('temporary JetStream event failure');
        }
        publishedStates.push(event.state);
      },
    });
    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_deferred_event_nak',
      device_id: deviceId,
      type: 'OTA_INSTALL',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_deferred_event_nak',
    };

    await expect(agent.handleCommand(envelope, { waitForCompletion: true }))
      .rejects.toThrow('Failed to publish control event');
    expect(identityStore.getCurrentControlCommand()).toMatchObject({
      commandId: envelope.command_id,
      executionStarted: true,
      lastAuthoritativeOtaState: 'WAITING_FOR_IDLE',
    });
    expect(installAttempts).toBe(1);

    await expect(agent.handleCommand(envelope, { waitForCompletion: true }))
      .resolves.toMatchObject({ accepted: true });
    expect(installAttempts).toBe(2);

    expect(installLaunches).toBe(1);
    expect(publishedStates).toContain('WAITING_FOR_IDLE');
    expect(publishedStates).toContain('RESTARTING');
    expect(identityStore.getPendingControlEvents()).toEqual([]);
  });

  it('publishes terminal completion when the external updater finishes after startup reconciliation', async () => {
    let currentState: UpdateState = 'RESTART_PENDING';
    let currentVersion = '0.1.28';
    let updatedAt = new Date(Date.now() + 100);
    const commandId = 'cmd_late_updater_completion';
    const targetVersion = '0.1.29';
    identityStore.persistControlTransitions([
      {
        eventId: 'evt_late_updater_accepted',
        deviceId,
        commandId,
        state: 'ACCEPTED',
        targetVersion,
        currentVersion,
        timestamp: new Date().toISOString(),
      },
      {
        eventId: 'evt_late_updater_restart',
        deviceId,
        commandId,
        state: 'RESTARTING',
        targetVersion,
        currentVersion,
        timestamp: new Date().toISOString(),
      },
    ], {
      idempotencyKey: 'idem_late_updater_completion',
      commandType: 'OTA_INSTALL',
      targetVersion,
      localOtaState: 'RESTART_PENDING',
    });
    identityStore.markControlCommandStarted(commandId);
    const mockOta = {
      getStatus: vi.fn(async () => ({
        enabled: true,
        configured: true,
        currentVersion,
        currentSchemaVersion: currentState === 'COMPLETED' ? 9 : 8,
        state: {
          state: currentState,
          targetVersion,
          startedAt: null,
          updatedAt,
          errorMessage: null,
          retryCount: 0,
        },
        stagedArtifact: null,
      })),
    } as unknown as OtaUpdateServicePort;
    const publishedEvents: ControlOtaTransitionEvent[] = [];
    const heartbeatVersions: string[] = [];
    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => { publishedEvents.push(event); },
      heartbeatPublisher: async (_subject, heartbeat) => { heartbeatVersions.push(heartbeat.appVersion); },
    });

    await agent.publishHeartbeat();
    currentState = 'COMPLETED';
    currentVersion = targetVersion;
    updatedAt = new Date(Date.now() + 2_000);
    await agent.publishHeartbeat();

    expect(publishedEvents.map((event) => event.state)).toContain('COMPLETED');
    expect(identityStore.getControlCommand(commandId)?.replayStatus).toBe('PROCESSED');
    expect(heartbeatVersions.at(-1)).toBe(targetVersion);
  });


  it('resumes a command after its persisted CHECKING event receives PubAck', async () => {
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
      }),
      checkForUpdate: vi.fn().mockResolvedValue({
        enabled: true,
        available: true,
        currentVersion: '0.1.28',
        latestVersion: '0.1.29',
        channel: 'stable',
      }),
    } as unknown as OtaUpdateServicePort;
    const deliveredEvents: ControlOtaTransitionEvent[] = [];
    let failChecking = true;
    const eventPublisher = async (_subject: string, event: ControlOtaTransitionEvent) => {
      if (event.state === 'CHECKING' && failChecking) {
        failChecking = false;
        throw new Error('NATS PubAck unavailable');
      }
      deliveredEvents.push(event);
    };
    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_checking_puback_retry',
      device_id: deviceId,
      type: 'OTA_CHECK',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_checking_puback_retry',
    };
    const agent = new PrintOpsControlAgent({ identityStore, otaService: mockOta, eventPublisher });

    await expect(agent.handleCommand(envelope, { waitForCompletion: true }))
      .rejects.toThrow('Failed to publish control event');
    expect(mockOta.checkForUpdate).not.toHaveBeenCalled();

    const restartedIdentityStore = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity.json'),
    });
    const restartedAgent = new PrintOpsControlAgent({
      identityStore: restartedIdentityStore,
      otaService: mockOta,
      eventPublisher,
    });
    await restartedAgent.handleCommand(envelope, { waitForCompletion: true });

    expect(deliveredEvents.map((event) => event.state)).toEqual(['ACCEPTED', 'CHECKING', 'COMPLETED']);
    expect(mockOta.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(restartedIdentityStore.getPendingControlEvents()).toEqual([]);
  });

  // 3. Device offline: Web shows OFFLINE, no false command acceptance
  it('3. Device offline -> Web shows OFFLINE and refuses to issue command', async () => {
    // Mark device lastSeenAt 5 minutes ago
    await deviceRepo.update(deviceId, {
      connectionState: 'OFFLINE',
      lastSeenAt: new Date(Date.now() - 300_000),
    });

    const dev = await commandService.getCommand('dummy');
    const deviceState = await deviceRepo.findById(deviceId);
    expect(deviceState?.connectionState).toBe('OFFLINE');

    // Attempting to issue command to offline device fails with DEVICE_OFFLINE
    await expect(
      commandService.issueCommand({
        deviceId,
        type: 'OTA_INSTALL',
        targetVersion: '0.1.29',
        requestedBy: 'operator@hospital.local',
        idempotencyKey: 'idem_offline_guard',
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_OFFLINE' });
  });

  // 4. Deferred installs retry without flooding WAITING_FOR_IDLE transitions.
  it('4. Deferred install waits for a new idle result before reporting installation progress', async () => {
    let attempts = 0;
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
        stagedArtifact: { version: '0.1.29', component: 'desktop', platform: 'windows-x64' },
      }),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(async ({
        version,
        onProgress,
      }: {
        version: string;
        onProgress?: (state: OtaInstallProgressState) => void | Promise<void>;
      }) => {
        attempts += 1;
        await onProgress?.('WAITING_FOR_IDLE');
        if (attempts === 1) {
          return {
            installed: false,
            version,
            state: 'WAITING_FOR_IDLE' as const,
            deferred: true,
          };
        }
        await onProgress?.('INSTALLING');
        return { installed: true, version, state: 'COMPLETED' as const };
      }),
    } as unknown as OtaUpdateServicePort;

    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        recordedEvents.push(event);
      },
    });

    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_print_busy_1',
      device_id: deviceId,
      type: 'OTA_INSTALL',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_print_busy_1',
    };

    await agent.handleCommand(envelope, { waitForCompletion: true });

    const states = recordedEvents.map((event) => event.state);
    expect(states).toEqual(['ACCEPTED', 'VERIFIED', 'WAITING_FOR_IDLE', 'INSTALLING', 'COMPLETED']);
    expect(states).not.toContain('RESTARTING');
    expect(mockOta.installUpdate).toHaveBeenCalledTimes(2);
    expect(mockOta.installUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ version: '0.1.29', mode: 'automatic' }),
    );
    expect(mockOta.installUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ version: '0.1.29', mode: 'automatic' }),
    );
    expect(mockOta.downloadUpdate).not.toHaveBeenCalled();
  });

  // 5. Duplicate command replay after restart starts no second OTA operation.
  it('5. Duplicate command -> a fresh agent/store preserves idempotency across restart', async () => {
    let executionCount = 0;
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
        stagedArtifact: { version: '0.1.29', component: 'desktop', platform: 'windows-x64' },
      }),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn().mockImplementation(async () => {
        executionCount += 1;
        return { installed: true, version: '0.1.29', state: 'COMPLETED' };
      }),
    } as unknown as OtaUpdateServicePort;

    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        recordedEvents.push(event);
      },
    });
    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_dup_exec_1',
      device_id: deviceId,
      type: 'OTA_INSTALL',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_dup_key_42',
    };

    const firstResult = await agent.handleCommand(envelope, { waitForCompletion: true });
    expect(firstResult.accepted).toBe(true);
    expect(executionCount).toBe(1);

    const restartedIdentityStore = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity.json'),
    });
    const restartedAgent = new PrintOpsControlAgent({
      identityStore: restartedIdentityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        recordedEvents.push(event);
      },
    });
    const replayResult = await restartedAgent.handleCommand(envelope, { waitForCompletion: true });

    expect(replayResult.accepted).toBe(true);
    expect(replayResult.reason).toBe('DUPLICATE_ALREADY_PROCESSED');
    expect(executionCount).toBe(1);
    expect(mockOta.downloadUpdate).not.toHaveBeenCalled();
  });

  it('6. OTA_INSTALL downloads an unmatched staged artifact before installing it', async () => {
    const operationOrder: string[] = [];
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
        stagedArtifact: { version: '0.1.29', component: 'runner', platform: 'node-bundle' },
      }),
      downloadUpdate: vi.fn(async () => {
        operationOrder.push('download');
        return {
          downloaded: true,
          alreadyCurrent: false,
          version: '0.1.29',
          component: 'desktop',
          platform: 'windows-x64',
          bytes: 1024,
          sha256: 'a'.repeat(64),
          source: 'cache',
          signatureVerification: 'verified',
        };
      }),
      installUpdate: vi.fn(async ({
        onProgress,
      }: {
        onProgress?: (state: OtaInstallProgressState) => void | Promise<void>;
      }) => {
        operationOrder.push('install');
        await onProgress?.('INSTALLING');
        return {
          installed: true,
          version: '0.1.29',
          component: 'desktop',
          platform: 'windows-x64',
          state: 'COMPLETED' as const,
        };
      }),
    } as unknown as OtaUpdateServicePort;
    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        recordedEvents.push(event);
      },
    });
    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_install_download_1',
      device_id: deviceId,
      type: 'OTA_INSTALL',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_install_download_1',
    };

    await agent.handleCommand(envelope, { waitForCompletion: true });

    expect(operationOrder).toEqual(['download', 'install']);
    expect(mockOta.downloadUpdate).toHaveBeenCalledWith(expect.objectContaining({ version: '0.1.29' }));
    expect(recordedEvents.map((event) => event.state)).toEqual([
      'ACCEPTED',
      'CHECKING',
      'DOWNLOADING',
      'VERIFIED',
      'INSTALLING',
      'COMPLETED',
    ]);
  });

  it('7. OTA_INSTALL does not invoke the installer when artifact download fails', async () => {
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
        stagedArtifact: null,
      }),
      downloadUpdate: vi.fn().mockRejectedValue(new Error('artifact download failed')),
      installUpdate: vi.fn(),
    } as unknown as OtaUpdateServicePort;
    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        recordedEvents.push(event);
      },
    });
    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_install_download_failed',
      device_id: deviceId,
      type: 'OTA_INSTALL',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_install_download_failed',
    };

    await agent.handleCommand(envelope, { waitForCompletion: true });

    expect(mockOta.downloadUpdate).toHaveBeenCalledWith(expect.objectContaining({ version: '0.1.29' }));
    expect(mockOta.installUpdate).not.toHaveBeenCalled();
    expect(recordedEvents.map((event) => event.state)).toEqual([
      'ACCEPTED',
      'CHECKING',
      'DOWNLOADING',
      'INSTALL_FAILED',
    ]);
  });

  it.each([
    {
      scenario: 'matching completed target',
      otaState: 'COMPLETED' as UpdateState,
      localTargetVersion: '0.1.29',
      expectedEventState: 'COMPLETED',
    },
    {
      scenario: 'matching rolled-back target',
      otaState: 'ROLLED_BACK' as UpdateState,
      localTargetVersion: '0.1.29',
      expectedEventState: 'ROLLED_BACK',
    },
    {
      scenario: 'matching rollback failure',
      otaState: 'ROLLBACK_FAILED' as UpdateState,
      localTargetVersion: '0.1.29',
      expectedEventState: 'RECOVERY_REQUIRED',
    },
    {
      scenario: 'terminal result for a different target requires recovery',
      otaState: 'COMPLETED' as UpdateState,
      localTargetVersion: '0.1.30',
      expectedEventState: 'RECOVERY_REQUIRED',
    },
    {
      scenario: 'matching terminal state predates the install marker',
      otaState: 'COMPLETED' as UpdateState,
      localTargetVersion: '0.1.29',
      expectedEventState: 'RECOVERY_REQUIRED',
      staleUpdaterEvidence: true,
    },
    {
      scenario: 'still restart pending',
      otaState: 'RESTART_PENDING' as UpdateState,
      localTargetVersion: '0.1.29',
      expectedEventState: undefined,
    },
  ])('reconciles a persisted restart only for $scenario', async ({
    otaState,
    localTargetVersion,
    expectedEventState,
    staleUpdaterEvidence,
  }) => {
    let currentOtaState: UpdateState = 'IDLE';
    let currentTargetVersion: string | null = null;
    let currentVersion = '0.1.28';
    let currentErrorMessage: string | null = null;
    let currentUpdatedAt = new Date();
    const mockOta = {
      getStatus: vi.fn(async (): Promise<OtaStatus> => ({
        enabled: true,
        configured: true,
        currentVersion,
        currentSchemaVersion: 8,
        channel: 'stable',
        signatureVerification: 'required',
        installerConfigured: true,
        state: {
          state: currentOtaState,
          targetVersion: currentTargetVersion,
          startedAt: null,
          updatedAt: currentUpdatedAt,
          errorMessage: currentErrorMessage,
          retryCount: 0,
        },
        stagedArtifact: {
          version: '0.1.29',
          component: 'desktop',
          platform: 'windows-x64',
          bytes: 1024,
          sha256: 'a'.repeat(64),
          signature: 'signature',
          source: 'cache',
        },
      })),
      installUpdate: vi.fn(async ({
        onProgress,
      }: {
        onProgress?: (state: OtaInstallProgressState) => void | Promise<void>;
      }) => {
        await onProgress?.('RESTART_PENDING');
        return {
          installed: false,
          version: '0.1.29',
          component: 'desktop',
          platform: 'windows-x64',
          state: 'RESTART_PENDING' as const,
          restartRequired: true,
        };
      }),
    } as unknown as OtaUpdateServicePort;
    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        recordedEvents.push(event);
      },
    });
    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_restart_reconcile',
      device_id: deviceId,
      type: 'OTA_INSTALL',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_restart_reconcile',
    };

    await agent.handleCommand(envelope, { waitForCompletion: true });
    currentOtaState = otaState;
    currentTargetVersion = localTargetVersion;
    currentVersion = otaState === 'COMPLETED' ? localTargetVersion : '0.1.28';
    currentUpdatedAt = staleUpdaterEvidence
      ? new Date('2020-01-01T00:00:00.000Z')
      : new Date(Date.now() + 1_000);

    const restartedIdentityStore = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity.json'),
    });
    const reconciledEvents: ControlOtaTransitionEvent[] = [];
    const restartedAgent = new PrintOpsControlAgent({
      identityStore: restartedIdentityStore,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        reconciledEvents.push(event);
      },
    });
    const duplicate = await restartedAgent.handleCommand(envelope, { waitForCompletion: true });

    expect(duplicate.reason).toBe(
      expectedEventState === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED' : 'DUPLICATE_ALREADY_PROCESSED',
    );
    expect(mockOta.installUpdate).toHaveBeenCalledTimes(1);
    expect(reconciledEvents.map((event) => event.state))
      .toEqual(expectedEventState ? [expectedEventState] : []);
    if (localTargetVersion === '0.1.30' || staleUpdaterEvidence) {
      const blocked = await restartedAgent.handleCommand({
        ...envelope,
        command_id: 'cmd_blocked_by_ambiguous_recovery',
        target_version: '0.1.31',
        idempotency_key: 'idem_blocked_by_ambiguous_recovery',
      }, { waitForCompletion: true });
      expect(blocked).toEqual({ accepted: false, reason: 'RECOVERY_REQUIRED' });
      expect(mockOta.installUpdate).toHaveBeenCalledTimes(1);
    }
  });


  it('uses OTA-reported current version while preserving identity fields in control payloads', async () => {
    const oldIdentity = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity-old-version.json'),
      appVersion: '0.1.28',
      schemaVersion: 8,
    });
    oldIdentity.recordEnrollment(deviceId, 'devtok_secret_fail', 'site-icu');
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        enabled: true,
        configured: true,
        currentVersion: '0.1.29',
        currentSchemaVersion: 9,
        channel: 'stable',
        signatureVerification: 'required',
        installerConfigured: true,
        state: {
          state: 'COMPLETED' as UpdateState,
          targetVersion: '0.1.29',
          startedAt: null,
          updatedAt: new Date(),
          errorMessage: null,
          retryCount: 0,
        },
        stagedArtifact: null,
      }),
    } as unknown as OtaUpdateServicePort;
    const events: ControlOtaTransitionEvent[] = [];
    const agent = new PrintOpsControlAgent({
      identityStore: oldIdentity,
      otaService: mockOta,
      eventPublisher: async (_subject, event) => {
        events.push(event);
      },
    });

    expect(oldIdentity.getIdentity()).toMatchObject({
      deviceId,
      appVersion: '0.1.28',
      schemaVersion: 8,
    });
    await agent.emitTransition(undefined, 'REQUESTED');
    const heartbeat = await agent.buildHeartbeat();

    expect(events[0]?.currentVersion).toBe('0.1.29');
    expect(heartbeat).toMatchObject({
      deviceId,
      installationId: oldIdentity.getInstallationId(),
      appVersion: '0.1.29',
      schemaVersion: 9,
    });
  });

  it('expires a command whose deadline is exactly the current instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00.000Z'));
    try {
      const mockOta = {
        getStatus: vi.fn().mockResolvedValue({
          currentVersion: '0.1.28',
          currentSchemaVersion: 8,
          state: { state: 'IDLE' as UpdateState, targetVersion: null },
        }),
        checkForUpdate: vi.fn(),
      } as unknown as OtaUpdateServicePort;
      const events: ControlOtaTransitionEvent[] = [];
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (_subject, event) => {
          events.push(event);
        },
      });
      const envelope: ControlCommandEnvelope = {
        command_id: 'cmd_expiry_boundary',
        device_id: deviceId,
        type: 'OTA_CHECK',
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now()).toISOString(),
        requested_by: 'operator@hospital.local',
        idempotency_key: 'idem_expiry_boundary',
      };

      const result = await agent.handleCommand(envelope, { waitForCompletion: true });

      expect(result).toEqual({ accepted: false, reason: 'COMMAND_EXPIRED' });
      expect(events.map((event) => event.state)).toEqual(['INSTALL_FAILED']);
      expect(mockOta.checkForUpdate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a deferred install at the exact command expiry instant', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-09-25T12:00:00.000Z');
    vi.setSystemTime(startedAt);
    try {
      let releaseProgressWait = () => {};
      const progressWait = new Promise<void>((resolve) => {
        releaseProgressWait = resolve;
      });
      const mockOta = {
        getStatus: vi.fn().mockResolvedValue({
          currentVersion: '0.1.28',
          currentSchemaVersion: 8,
          state: { state: 'IDLE' as UpdateState, targetVersion: null },
          stagedArtifact: { version: '0.1.29', component: 'desktop', platform: 'windows-x64' },
        }),
        installUpdate: vi.fn(async ({
          version,
          onProgress,
        }: {
          version: string;
          onProgress?: (state: OtaInstallProgressState) => void | Promise<void>;
        }) => {
          await onProgress?.('WAITING_FOR_IDLE');
          releaseProgressWait();
          return { installed: false, version, state: 'WAITING_FOR_IDLE' as const, deferred: true };
        }),
      } as unknown as OtaUpdateServicePort;
      const events: ControlOtaTransitionEvent[] = [];
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (_subject, event) => {
          events.push(event);
        },
      });
      const envelope: ControlCommandEnvelope = {
        command_id: 'cmd_deferred_expiry_boundary',
        device_id: deviceId,
        type: 'OTA_INSTALL',
        target_version: '0.1.29',
        requested_at: startedAt.toISOString(),
        expires_at: new Date(startedAt.getTime() + 1_000).toISOString(),
        requested_by: 'operator@hospital.local',
        idempotency_key: 'idem_deferred_expiry_boundary',
      };

      const handling = agent.handleCommand(envelope, { waitForCompletion: true });
      await progressWait;
      for (let attempt = 0; attempt < 10 && vi.getTimerCount() === 0; attempt += 1) {
        await Promise.resolve();
      }
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      await handling;

      expect(mockOta.installUpdate).toHaveBeenCalledTimes(1);
      expect(events.map((event) => event.state)).toEqual([
        'ACCEPTED',
        'VERIFIED',
        'WAITING_FOR_IDLE',
        'INSTALL_FAILED',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  // 8. Invalid/unsigned release: device rejects it -> release never becomes active
  it('8. Invalid/unsigned release -> device rejects with verification failure and never activates', async () => {
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
      }),
      downloadUpdate: vi.fn().mockRejectedValue(
        new AppError('OTA_VERIFY_FAILED', 'Cryptographic signature verification failed for artifact', 400),
      ),
    } as unknown as OtaUpdateServicePort;

    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (subject, event) => {
        recordedEvents.push(event);
      },
    });

    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_bad_sig_1',
      device_id: deviceId,
      type: 'OTA_DOWNLOAD',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_bad_sig',
    };

    await agent.handleCommand(envelope, { waitForCompletion: true });

    const failedEvent = recordedEvents.find((e) => e.state === 'INSTALL_FAILED');
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.errorMessage).toContain('signature verification failed');
  });

  // 9. Health failure: install -> readiness failure -> rollback -> previous app+DB restored -> Web shows ROLLED_BACK
  it('9. Health failure -> automatic rollback restores previous version and reports ROLLED_BACK', async () => {
    let otaState: UpdateState = 'IDLE';

    const mockOta = {
      getStatus: vi.fn().mockImplementation(async (): Promise<OtaStatus> => ({
        enabled: true,
        configured: true,
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        channel: 'stable',
        signatureVerification: 'required',
        installerConfigured: true,
        state: {
          state: otaState,
          targetVersion: '0.1.29',
          startedAt: null,
          updatedAt: new Date(),
          errorMessage: otaState === 'ROLLED_BACK' ? 'Readiness health probe failed' : null,
          retryCount: 0,
        },
        stagedArtifact: {
          version: '0.1.29',
          component: 'desktop',
          platform: 'windows-x64',
          bytes: 1024,
          sha256: 'a'.repeat(64),
          signature: 'signature',
          source: 'cache',
        },
      })),
      installUpdate: vi.fn().mockImplementation(async () => {
        // Updater ran, but readiness probe failed -> updater executed rollback
        otaState = 'ROLLED_BACK';
        throw new AppError('OTA_HEALTH_CHECK_FAILED', 'Application health check failed after update', 500);
      }),
    } as unknown as OtaUpdateServicePort;

    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (subject, event) => {
        recordedEvents.push(event);
        await commandService.handleDeviceEvent(event);
      },
    });

    const envelope = await issueTestCommandEnvelope(commandService, {
      deviceId,
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      idempotencyKey: 'idem_health_fail',
    });

    await agent.handleCommand(envelope, { waitForCompletion: true });

    // Transition should record ROLLED_BACK
    const states = recordedEvents.map((e) => e.state);
    expect(states).toContain('ROLLED_BACK');

    // Web Control device state must reflect ROLLED_BACK
    const dev = await deviceRepo.findById(deviceId);
    expect(dev?.otaState).toBe('ROLLED_BACK');
  });

  // 10. Rollback failure: ROLLBACK_FAILED -> RECOVERY_REQUIRED -> further remote installs blocked
  it('10. Rollback failure -> ROLLBACK_FAILED blocks further remote installs with RECOVERY_REQUIRED', async () => {
    let otaState: UpdateState = 'IDLE';

    const mockOta = {
      getStatus: vi.fn().mockImplementation(async (): Promise<OtaStatus> => ({
        enabled: true,
        configured: true,
        currentVersion: '0.1.28',
        currentSchemaVersion: 8,
        channel: 'stable',
        signatureVerification: 'required',
        installerConfigured: true,
        state: {
          state: otaState,
          targetVersion: '0.1.29',
          startedAt: null,
          updatedAt: new Date(),
          errorMessage: otaState === 'ROLLBACK_FAILED' ? 'FATAL: database restore failed during rollback' : null,
          retryCount: 0,
        },
        stagedArtifact: {
          version: '0.1.29',
          component: 'desktop',
          platform: 'windows-x64',
          bytes: 1024,
          sha256: 'a'.repeat(64),
          signature: 'signature',
          source: 'cache',
        },
      })),
      installUpdate: vi.fn().mockImplementation(async () => {
        otaState = 'ROLLBACK_FAILED';
        throw new AppError('OTA_ROLLBACK_FAILED', 'FATAL: database restore failed during rollback', 500);
      }),
    } as unknown as OtaUpdateServicePort;

    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async (subject, event) => {
        recordedEvents.push(event);
        await commandService.handleDeviceEvent(event);
      },
    });

    const envelope = await issueTestCommandEnvelope(commandService, {
      deviceId,
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      idempotencyKey: 'idem_fatal_rb_1',
    });

    await agent.handleCommand(envelope, { waitForCompletion: true });

    // Must emit ROLLBACK_FAILED and RECOVERY_REQUIRED
    const states = recordedEvents.map((e) => e.state);
    expect(states).toContain('ROLLBACK_FAILED');
    expect(states).toContain('RECOVERY_REQUIRED');

    // Device state in Web Control registry must be updated
    const dev = await deviceRepo.findById(deviceId);
    expect(dev?.otaState).toBe('RECOVERY_REQUIRED');

    // FURTHER REMOTE INSTALLS MUST BE BLOCKED
    await expect(
      commandService.issueCommand({
        deviceId,
        type: 'OTA_INSTALL',
        targetVersion: '0.1.29',
        requestedBy: 'operator@hospital.local',
        idempotencyKey: 'idem_after_fatal_rollback',
      }),
    ).rejects.toThrow(ConflictError);
  });
});
