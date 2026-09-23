import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryDeviceRegistryRepository,
  InMemoryEnrollmentTokenRepository,
  InMemoryControlAuditRepository,
} from '../infra/repos/in-memory-control.repo.js';
import { WebControlRegistryService } from '../services/web-control-registry.service.js';
import { ConflictError, NotFoundError } from '@printerops/shared';

describe('WebControlRegistryService - Enrollment & Identity', () => {
  let deviceRepo: InMemoryDeviceRegistryRepository;
  let tokenRepo: InMemoryEnrollmentTokenRepository;
  let auditRepo: InMemoryControlAuditRepository;
  let service: WebControlRegistryService;

  beforeEach(() => {
    deviceRepo = new InMemoryDeviceRegistryRepository();
    tokenRepo = new InMemoryEnrollmentTokenRepository();
    auditRepo = new InMemoryControlAuditRepository();
    service = new WebControlRegistryService({
      deviceRegistry: deviceRepo,
      enrollmentTokens: tokenRepo,
      audit: auditRepo,
      config: {
        natsUrl: 'nats://control.printops.local:4222',
        staleThresholdMs: 1_000,
        offlineThresholdMs: 2_000,
      },
    });
  });

  it('generates an enrollment token with siteId and expiration', async () => {
    const token = await service.createEnrollmentToken({
      siteId: 'ward-east-3',
      createdBy: 'admin@hospital.local',
      expiresInSeconds: 1800,
    });

    expect(token.token).toMatch(/^enroll_/);
    expect(token.siteId).toBe('ward-east-3');
    expect(token.createdBy).toBe('admin@hospital.local');
    expect(token.consumedAt).toBeNull();
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects enrollment with non-existent token', async () => {
    await expect(
      service.enrollDevice({
        enrollmentToken: 'enroll_nonexistent',
        installationId: 'inst_abc123',
        hostname: 'station-01',
        platform: 'win32',
        architecture: 'x64',
        appVersion: '0.1.28',
        schemaVersion: 7,
        runnerVersion: '0.1.28',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('successfully enrolls a device and returns credentials and control subjects', async () => {
    const token = await service.createEnrollmentToken({
      siteId: 'pharmacy-1',
      createdBy: 'admin@hospital.local',
    });

    const res = await service.enrollDevice({
      enrollmentToken: token.token,
      installationId: 'inst_station_42',
      hostname: 'pharm-print-01',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 7,
      runnerVersion: '0.1.28',
    });

    expect(res.deviceId).toMatch(/^dev_/);
    expect(res.installationId).toBe('inst_station_42');
    expect(res.siteId).toBe('pharmacy-1');
    expect(res.deviceToken).toMatch(/^devtok_/);
    expect(res.controlPlane.natsUrl).toBe('nats://control.printops.local:4222');
    expect(res.controlPlane.commandSubject).toBe(`printops.control.command.${res.deviceId}`);
    expect(res.controlPlane.eventSubject).toBe(`printops.control.event.${res.deviceId}`);
    expect(res.controlPlane.heartbeatSubject).toBe(`printops.control.heartbeat.${res.deviceId}`);

    // Verify token consumed
    const updatedToken = await tokenRepo.findByToken(token.token);
    expect(updatedToken?.consumedAt).not.toBeNull();
    expect(updatedToken?.consumedByDeviceId).toBe(res.deviceId);

    // Verify device in registry
    const device = await service.getDevice(res.deviceId);
    expect(device).toBeDefined();
    expect(device?.hostname).toBe('pharm-print-01');
    expect(device?.connectionState).toBe('ONLINE');

    // Verify audit log
    const auditLogs = await auditRepo.findByDeviceId(res.deviceId);
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0]!.action).toBe('device.enrolled');
  });

  it('prevents replay: one-time enrollment token cannot be consumed twice', async () => {
    const token = await service.createEnrollmentToken({
      siteId: 'lab-2',
      createdBy: 'admin@hospital.local',
    });

    await service.enrollDevice({
      enrollmentToken: token.token,
      installationId: 'inst_lab_01',
      hostname: 'lab-pc',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 7,
      runnerVersion: '0.1.28',
    });

    // Attempt second enrollment with same token
    await expect(
      service.enrollDevice({
        enrollmentToken: token.token,
        installationId: 'inst_lab_02',
        hostname: 'lab-pc-2',
        platform: 'win32',
        architecture: 'x64',
        appVersion: '0.1.28',
        schemaVersion: 7,
        runnerVersion: '0.1.28',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('authenticates device with valid token and rejects invalid token', async () => {
    const token = await service.createEnrollmentToken({
      siteId: 'icu-1',
      createdBy: 'admin@hospital.local',
    });

    const enrolled = await service.enrollDevice({
      enrollmentToken: token.token,
      installationId: 'inst_icu_01',
      hostname: 'icu-pc',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 7,
      runnerVersion: '0.1.28',
    });

    // Correct token
    const authSuccess = await service.authenticateDevice(enrolled.deviceId, enrolled.deviceToken);
    expect(authSuccess).not.toBeNull();
    expect(authSuccess?.deviceId).toBe(enrolled.deviceId);

    // Wrong token
    const authWrong = await service.authenticateDevice(enrolled.deviceId, 'devtok_wrong_secret_123');
    expect(authWrong).toBeNull();

    // Unknown device
    const authUnknown = await service.authenticateDevice('dev_unknown', enrolled.deviceToken);
    expect(authUnknown).toBeNull();
  });

  it('tracks heartbeats and transitions connectionState from ONLINE to STALE to OFFLINE', async () => {
    const token = await service.createEnrollmentToken({
      siteId: 'er-1',
      createdBy: 'admin@hospital.local',
    });

    const enrolled = await service.enrollDevice({
      enrollmentToken: token.token,
      installationId: 'inst_er_01',
      hostname: 'er-pc',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 7,
      runnerVersion: '0.1.28',
    });

    // Record heartbeat
    const nowIso = new Date().toISOString();
    await service.recordHeartbeat({
      deviceId: enrolled.deviceId,
      installationId: enrolled.installationId,
      siteId: enrolled.siteId,
      hostname: 'er-pc',
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 7,
      runnerVersion: '0.1.28',
      runnerStatus: 'RUNNING',
      printReadinessSummary: 'READY',
      printState: 'IDLE',
      otaState: 'IDLE',
      lastOtaOperation: null,
      timestamp: nowIso,
    });

    let device = await service.getDevice(enrolled.deviceId);
    expect(device?.connectionState).toBe('ONLINE');

    // Simulate STALE (older than 1000ms)
    await deviceRepo.update(enrolled.deviceId, {
      lastSeenAt: new Date(Date.now() - 1_200),
    });
    device = await service.getDevice(enrolled.deviceId);
    expect(device?.connectionState).toBe('STALE');

    // Simulate OFFLINE (older than 2000ms)
    await deviceRepo.update(enrolled.deviceId, {
      lastSeenAt: new Date(Date.now() - 2_500),
    });
    device = await service.getDevice(enrolled.deviceId);
    expect(device?.connectionState).toBe('OFFLINE');
  });
});
