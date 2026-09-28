#!/usr/bin/env node
/**
 * PrintOps Web Control OTA — Simulated Integration Regression (Not Native Acceptance)
 *
 * Exercises service behavior only:
 * - In-memory control repositories and a fake command publisher.
 * - A temporary identity JSON file reopened by a new store instance.
 * - Direct Control Agent calls with mocked local OTA outcomes.
 * - Command expiry, target, offline, idempotency, and recovery-state checks.
 *
 * Does not connect to NATS, launch Web Control or a Windows installation, or
 * perform real download, install, restart, rollback, or release verification.
 */

import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import {
  DeviceIdentityStore,
} from '../apps/api/dist/services/device-identity.js';
import {
  WebControlRegistryService,
} from '../apps/api/dist/services/web-control-registry.service.js';
import {
  ControlCommandService,
} from '../apps/api/dist/services/control-command.service.js';
import {
  PrintOpsControlAgent,
} from '../apps/api/dist/services/control-agent.service.js';
import {
  ReleaseCatalogService,
} from '../apps/api/dist/services/release-catalog.service.js';
import {
  InMemoryDeviceRegistryRepository,
  InMemoryControlCommandRepository,
  InMemoryControlAuditRepository,
  InMemoryEnrollmentTokenRepository,
  InMemoryReleaseCatalogRepository,
} from '../apps/api/dist/infra/repos/in-memory-control.repo.js';

console.log('===============================================================');
console.log(' PRINTOPS WEB CONTROL OTA — SIMULATED INTEGRATION REGRESSION ');
console.log('                  NOT NATIVE ACCEPTANCE                    ');

const testDir = mkdtempSync(join(tmpdir(), 'printops-e2e-control-'));
const identityPath = join(testDir, 'device-identity.json');

// Use an ephemeral signing key for the simulated release record only.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

console.log('✓ Initialized ephemeral test environment at', testDir);
console.log('✓ Generated ephemeral test signing keypair (not a release key)\n');

