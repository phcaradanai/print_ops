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
import { WebControlRegistryService, hashDeviceToken } from '../services/web-control-registry.service.js';
import { verifyControlMessageWithToken, type SignedControlMessage } from '../services/control-message-auth.js';
import type { OtaInstallProgressState, OtaStatus, OtaUpdateServicePort } from '../services/ota-update.service.js';
import type {
  ControlContentBundle,
  ControlContentIndex,
  ControlCommandEnvelope,
  ControlOtaTransitionEvent,
  DeviceHeartbeatPayload,
  UpdateState,
} from '@printerops/domain';
import { ConflictError, AppError } from '@printerops/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createMockOtaService(initialState = 'IDLE'): OtaUpdateServicePort {
  let state = initialState;
  let targetVersion: string | null = null;

  return {
    getStatus: vi.fn().mockImplementation(async (): Promise<OtaStatus> => ({
      enabled: true,
      configured: true,
      currentVersion: '0.1.28',
      currentSchemaVersion: 8,
      channel: 'stable',
      signatureVerification: 'required',
      installerConfigured: true,
      state: {
        state: state as UpdateState,
        targetVersion,
        startedAt: null,
        updatedAt: new Date(),
        errorMessage: null,
        retryCount: 0,
      },
      stagedArtifact: null,
    })),
    checkForUpdate: vi.fn().mockImplementation(async () => ({
      enabled: true,
      available: true,
      currentVersion: '0.1.28',
      latestVersion: '0.1.29',
      releaseNotes: 'Update 0.1.29 notes',
    })),
    downloadUpdate: vi.fn().mockImplementation(async ({ version }) => {
      targetVersion = version;
      state = 'VERIFIED';
      return {
        downloaded: true,
        version,
        component: 'desktop',
        platform: 'windows-x64',
        bytes: 10240,
        sha256: 'abc123sha256',
        source: 'wan',
      };
    }),
    installUpdate: vi.fn().mockImplementation(async ({ version, onProgress }) => {
      targetVersion = version;
      await onProgress?.('WAITING_FOR_IDLE' as OtaInstallProgressState);
      await onProgress?.('INSTALLING' as OtaInstallProgressState);
      state = 'COMPLETED';
      return {
        installed: true,
        version,
        component: 'desktop',
        platform: 'windows-x64',
        state: 'COMPLETED',
      };
    }),
    rollbackUpdate: vi.fn().mockImplementation(async () => {
      state = 'ROLLED_BACK';
      return {
        rolledBack: true,
        previousVersion: '0.1.28',
        restoredVersion: '0.1.28',
        state: 'ROLLED_BACK',
      };
    }),
    applyRecovery: vi.fn(),
  } as unknown as OtaUpdateServicePort;
}

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

