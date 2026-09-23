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
import { WebControlRegistryService } from '../services/web-control-registry.service.js';
import type { OtaStatus, OtaUpdateServicePort } from '../services/ota-update.service.js';
import type {
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
    installUpdate: vi.fn().mockImplementation(async ({ version }) => {
      targetVersion = version;
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
  let publishedNatsCommands: Array<{ subject: string; payload: ControlCommandEnvelope }> = [];
  let publishedEvents: Array<{ subject: string; event: ControlOtaTransitionEvent }> = [];
  let publishedHeartbeats: Array<{ subject: string; heartbeat: DeviceHeartbeatPayload }> = [];

  const deviceId = 'dev_station_01';

  beforeEach(async () => {
    publishedNatsCommands = [];
    publishedEvents = [];
    publishedHeartbeats = [];
    tempDir = mkdtempSync(join(tmpdir(), 'printops-agent-test-'));

    identityStore = new DeviceIdentityStore({
      storagePath: join(tempDir, 'device-identity.json'),
    });
    identityStore.recordEnrollment(deviceId, 'devtok_secret_123', 'site-hospital-1');

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
      deviceTokenHash: 'hash123',
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
        publishedNatsCommands.push({ subject, payload: payload as unknown as ControlCommandEnvelope });
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

      const envelope: ControlCommandEnvelope = pub.payload;
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
    });

    it('agent ignores command intended for a different device', async () => {
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
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

      const envelope: ControlCommandEnvelope = {
        command_id: 'cmd_check_01',
        device_id: deviceId,
        type: 'OTA_CHECK',
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        requested_by: 'operator@hospital.local',
        idempotency_key: 'idem_check_01',
      };

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

      const envelope: ControlCommandEnvelope = {
        command_id: 'cmd_dl_01',
        device_id: deviceId,
        type: 'OTA_DOWNLOAD',
        target_version: '0.1.29',
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        requested_by: 'operator@hospital.local',
        idempotency_key: 'idem_dl_01',
      };

      await agent.handleCommand(envelope, { waitForCompletion: true });

      expect(mockOta.downloadUpdate).toHaveBeenCalledWith({ version: '0.1.29' });

      const states = publishedEvents.map((e) => e.event.state);
      expect(states).toContain('DOWNLOADING');
      expect(states).toContain('VERIFIED');

      const dev = await deviceRepo.findById(deviceId);
      expect(dev?.otaState).toBe('VERIFIED');
    });

    it('safe print point: emits WAITING_FOR_IDLE when printer is actively printing', async () => {
      let isPrinting = true;
      const agent = new PrintOpsControlAgent({
        identityStore,
        otaService: mockOta,
        getPrintStatus: () => ({
          state: isPrinting ? 'PRINTING' : 'IDLE',
          queueDepth: isPrinting ? 3 : 0,
          readiness: 'READY',
        }),
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

      const states = publishedEvents.map((e) => e.event.state);
      expect(states).toContain('ACCEPTED');
      expect(states).toContain('WAITING_FOR_IDLE');
      expect(states).toContain('INSTALLING');
      expect(states).toContain('RESTARTING');
      expect(states).toContain('COMPLETED');
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

      const envelope: ControlCommandEnvelope = {
        command_id: 'cmd_rollback_01',
        device_id: deviceId,
        type: 'OTA_ROLLBACK',
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        requested_by: 'operator@hospital.local',
        idempotency_key: 'idem_rb_01',
      };

      await agent.handleCommand(envelope, { waitForCompletion: true });

      expect(mockOta.rollbackUpdate).toHaveBeenCalled();
      const states = publishedEvents.map((e) => e.event.state);
      expect(states).toContain('ROLLING_BACK');
      expect(states).toContain('ROLLED_BACK');

      const dev = await deviceRepo.findById(deviceId);
      expect(dev?.otaState).toBe('ROLLED_BACK');
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