try {
  // ─────────────────────────────────────────────────────────────────────────────
  // SETUP: Repositories & Services
  // ─────────────────────────────────────────────────────────────────────────────
  const deviceRepo = new InMemoryDeviceRegistryRepository();
  const tokenRepo = new InMemoryEnrollmentTokenRepository();
  const commandRepo = new InMemoryControlCommandRepository();
  const auditRepo = new InMemoryControlAuditRepository();
  const releaseRepo = new InMemoryReleaseCatalogRepository();

  const registryService = new WebControlRegistryService({
    deviceRegistry: deviceRepo,
    enrollmentTokens: tokenRepo,
    audit: auditRepo,
    config: { natsUrl: 'nats://simulation.invalid:4222' },
  });

  const releaseCatalog = new ReleaseCatalogService({
    releases: releaseRepo,
  });

  const capturedCommands = [];
  const commandService = new ControlCommandService({
    commands: commandRepo,
    devices: deviceRepo,
    audit: auditRepo,
    natsPublisher: async (subject, payload) => {
      capturedCommands.push({ subject, payload });
      return { acknowledged: true };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: Enrollment & Identity Store Reload
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[SCENARIO 1] Simulated Device Identity & Enrollment');

  // 1. Generate one-time enrollment token
  const enrollmentToken = await registryService.createEnrollmentToken({
    siteId: 'hospital-ward-1',
    createdBy: 'sysadmin@printerops.local',
    expiresInSeconds: 3600,
  });
  assert(enrollmentToken.token.startsWith('enroll_'), 'Invalid token prefix');
  console.log('  1.1 Generated one-time enrollment token:', enrollmentToken.token);

  // 2. Initialize device identity store
  const identityStore = new DeviceIdentityStore({
    storagePath: identityPath,
    appVersion: '0.1.28',
    schemaVersion: 8,
  });
  const installationId = identityStore.getInstallationId();
  assert(installationId.startsWith('inst_'), 'Invalid installation ID');
  console.log('  1.2 Test identity store generated installation ID:', installationId);

  // 3. Enroll through the registry service directly
  const enrollmentRes = await registryService.enrollDevice({
    enrollmentToken: enrollmentToken.token,
    installationId,
    hostname: 'ward1-station-pc',
    platform: 'windows-x64',
    architecture: 'x64',
    appVersion: '0.1.28',
    schemaVersion: 8,
    runnerVersion: '0.1.28',
    displayName: 'Ward 1 Thermal Station',
  });
  const deviceId = enrollmentRes.deviceId;
  identityStore.recordEnrollment(deviceId, enrollmentRes.deviceToken, 'hospital-ward-1');
  assert(identityStore.isEnrolled(), 'Device should be marked enrolled');
  console.log('  1.3 Registry service enrolled test device:', deviceId);

  // 4. Verify token cannot be re-used (one-time protection)
  let replayBlocked = false;
  try {
    await registryService.enrollDevice({
      enrollmentToken: enrollmentToken.token,
      installationId: 'inst_fake_attacker',
      hostname: 'rogue-pc',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 8,
      runnerVersion: '0.1.28',
    });
  } catch {
    replayBlocked = true;
  }
  assert(replayBlocked, 'Enrollment token replay was not blocked!');
  console.log('  1.4 Registry service rejected reuse of the enrollment token');

  // 5. Reopen the temporary identity file with a new store instance.
  const reopenedStore = new DeviceIdentityStore({ storagePath: identityPath });
  assert.equal(reopenedStore.getInstallationId(), installationId, 'InstallationId changed after reopening the store');
  assert.equal(reopenedStore.getDeviceId(), deviceId, 'DeviceId missing after reopening the store');
  console.log('  1.5 Temporary identity-file reopen check passed\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: Mocked Success-Path OTA State Flow
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[SCENARIO 2] Simulated Success-Path OTA State Flow');

  // Register a simulated release catalog record for v0.1.29.
  const releaseSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const releaseSignature = sign(null, Buffer.from(releaseSha256, 'hex'), privateKey).toString('base64');

  const releaseB = await releaseCatalog.registerRelease({
    version: '0.1.29',
    channel: 'stable',
    platform: 'windows-x64',
    architecture: 'x64',
    schemaVersion: 8,
    manifestRef: 'https://releases.hospital.local/v0.1.29/manifest.json',
    artifactRef: 'https://releases.hospital.local/v0.1.29/PrintOps_0.1.29_x64-setup.exe',
    sha256: releaseSha256,
    signature: releaseSignature,
    minSupportedVersion: '0.1.20',
    status: 'AVAILABLE',
    releaseNotes: 'General availability update with performance enhancements',
  });
  console.log('  2.1 Test release record registered in the in-memory catalog');

  // Use a mock local OTA service that returns controlled outcomes and state.
  let currentLocalVersion = '0.1.28';
  let localOtaState = 'IDLE';
  const recordedTransitions = [];

  // This mock emits the same progress contract as the local OTA engine.
  let installAttempts = 0;
  const mockOtaService = {
    getStatus: async () => ({
      enabled: true,
      configured: true,
      currentVersion: currentLocalVersion,
      currentSchemaVersion: 8,
      channel: 'stable',
      signatureVerification: 'required',
      installerConfigured: true,
      state: { state: localOtaState, targetVersion: '0.1.29', updatedAt: new Date(), retryCount: 0 },
      stagedArtifact: null,
    }),
    checkForUpdate: async () => ({ enabled: true, available: true, latestVersion: '0.1.29' }),
    downloadUpdate: async ({ version }) => {
      localOtaState = 'VERIFIED';
      return { downloaded: true, version, component: 'desktop', platform: 'windows-x64', bytes: 45000000, sha256: releaseSha256, source: 'wan' };
    },
    installUpdate: async ({ version, onProgress }) => {
      installAttempts += 1;
      localOtaState = 'WAITING_FOR_IDLE';
      await onProgress?.('WAITING_FOR_IDLE');
      if (installAttempts === 1) {
        return { installed: false, version, state: 'WAITING_FOR_IDLE', deferred: true };
      }
      localOtaState = 'INSTALLING';
      await onProgress?.('INSTALLING');
      localOtaState = 'COMPLETED';
      currentLocalVersion = version;
      return { installed: true, version, state: 'COMPLETED' };
    },
    rollbackUpdate: async () => {
      localOtaState = 'ROLLED_BACK';
      currentLocalVersion = '0.1.28';
      return { rolledBack: true, previousVersion: '0.1.28', state: 'ROLLED_BACK' };
    },
    applyRecovery: async () => {},
  };

  let isPrintingActive = true; // active printing initially!

  const controlAgent = new PrintOpsControlAgent({
    identityStore,
    otaService: mockOtaService,
    getPrintStatus: () => ({
      state: isPrintingActive ? 'PRINTING' : 'IDLE',
      queueDepth: isPrintingActive ? 2 : 0,
      readiness: 'READY',
    }),
    eventPublisher: async (subject, event) => {
      recordedTransitions.push(event.state);
      if (event.state === 'WAITING_FOR_IDLE') isPrintingActive = false;
      await commandService.handleDeviceEvent(event);
    },
    heartbeatPublisher: async (subject, heartbeat) => {
      await registryService.recordHeartbeat(heartbeat);
    },
  });

  // Call the command service directly; there is no Web Control UI in this test.
  console.log('  2.2 Direct command-service call requests OTA_INSTALL for version 0.1.29');
  const installCmd = await commandService.issueCommand({
    deviceId,
    type: 'OTA_INSTALL',
    targetVersion: '0.1.29',
    requestedBy: 'operator@hospital.local',
    idempotencyKey: 'idem_success_test_1',
    expiresInSeconds: 600,
  });
  assert.equal(installCmd.status, 'DELIVERED');
  console.log('  2.3 Fake publisher captured command subject: printops.control.command.' + deviceId);

  // Pass the captured envelope directly to the in-process control agent.
  console.log('  2.4 Call the test Control Agent directly with the captured command...');
  const envelope = capturedCommands[0].payload.payload;
  const agentRes = await controlAgent.handleCommand(envelope, { waitForCompletion: true });
  assert(agentRes.accepted, `Command was rejected by agent: ${agentRes.reason ?? 'unknown reason'}`);

  assert(recordedTransitions.includes('WAITING_FOR_IDLE'), 'Failed to emit WAITING_FOR_IDLE during simulated active printing!');
  assert.equal(
    recordedTransitions.filter((state) => state === 'WAITING_FOR_IDLE').length,
    1,
    'Repeated deferred install attempts must not flood WAITING_FOR_IDLE events',
  );
  console.log('  2.5 State-machine assertion: simulated deferred install reported WAITING_FOR_IDLE once');

  assert(recordedTransitions.includes('INSTALLING'), 'Missing INSTALLING transition');
  assert(recordedTransitions.includes('COMPLETED'), 'Missing COMPLETED transition');
  assert(!recordedTransitions.includes('RESTARTING'), 'A synchronous COMPLETED result must not imply a restart');

  // Check the in-memory registry state updated by the direct service callback.
  const syncedDevice = await registryService.getDevice(deviceId);
  assert.equal(syncedDevice.otaState, 'COMPLETED', 'In-memory registry did not reflect COMPLETED');
  assert.equal(syncedDevice.connectionState, 'ONLINE', 'In-memory device state changed unexpectedly');
  console.log('  2.6 In-memory registry reflects COMPLETED at v0.1.29\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: Mocked Rollback State
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[SCENARIO 3] Mocked OTA Failure and Rollback-State Handling');

  // Setup broken release B
  const brokenOtaService = {
    getStatus: async () => ({
      enabled: true,
      configured: true,
      currentVersion: currentLocalVersion,
      currentSchemaVersion: 8,
      channel: 'stable',
      signatureVerification: 'required',
      installerConfigured: true,
      state: { state: localOtaState, targetVersion: '0.1.30-broken', updatedAt: new Date(), retryCount: 0 },
      stagedArtifact: null,
    }),
    checkForUpdate: async () => ({ enabled: true, available: true, latestVersion: '0.1.30-broken' }),
    downloadUpdate: async ({ version }) => ({ downloaded: true, version, component: 'desktop', platform: 'windows-x64', bytes: 45000000, sha256: 'shaBroken', source: 'wan' }),
    installUpdate: async () => {
      // Return a simulated health-check failure after setting the mocked rollback outcome.
      localOtaState = 'ROLLED_BACK';
      currentLocalVersion = '0.1.28';
      throw new Error('HEALTH_CHECK_FAILED: Simulated probe failure');
    },
    rollbackUpdate: async () => {
      localOtaState = 'ROLLED_BACK';
      currentLocalVersion = '0.1.28';
      return { rolledBack: true, previousVersion: '0.1.28', state: 'ROLLED_BACK' };
    },
    applyRecovery: async () => {},
  };

  const rollbackTransitions = [];
  const rollbackAgent = new PrintOpsControlAgent({
    identityStore,
    otaService: brokenOtaService,
    getPrintStatus: () => ({ state: 'IDLE', queueDepth: 0, readiness: 'READY' }),
    eventPublisher: async (subject, event) => {
      rollbackTransitions.push(event.state);
      await commandService.handleDeviceEvent(event);
    },
  });

  console.log('  3.1 Direct command-service call requests the simulated broken target');
  capturedCommands.length = 0;
  const brokenCmd = await commandService.issueCommand({
    deviceId,
    type: 'OTA_INSTALL',
    targetVersion: '0.1.30-broken',
    requestedBy: 'operator@hospital.local',
    idempotencyKey: 'idem_broken_rollback_1',
    expiresInSeconds: 600,
  });

  const brokenEnvelope = capturedCommands[0].payload.payload;
  await rollbackAgent.handleCommand(brokenEnvelope, { waitForCompletion: true });

  assert(rollbackTransitions.includes('ROLLED_BACK'), 'Control Agent failed to emit ROLLED_BACK');
  const rolledBackDevice = await registryService.getDevice(deviceId);
  assert.equal(rolledBackDevice.otaState, 'ROLLED_BACK', 'In-memory registry did not reflect ROLLED_BACK');
  console.log('  3.2 Mocked OTA outcome produced ROLLED_BACK; in-memory registry reflected that state\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: Simulated Rollback Failure and Recovery Guard
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[SCENARIO 4] Simulated ROLLBACK_FAILED and RECOVERY_REQUIRED');

  let fatalOtaState = 'IDLE';
  const fatalOtaService = {
    getStatus: async () => ({
      enabled: true,
      configured: true,
      currentVersion: currentLocalVersion,
      currentSchemaVersion: 8,
      channel: 'stable',
      signatureVerification: 'required',
      installerConfigured: true,
      state: { state: fatalOtaState, targetVersion: '0.1.30', updatedAt: new Date(), retryCount: 0 },
      stagedArtifact: null,
    }),
    downloadUpdate: async ({ version }) => ({ downloaded: true, version, component: 'desktop', platform: 'windows-x64', bytes: 45000000, sha256: 'shaFatal', source: 'wan' }),
    installUpdate: async () => {
      fatalOtaState = 'ROLLBACK_FAILED';
      throw new Error('FATAL: Simulated failure from the mocked OTA service');
    },
  };

  const fatalTransitions = [];
  const fatalAgent = new PrintOpsControlAgent({
    identityStore,
    otaService: fatalOtaService,
    eventPublisher: async (subject, event) => {
      fatalTransitions.push(event.state);
      await commandService.handleDeviceEvent(event);
    },
  });

  capturedCommands.length = 0;
  const fatalCmd = await commandService.issueCommand({
    deviceId,
    type: 'OTA_INSTALL',
    targetVersion: '0.1.30',
    requestedBy: 'operator@hospital.local',
    idempotencyKey: 'idem_fatal_1',
    expiresInSeconds: 600,
  });

  await fatalAgent.handleCommand(capturedCommands[0].payload.payload, { waitForCompletion: true });
  assert(fatalTransitions.includes('ROLLBACK_FAILED'), 'Missing ROLLBACK_FAILED');
  assert(fatalTransitions.includes('RECOVERY_REQUIRED'), 'Missing RECOVERY_REQUIRED');
  console.log('  4.1 Control Agent emitted ROLLBACK_FAILED and RECOVERY_REQUIRED');

  // Verify the command service blocks another install in this simulated state.
  let furtherInstallBlocked = false;
  try {
    await commandService.issueCommand({
      deviceId,
      type: 'OTA_INSTALL',
      targetVersion: '0.1.31',
      requestedBy: 'operator@hospital.local',
      idempotencyKey: 'idem_after_fatal',
    });
  } catch (err) {
    furtherInstallBlocked = true;
    assert(err.message.includes('blocked'), 'Unexpected block message: ' + err.message);
  }
  assert(furtherInstallBlocked, 'Remote install should be completely blocked in RECOVERY_REQUIRED state!');
  console.log('  4.2 Service-level check: another command was blocked in RECOVERY_REQUIRED\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: Service-Level Command Guards
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('[SCENARIO 5] Simulated Command Guard and Idempotency Checks');

  // 5.1 Device Offline Guard
  await deviceRepo.update(deviceId, {
    connectionState: 'OFFLINE',
    lastSeenAt: new Date(Date.now() - 600_000),
    otaState: 'IDLE', // reset ota state for test
  });

  let offlineCommandRejected = false;
  try {
    await commandService.issueCommand({
      deviceId,
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      requestedBy: 'operator@hospital.local',
      idempotencyKey: 'idem_offline_test',
    });
  } catch (err) {
    offlineCommandRejected = true;
    assert.equal(err.code, 'DEVICE_OFFLINE');
  }
  assert(offlineCommandRejected, 'Offline device must not accept commands');
  console.log('  5.1 In-memory offline device: command service rejected OTA_INSTALL');

  // 5.2 Expired command
  await deviceRepo.update(deviceId, { connectionState: 'ONLINE', lastSeenAt: new Date() });
  // Isolate guard checks from the earlier recovery-required command state.
  const guardIdentityStore = new DeviceIdentityStore({
    storagePath: join(testDir, 'device-identity-command-guards.json'),
    appVersion: '0.1.28',
    schemaVersion: 8,
  });
  guardIdentityStore.recordEnrollment(deviceId, enrollmentRes.deviceToken, 'hospital-ward-1');
  const guardAgent = new PrintOpsControlAgent({
    identityStore: guardIdentityStore,
    otaService: mockOtaService,
  });

  const expiredRes = await guardAgent.handleCommand({
    command_id: 'cmd_exp_1',
    device_id: deviceId,
    type: 'OTA_INSTALL',
    target_version: '0.1.29',
    requested_at: new Date(Date.now() - 100_000).toISOString(),
    expires_at: new Date(Date.now() - 5_000).toISOString(),
    requested_by: 'operator@hospital.local',
    idempotency_key: 'idem_exp_1',
  });
  assert.equal(expiredRes.accepted, false);
  assert.equal(expiredRes.reason, 'COMMAND_EXPIRED');
  console.log('  5.2 Direct Control Agent call rejected an expired command');

  // 5.3 Wrong-device command
  const wrongDevRes = await guardAgent.handleCommand({
    command_id: 'cmd_wrong_1',
    device_id: 'dev_some_other_station',
    type: 'OTA_INSTALL',
    target_version: '0.1.29',
    requested_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    requested_by: 'operator@hospital.local',
    idempotency_key: 'idem_wrong_1',
  });
  assert.equal(wrongDevRes.accepted, false);
  assert.equal(wrongDevRes.reason, 'DEVICE_ID_MISMATCH');
  console.log('  5.3 Direct Control Agent call rejected a command for another device');

  // 5.4 Duplicate command
  capturedCommands.length = 0;
  const dup1 = await commandService.issueCommand({
    deviceId,
    type: 'OTA_CHECK',
    requestedBy: 'operator@hospital.local',
    idempotencyKey: 'idem_dup_key_99',
  });
  const dup2 = await commandService.issueCommand({
    deviceId,
    type: 'OTA_CHECK',
    requestedBy: 'operator@hospital.local',
    idempotencyKey: 'idem_dup_key_99',
  });
  assert.equal(dup1.commandId, dup2.commandId, 'Duplicate idempotency key created multiple commands');
  assert.equal(capturedCommands.length, 1, 'Duplicate command published more than once to fake publisher');
  console.log('  5.4 Idempotency check: existing command returned; fake publisher captured one command');

  console.log('\n===============================================================');
  console.log(' SIMULATION ASSERTIONS PASSED — NOT NATIVE ACCEPTANCE          ');
  console.log(' WEB CONTROL NATIVE ACCEPTANCE PENDING                      ');
  console.log('===============================================================\n');

} finally {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