describe('Control Command Plane & OTA Bridge (Phases 3, 4, 5)', () => {
  let deviceRepo: InMemoryDeviceRegistryRepository;
  let commandRepo: InMemoryControlCommandRepository;
  let auditRepo: InMemoryControlAuditRepository;
  let tokenRepo: InMemoryEnrollmentTokenRepository;
  let registryService: WebControlRegistryService;
  let commandService: ControlCommandService;
  let tempDir: string;
  let identityStore: DeviceIdentityStore;
  let mockOta: OtaUpdateServicePort;
  let publishedNatsCommands: Array<{ subject: string; payload: Record<string, unknown> }> = [];
  let publishedEvents: Array<{ subject: string; event: ControlOtaTransitionEvent }> = [];
  let publishedHeartbeats: Array<{ subject: string; heartbeat: DeviceHeartbeatPayload }> = [];

  const deviceId = 'dev_station_01';
  const deviceToken = 'devtok_secret_123';

  beforeEach(async () => {
    publishedNatsCommands = [];
    publishedEvents = [];
    publishedHeartbeats = [];
    tempDir = mkdtempSync(join(tmpdir(), 'printops-agent-test-'));

    identityStore = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity.json'),
    });
    identityStore.recordEnrollment(deviceId, deviceToken, 'site-hospital-1');

    deviceRepo = new InMemoryDeviceRegistryRepository();
    commandRepo = new InMemoryControlCommandRepository();
    auditRepo = new InMemoryControlAuditRepository();
    tokenRepo = new InMemoryEnrollmentTokenRepository();

    mockOta = createMockOtaService();

    // Register device in Web Control registry as ONLINE
    await deviceRepo.create({
      deviceId,
      installationId: identityStore.getInstallationId(),
      siteId: 'site-hospital-1',
      hostname: 'label-pc-01',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 8,
      runnerVersion: '0.1.28',
      deviceTokenHash: hashDeviceToken(deviceToken),
    });

    registryService = new WebControlRegistryService({
      deviceRegistry: deviceRepo,
      enrollmentTokens: tokenRepo,
      audit: auditRepo,
    });

    commandService = new ControlCommandService({
      commands: commandRepo,
      devices: deviceRepo,
      audit: auditRepo,
      natsPublisher: async (subject, payload) => {
        publishedNatsCommands.push({ subject, payload });
        return { acknowledged: true };
      },
    });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Phase 3: Command Plane & Idempotency', () => {
    it('issues command in dedicated subject with versioned envelope', async () => {
      const cmd = await commandService.issueCommand({
        deviceId,
        type: 'OTA_INSTALL',
        targetVersion: '0.1.29',
        requestedBy: 'operator@hospital.local',
        idempotencyKey: 'idem_batch_1',
        expiresInSeconds: 600,
      });

      expect(cmd.commandId).toMatch(/^cmd_/);
      expect(cmd.status).toBe('DELIVERED');
      expect(cmd.deviceId).toBe(deviceId);

      expect(publishedNatsCommands.length).toBe(1);
      const pub = publishedNatsCommands[0]!;
      expect(pub.subject).toBe(`printops.control.command.${deviceId}`);

      const signed = pub.payload as unknown as SignedControlMessage<ControlCommandEnvelope>;
      const envelope = signed.payload;
      expect(verifyControlMessageWithToken(deviceToken, envelope, signed.signature)).toBe(true);
      expect(JSON.stringify(pub.payload)).not.toContain(deviceToken);
      expect(envelope.command_id).toBe(cmd.commandId);
      expect(envelope.device_id).toBe(deviceId);
      expect(envelope.type).toBe('OTA_INSTALL');
      expect(envelope.target_version).toBe('0.1.29');
      expect(envelope.idempotency_key).toBe('idem_batch_1');
      expect(envelope.requested_by).toBe('operator@hospital.local');
    });

    it('rejects command if device is OFFLINE (no false acceptance)', async () => {
      // Simulate offline device
      await deviceRepo.update(deviceId, {
        connectionState: 'OFFLINE',
        lastSeenAt: new Date(Date.now() - 300_000),
      });

      await expect(
        commandService.issueCommand({
          deviceId,
          type: 'OTA_INSTALL',
          targetVersion: '0.1.29',
          requestedBy: 'operator@hospital.local',
          idempotencyKey: 'idem_offline_1',
        }),
      ).rejects.toMatchObject({ code: 'DEVICE_OFFLINE' });

      expect(publishedNatsCommands.length).toBe(0);
    });

    it('is replay-safe: duplicate command with same idempotency key returns existing record', async () => {
      const first = await commandService.issueCommand({
        deviceId,
        type: 'OTA_INSTALL',
        targetVersion: '0.1.29',
        requestedBy: 'operator@hospital.local',
        idempotencyKey: 'idem_dup_test',
      });

      const second = await commandService.issueCommand({
        deviceId,
        type: 'OTA_INSTALL',
        targetVersion: '0.1.29',
        requestedBy: 'operator@hospital.local',
        idempotencyKey: 'idem_dup_test',
      });

      expect(second.commandId).toBe(first.commandId);
      // NATS publication should only have occurred once
      expect(publishedNatsCommands.length).toBe(1);
    });

    it('blocks command when device is in a recovery-required state', async () => {
      await deviceRepo.update(deviceId, {
        otaState: 'ROLLBACK_FAILED',
      });

      await expect(
        commandService.issueCommand({
          deviceId,
          type: 'OTA_INSTALL',
          targetVersion: '0.1.29',
          requestedBy: 'operator@hospital.local',
          idempotencyKey: 'idem_recovery_blocked',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('Phase 4 & 5: Control Agent Bridge & State Synchronization', () => {
    it('lists client paper profiles and templates through the control command plane', async () => {
      const index: ControlContentIndex = {
        version: 1,
        generatedAt: new Date().toISOString(),
        profiles: [{
          code: 'CLIENT_LABEL_50',
          name: 'Client 50 × 30 label',
          widthMm: 50,
          heightMm: 30,
          dpi: 203,
          orientation: 'landscape',
          updatedAt: new Date().toISOString(),
        }],
        templates: [{
          templateCode: 'CLIENT_LABEL',
          name: 'Client label',
          engine: 'ZPL',
          status: 'PUBLISHED',
          paperProfileCode: 'CLIENT_LABEL_50',
          updatedAt: new Date().toISOString(),
        }],
        truncated: false,
      };
      const command = await commandService.issueCommand({
        deviceId,
        type: 'CONTENT_LIST',
        requestedBy: 'operator@hospital.local',
        idempotencyKey: 'idem_content_list_1',
      });
      const envelope: ControlCommandEnvelope = {
        command_id: command.commandId,
        device_id: deviceId,
        type: 'CONTENT_LIST',
        requested_at: command.requestedAt.toISOString(),
        expires_at: command.expiresAt.toISOString(),
        requested_by: command.requestedBy,
        idempotency_key: command.idempotencyKey,
      };
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        getClientContentIndex: async () => index,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
        },
      });

      await agent.handleCommand(envelope, { waitForCompletion: true });
      for (const { event } of publishedEvents) await commandService.handleDeviceEvent(event);

      const recorded = await commandService.getCommand(command.commandId);
      expect(recorded).toMatchObject({ status: 'COMPLETED', resultPayload: { index } });
      expect((await deviceRepo.findById(deviceId))?.otaState).toBe('IDLE');
      const completedAudit = (await auditRepo.findByDeviceId(deviceId)).find((entry) =>
        entry.action === 'content.transition.completed');
      expect(completedAudit?.metadata).toMatchObject({ resultValidated: true });
    });

    it('pulls one client template, persists the result, and keeps it out of OTA state and audit metadata', async () => {
      const privateTemplateBody = '^XA^FDprivate client layout^XZ';
      const bundle: ControlContentBundle = {
        version: 1,
        kind: 'template',
        key: 'template:CLIENT_LABEL:0123456789abcdef',
        overwriteExisting: false,
        publishedBy: 'printops-client-export',
        template: {
          templateCode: 'CLIENT_LABEL',
          name: 'Client label',
          engine: 'ZPL',
          content: privateTemplateBody,
          status: 'PUBLISHED',
        },
      };
      const command = await commandService.issueCommand({
        deviceId,
        type: 'CONTENT_PULL',
        contentType: 'template',
        contentKey: 'CLIENT_LABEL',
        requestedBy: 'operator@hospital.local',
        idempotencyKey: 'idem_content_pull_1',
      });
      const envelope: ControlCommandEnvelope = {
        command_id: command.commandId,
        device_id: deviceId,
        type: 'CONTENT_PULL',
        content_type: 'template',
        content_key: 'CLIENT_LABEL',
        requested_at: command.requestedAt.toISOString(),
        expires_at: command.expiresAt.toISOString(),
        requested_by: command.requestedBy,
        idempotency_key: command.idempotencyKey,
      };
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        exportClientContent: async (kind, code) => {
          expect(kind).toBe('template');
          expect(code).toBe('CLIENT_LABEL');
          return bundle;
        },
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
        },
      });

      await agent.handleCommand(envelope, { waitForCompletion: true });
      for (const { event } of publishedEvents) await commandService.handleDeviceEvent(event);

      const recorded = await commandService.getCommand(command.commandId);
      expect(recorded).toMatchObject({ status: 'COMPLETED', resultPayload: { bundle } });
      expect((await deviceRepo.findById(deviceId))?.otaState).toBe('IDLE');
      expect(identityStore.getCurrentControlCommand()).toBeUndefined();
      const completedAudit = (await auditRepo.findByDeviceId(deviceId)).find((entry) =>
        entry.action === 'content.transition.completed');
      expect(completedAudit?.metadata).toMatchObject({ contentType: 'template', contentKey: 'CLIENT_LABEL', resultValidated: true });
      expect(JSON.stringify(completedAudit?.metadata)).not.toContain(privateTemplateBody);
    });

    it('agent checks expiration and rejects expired commands', async () => {
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
        },
      });

      const expiredEnvelope: ControlCommandEnvelope = {
        command_id: 'cmd_expired_1',
        device_id: deviceId,
        type: 'OTA_INSTALL',
        target_version: '0.1.29',
        requested_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: new Date(Date.now() - 10_000).toISOString(), // expired 10s ago
        requested_by: 'operator@hospital.local',
        idempotency_key: 'idem_exp',
      };

      const result = await agent.handleCommand(expiredEnvelope);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('COMMAND_EXPIRED');

      // OTA install was never called
      expect(mockOta.installUpdate).not.toHaveBeenCalled();

      // Transition event published as failed
      expect(publishedEvents.some((e) => e.event.state === 'INSTALL_FAILED')).toBe(true);
      expect(publishedEvents.find((item) => item.event.state === 'INSTALL_FAILED')?.event.targetVersion)
        .toBe('0.1.29');
    });

    it('agent ignores command intended for a different device', async () => {
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
        },
      });

      const mismatchEnvelope: ControlCommandEnvelope = {
        command_id: 'cmd_other_1',
        device_id: 'dev_different_machine',
        type: 'OTA_INSTALL',
        target_version: '0.1.29',
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        requested_by: 'operator@hospital.local',
        idempotency_key: 'idem_mismatch',
      };

      const result = await agent.handleCommand(mismatchEnvelope);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('DEVICE_ID_MISMATCH');
      expect(mockOta.installUpdate).not.toHaveBeenCalled();
      expect(identityStore.getControlCommand(mismatchEnvelope.command_id, mismatchEnvelope.idempotency_key)).toBeUndefined();
      expect(identityStore.getPendingControlEvents()).toEqual([]);
      expect(publishedEvents).toEqual([]);
    });

    it('maps OTA_CHECK to checkForUpdate() and publishes transitions', async () => {
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
          await commandService.handleDeviceEvent(event);
        },
      });

      const envelope = await issueTestCommandEnvelope(commandService, {
        deviceId,
        type: 'OTA_CHECK',
        idempotencyKey: 'idem_check_01',
      });

      const res = await agent.handleCommand(envelope, { waitForCompletion: true });
      expect(res.accepted).toBe(true);
      expect(mockOta.checkForUpdate).toHaveBeenCalled();

      const states = publishedEvents.map((e) => e.event.state);
      expect(states).toContain('ACCEPTED');
      expect(states).toContain('CHECKING');
      expect(states).toContain('COMPLETED');

      // Web control device state should be updated to COMPLETED
      const dev = await deviceRepo.findById(deviceId);
      expect(dev?.otaState).toBe('COMPLETED');
    });

    it('maps OTA_DOWNLOAD to downloadUpdate() and publishes VERIFIED', async () => {
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
          await commandService.handleDeviceEvent(event);
        },
      });

      const envelope = await issueTestCommandEnvelope(commandService, {
        deviceId,
        type: 'OTA_DOWNLOAD',
        targetVersion: '0.1.29',
        idempotencyKey: 'idem_dl_01',
      });

      await agent.handleCommand(envelope, { waitForCompletion: true });

      expect(mockOta.downloadUpdate).toHaveBeenCalledWith(expect.objectContaining({ version: '0.1.29' }));

      const states = publishedEvents.map((e) => e.event.state);
      expect(states).toContain('DOWNLOADING');
      expect(states).toContain('VERIFIED');

      const dev = await deviceRepo.findById(deviceId);
      expect(dev?.otaState).toBe('VERIFIED');
      expect(await commandService.getCommand(envelope.command_id)).toMatchObject({
        status: 'COMPLETED',
        terminalState: 'VERIFIED',
      });
    });

    it('publishes and persists measured OTA download progress', async () => {
      let signalProgress!: () => void;
      const progressPublished = new Promise<void>((resolve) => { signalProgress = resolve; });
      let releaseDownload!: () => void;
      const downloadPaused = new Promise<void>((resolve) => { releaseDownload = resolve; });
      const downloadUpdate = vi.fn(async (request: Parameters<OtaUpdateServicePort['downloadUpdate']>[0]) => {
        await request.onProgress?.({ downloadedBytes: 4_000, totalBytes: 10_000 });
        signalProgress();
        await downloadPaused;
        return {
          downloaded: true,
          alreadyCurrent: false,
          version: request.version,
          component: 'desktop',
          platform: 'windows-x64',
          bytes: 10_000,
          sha256: 'abc123sha256',
          source: 'wan',
          signatureVerification: 'verified' as const,
        };
      });
      const otaService = { ...mockOta, downloadUpdate } as unknown as OtaUpdateServicePort;
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
          await commandService.handleDeviceEvent(event);
        },
      });
      const envelope = await issueTestCommandEnvelope(commandService, {
        deviceId,
        type: 'OTA_DOWNLOAD',
        targetVersion: '0.1.29',
        idempotencyKey: 'idem_dl_progress',
      });
      const execution = agent.handleCommand(envelope, { waitForCompletion: true });

      try {
        await progressPublished;
        const byteProgressEvent = publishedEvents.find(({ event }) => event.progress?.mode === 'bytes');
        expect(byteProgressEvent?.event.progress).toMatchObject({
          current: 4_000,
          total: 10_000,
          percent: 40,
          mode: 'bytes',
          phase: 'downloading',
        });
        const recorded = await commandService.getCommand(envelope.command_id);
        expect(recorded?.progress).toMatchObject({
          current: 4_000,
          total: 10_000,
          percent: 40,
          mode: 'bytes',
          phase: 'downloading',
        });
        expect(identityStore.getControlCommand(envelope.command_id, envelope.idempotency_key)?.progress)
          .toMatchObject({ current: 4_000, total: 10_000, percent: 40, mode: 'bytes' });
      } finally {
        releaseDownload();
        await execution;
      }

      expect((await commandService.getCommand(envelope.command_id))?.progress)
        .toMatchObject({ current: 1, total: 1, percent: 100, phase: 'completed' });
      expect(identityStore.getControlCommand(envelope.command_id, envelope.idempotency_key))
        .toMatchObject({ replayStatus: 'PROCESSED', lastCommandState: 'VERIFIED' });
    });

    it('maps actual OTA progress and does not predict RESTARTING from COMPLETED', async () => {
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
          await commandService.handleDeviceEvent(event);
        },
      });

      const envelope: ControlCommandEnvelope = {
        command_id: 'cmd_inst_print_safe',
        device_id: deviceId,
        type: 'OTA_INSTALL',
        target_version: '0.1.29',
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        requested_by: 'operator@hospital.local',
        idempotency_key: 'idem_inst_safe',
      };

      await agent.handleCommand(envelope, { waitForCompletion: true });

      const states = publishedEvents.map(({ event }) => event.state);
      expect(states).toContain('ACCEPTED');
      expect(states).toContain('WAITING_FOR_IDLE');
      expect(states).toContain('INSTALLING');
      expect(states).toContain('COMPLETED');
      expect(states).not.toContain('RESTARTING');
    });

    it('maps OTA_ROLLBACK to rollbackUpdate() and publishes ROLLED_BACK', async () => {
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
          await commandService.handleDeviceEvent(event);
        },
      });

      const envelope = await issueTestCommandEnvelope(commandService, {
        deviceId,
        type: 'OTA_ROLLBACK',
        idempotencyKey: 'idem_rb_01',
      });

      await agent.handleCommand(envelope, { waitForCompletion: true });

      expect(mockOta.rollbackUpdate).toHaveBeenCalled();
      const states = publishedEvents.map((e) => e.event.state);
      expect(states).toContain('ROLLING_BACK');
      expect(states).toContain('ROLLED_BACK');

      const dev = await deviceRepo.findById(deviceId);
      expect(dev?.otaState).toBe('ROLLED_BACK');
    });

    it('keeps external rollback pending until the updater confirms the outcome', async () => {
      vi.mocked(mockOta.rollbackUpdate).mockResolvedValueOnce({
        rolledBack: false,
        version: '0.1.28',
        component: 'desktop',
        platform: 'windows-x64',
        state: 'RESTART_PENDING',
      });
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        eventPublisher: async (subject, event) => {
          publishedEvents.push({ subject, event });
          await commandService.handleDeviceEvent(event);
        },
      });
      const envelope = await issueTestCommandEnvelope(commandService, {
        deviceId,
        type: 'OTA_ROLLBACK',
        idempotencyKey: 'idem_rb_external',
      });

      await agent.handleCommand(envelope, { waitForCompletion: true });

      const states = publishedEvents.map(({ event }) => event.state);
      expect(states).toContain('RESTARTING');
      expect(states).not.toContain('ROLLED_BACK');
      expect((await deviceRepo.findById(deviceId))?.otaState).not.toBe('ROLLED_BACK');
    });

    it('publishes periodic heartbeats to printops.control.heartbeat.<deviceId>', async () => {
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        heartbeatPublisher: async (subject, heartbeat) => {
          publishedHeartbeats.push({ subject, heartbeat });
          await registryService.recordHeartbeat(heartbeat);
        },
      });

      await agent.publishHeartbeat();

      expect(publishedHeartbeats.length).toBe(1);
      const hb = publishedHeartbeats[0]!;
      expect(hb.subject).toBe(`printops.control.heartbeat.${deviceId}`);
      expect(hb.heartbeat.deviceId).toBe(deviceId);
      expect(hb.heartbeat.appVersion).toBe('0.1.28');
      expect(hb.heartbeat.printState).toBe('IDLE');
      expect(hb.heartbeat.printReadinessSummary).toBe('READY');

      const dev = await deviceRepo.findById(deviceId);
      expect(dev?.connectionState).toBe('ONLINE');
    });
  });
});
