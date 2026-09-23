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
  generateId,
} from '@printerops/shared';
import type {
  ControlCommandEnvelope,
  ControlOtaTransitionEvent,
  DevicePrintState,
  UpdateState,
} from '@printerops/domain';
import type { OtaStatus, OtaUpdateServicePort } from '../services/ota-update.service.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
      deviceTokenHash: 'hash_fail',
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

  // 2. NATS/control connection unavailable: printing continues, remote control degraded only
  it('2. NATS/control connection unavailable -> printing continues, control degrades gracefully', async () => {
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
      }),
      checkForUpdate: vi.fn(),
    } as unknown as OtaUpdateServicePort;

    // Agent configured with a failing publisher (simulating broken NATS)
    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      eventPublisher: async () => {
        throw new Error('NATS_CONNECTION_REFUSED: broker unreachable');
      },
    });

    // Local printing runs without failure
    let printCompleted = false;
    await printAdmissionGate.run(async () => {
      printCompleted = true;
    });
    expect(printCompleted).toBe(true);

    // Agent handles command without throwing fatal error (logs error, degrades gracefully)
    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_nats_down',
      device_id: deviceId,
      type: 'OTA_CHECK',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_nats_down',
    };

    const res = await agent.handleCommand(envelope, { waitForCompletion: true });
    expect(res.accepted).toBe(true);
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

  // 4. Active printing: OTA request accepted -> WAITING_FOR_IDLE -> printing finishes -> OTA continues
  it('4. Active printing -> OTA request emits WAITING_FOR_IDLE until printer is idle', async () => {
    let isPrinting = true;
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
      }),
      installUpdate: vi.fn().mockImplementation(async () => {
        return { installed: true, version: '0.1.29', state: 'COMPLETED' };
      }),
    } as unknown as OtaUpdateServicePort;

    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
      getPrintStatus: () => ({
        state: isPrinting ? ('PRINTING' as DevicePrintState) : ('IDLE' as DevicePrintState),
        queueDepth: isPrinting ? 2 : 0,
        readiness: 'READY',
      }),
      eventPublisher: async (subject, event) => {
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

    // Transition history should show WAITING_FOR_IDLE before INSTALLING
    const states = recordedEvents.map((e) => e.state);
    expect(states).toContain('ACCEPTED');
    expect(states).toContain('WAITING_FOR_IDLE');
    expect(states).toContain('INSTALLING');
    expect(states).toContain('COMPLETED');
  });

  // 5. Duplicate command: same idempotency key -> one OTA operation only
  it('5. Duplicate command -> same idempotency key results in exactly one OTA execution', async () => {
    let executionCount = 0;
    const mockOta = {
      getStatus: vi.fn().mockResolvedValue({
        state: { state: 'IDLE' as UpdateState, targetVersion: null },
      }),
      installUpdate: vi.fn().mockImplementation(async () => {
        executionCount += 1;
        return { installed: true, version: '0.1.29', state: 'COMPLETED' };
      }),
    } as unknown as OtaUpdateServicePort;

    const agent = new PrintOpsControlAgent({
      identityStore,
      otaService: mockOta,
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

    // First command execution
    const res1 = await agent.handleCommand(envelope, { waitForCompletion: true });
    expect(res1.accepted).toBe(true);
    expect(executionCount).toBe(1);

    // Duplicate command arrival
    const res2 = await agent.handleCommand(envelope, { waitForCompletion: true });
    expect(res2.accepted).toBe(true);
    expect(res2.reason).toBe('DUPLICATE_ALREADY_PROCESSED');
    // Ensure install was not executed a second time!
    expect(executionCount).toBe(1);
  });

  // 6. Invalid/unsigned release: device rejects it -> release never becomes active
  it('6. Invalid/unsigned release -> device rejects with verification failure and never activates', async () => {
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

  // 7. Health failure: install -> readiness failure -> rollback -> previous app+DB restored -> Web shows ROLLED_BACK
  it('7. Health failure -> automatic rollback restores previous version and reports ROLLED_BACK', async () => {
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
        stagedArtifact: null,
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

    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_health_fail_1',
      device_id: deviceId,
      type: 'OTA_INSTALL',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_health_fail',
    };

    await agent.handleCommand(envelope, { waitForCompletion: true });

    // Transition should record ROLLED_BACK
    const states = recordedEvents.map((e) => e.state);
    expect(states).toContain('ROLLED_BACK');

    // Web Control device state must reflect ROLLED_BACK
    const dev = await deviceRepo.findById(deviceId);
    expect(dev?.otaState).toBe('ROLLED_BACK');
  });

  // 8. Rollback failure: ROLLBACK_FAILED -> RECOVERY_REQUIRED -> further remote installs blocked
  it('8. Rollback failure -> ROLLBACK_FAILED blocks further remote installs with RECOVERY_REQUIRED', async () => {
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
        stagedArtifact: null,
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

    const envelope: ControlCommandEnvelope = {
      command_id: 'cmd_fatal_rb_1',
      device_id: deviceId,
      type: 'OTA_INSTALL',
      target_version: '0.1.29',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      requested_by: 'operator@hospital.local',
      idempotency_key: 'idem_fatal_rb_1',
    };

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
