import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { ControlOtaTransitionEvent } from '@printerops/domain';
import { DeviceIdentityStore } from '../services/device-identity.js';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { controlPlaneTransportConfigFromEnv } from '../infra/nats/control-plane-transport.js';

describe('DeviceIdentityStore', () => {
  let tempDir: string;
  let identityPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'printops-dev-identity-'));
    identityPath = join(tempDir, 'device-identity.json');
  });

  afterEach(() => {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('generates a stable installationId on initial startup', () => {
    const store = new DeviceIdentityStore({ storagePath: identityPath });
    const installationId = store.getInstallationId();

    expect(installationId).toMatch(/^inst_/);
    expect(store.isEnrolled()).toBe(false);
    expect(existsSync(identityPath)).toBe(true);

    const identity = store.getIdentity();
    expect(identity.installationId).toBe(installationId);
    expect(identity.platform).toBe(process.platform);
    expect(identity.architecture).toBe(process.arch);
  });

  it('preserves the exact same installationId across application restarts', () => {
    const store1 = new DeviceIdentityStore({ storagePath: identityPath });
    const id1 = store1.getInstallationId();

    // Simulate restart with a new instance using the same path
    const store2 = new DeviceIdentityStore({ storagePath: identityPath });
    const id2 = store2.getInstallationId();

    expect(id2).toBe(id1);
  });

  it('persists enrollment credentials across restarts', () => {
    const store1 = new DeviceIdentityStore({ storagePath: identityPath });
    expect(store1.isEnrolled()).toBe(false);

    store1.recordEnrollment('dev_test_123', 'devtok_secret_abc', 'hospital-ward-1');
    expect(store1.isEnrolled()).toBe(true);
    expect(store1.getDeviceId()).toBe('dev_test_123');
    expect(store1.getDeviceToken()).toBe('devtok_secret_abc');
    expect(store1.getSiteId()).toBe('hospital-ward-1');

    // Simulate restart
    const store2 = new DeviceIdentityStore({ storagePath: identityPath });
    expect(store2.isEnrolled()).toBe(true);
    expect(store2.getDeviceId()).toBe('dev_test_123');
    expect(store2.getDeviceToken()).toBe('devtok_secret_abc');
    expect(store2.getSiteId()).toBe('hospital-ward-1');
    expect(store2.getInstallationId()).toBe(store1.getInstallationId());
  });

  it('clears enrollment while keeping installationId intact', () => {
    const store = new DeviceIdentityStore({ storagePath: identityPath });
    const origInstallationId = store.getInstallationId();

    store.recordEnrollment('dev_test_123', 'devtok_secret_abc');
    expect(store.isEnrolled()).toBe(true);

    store.clearEnrollment();
    expect(store.isEnrolled()).toBe(false);
    expect(store.getDeviceId()).toBeUndefined();
    expect(store.getInstallationId()).toBe(origInstallationId);
  });

  it('reads the control-plane endpoints issued at enrollment', () => {
    // The desktop enrollment command and scripts/enroll-local-control-device.mjs
    // write the identity file directly while no API server is running, so the
    // store has to pick up endpoints it never recorded itself.
    const initial = new DeviceIdentityStore({ storagePath: identityPath });
    const installationId = initial.getInstallationId();
    expect(initial.getControlPlane()).toBeUndefined();

    writeFileSync(identityPath, JSON.stringify({
      installationId,
      siteId: 'hospital-ward-1',
      deviceId: 'dev_test_123',
      deviceToken: 'devtok_secret_abc',
      controlPlane: { natsUrl: 'nats://10.20.0.5:4222', stream: 'PRINTOPS_CONTROL' },
    }, null, 2));

    const enrolled = new DeviceIdentityStore({ storagePath: identityPath });
    expect(enrolled.isEnrolled()).toBe(true);
    expect(enrolled.getControlPlane()).toEqual({
      natsUrl: 'nats://10.20.0.5:4222',
      stream: 'PRINTOPS_CONTROL',
    });

    // An identity from before endpoints were issued keeps working without them.
    writeFileSync(identityPath, JSON.stringify({
      installationId,
      siteId: 'hospital-ward-1',
      deviceId: 'dev_test_123',
      deviceToken: 'devtok_secret_abc',
    }));
    expect(new DeviceIdentityStore({ storagePath: identityPath }).getControlPlane()).toBeUndefined();

    // A half-written block is dropped, not half-applied: handing the transport
    // a broker without its stream would publish into an unknown stream.
    writeFileSync(identityPath, JSON.stringify({
      installationId,
      deviceId: 'dev_test_123',
      deviceToken: 'devtok_secret_abc',
      controlPlane: { natsUrl: 'nats://10.20.0.5:4222' },
    }));
    expect(new DeviceIdentityStore({ storagePath: identityPath }).getControlPlane()).toBeUndefined();
  });

  it('uses the issued endpoints unless a complete NATS pair overrides them', () => {
    writeFileSync(identityPath, JSON.stringify({
      installationId: 'inst_issued',
      siteId: 'hospital-ward-1',
      deviceId: 'dev_test_123',
      deviceToken: 'devtok_secret_abc',
      controlPlane: { natsUrl: 'nats://10.20.0.5:4222', stream: 'ISSUED_STREAM' },
    }));
    const enrolled = new DeviceIdentityStore({ storagePath: identityPath });
    const role = { role: 'device', deviceId: 'dev_test_123' } as const;

    // An unconfigured workstation reaches the plane on the enrolled broker.
    expect(controlPlaneTransportConfigFromEnv(role, enrolled.controlPlaneEnv({}))).toMatchObject({
      role: 'device',
      url: 'nats://10.20.0.5:4222',
      stream: 'ISSUED_STREAM',
    });

    expect(controlPlaneTransportConfigFromEnv(role, enrolled.controlPlaneEnv({
      PRINTOPS_CONTROL_NATS_URL: 'nats://192.168.1.9:4222',
      PRINTOPS_CONTROL_NATS_STREAM: 'OTHER_STREAM',
    }))).toMatchObject({
      url: 'nats://192.168.1.9:4222',
      stream: 'OTHER_STREAM',
    });

    // A half-set pair is a misconfiguration, never completed from the identity.
    expect(controlPlaneTransportConfigFromEnv(role, enrolled.controlPlaneEnv({
      PRINTOPS_CONTROL_NATS_STREAM: 'OTHER_STREAM',
    }))).toBeUndefined();
    expect(() => controlPlaneTransportConfigFromEnv(role, enrolled.controlPlaneEnv({
      PRINTOPS_CONTROL_NATS_URL: 'nats://192.168.1.9:4222',
    }))).toThrow(/PRINTOPS_CONTROL_NATS_STREAM/);

    const unenrolled = new DeviceIdentityStore({ storagePath: join(tempDir, 'unenrolled.json') });
    expect(controlPlaneTransportConfigFromEnv(role, unenrolled.controlPlaneEnv({}))).toBeUndefined();
  });

  it('persists OTA command identity and pending transition outbox across restarts', () => {
    const store = new DeviceIdentityStore({ storagePath: identityPath });
    const event: ControlOtaTransitionEvent = {
      eventId: 'evt_restart_pending',
      deviceId: 'dev_test_123',
      commandId: 'cmd_update_123',
      state: 'RESTARTING',
      targetVersion: '0.1.29',
      currentVersion: '0.1.28',
      timestamp: new Date().toISOString(),
    };
    const acceptedEvent: ControlOtaTransitionEvent = {
      ...event,
      eventId: 'evt_command_accepted',
      state: 'ACCEPTED',
    };
    store.persistControlTransitions([acceptedEvent], {
      idempotencyKey: 'idem_update_123',
      commandType: 'OTA_INSTALL',
      targetVersion: '0.1.29',
    });
    store.persistControlTransitions([event], { localOtaState: 'RESTART_PENDING' });
    store.markControlCommandStarted('cmd_update_123');

    const restartedStore = new DeviceIdentityStore({ storagePath: identityPath });
    expect(restartedStore.getCurrentControlCommand()).toMatchObject({
      commandId: 'cmd_update_123',
      idempotencyKey: 'idem_update_123',
      commandType: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      lastAuthoritativeOtaState: 'RESTARTING',
      lastLocalOtaState: 'RESTART_PENDING',
      replayStatus: 'PROCESSING',
      executionStarted: true,
    });
    expect(restartedStore.getControlCommand('another-command', 'idem_update_123')?.commandId)
      .toBe('cmd_update_123');
    expect(restartedStore.getPendingControlEvents()).toEqual([acceptedEvent, event]);

    restartedStore.acknowledgeControlEvent(acceptedEvent.eventId);
    restartedStore.acknowledgeControlEvent(event.eventId);
    expect(restartedStore.getPendingControlEvents()).toEqual([]);
  });

  it('exposes the latest command transition written by the standalone agent', () => {
    const apiStore = new DeviceIdentityStore({ storagePath: identityPath });
    const sidecarStore = new DeviceIdentityStore({ storagePath: identityPath });
    const acceptedAt = '2026-10-02T08:00:00.000Z';
    const completedAt = '2026-10-02T08:00:05.000Z';

    sidecarStore.persistControlTransitions([{
      eventId: 'evt_content_accepted',
      deviceId: 'dev_test_123',
      commandId: 'cmd_content_123',
      state: 'ACCEPTED',
      currentVersion: '0.1.31',
      timestamp: acceptedAt,
    }], { commandType: 'CONTENT_SYNC' });
    sidecarStore.persistControlTransitions([{
      eventId: 'evt_content_completed',
      deviceId: 'dev_test_123',
      commandId: 'cmd_content_123',
      state: 'COMPLETED',
      currentVersion: '0.1.31',
      timestamp: completedAt,
    }], { commandType: 'CONTENT_SYNC' });

    const latestCommand = apiStore.getLatestControlCommand();
    expect(latestCommand).toMatchObject({
      commandId: 'cmd_content_123',
      commandType: 'CONTENT_SYNC',
      lastCommandState: 'COMPLETED',
      lastCommandAt: completedAt,
      replayStatus: 'PROCESSED',
    });
    expect(latestCommand?.lastAuthoritativeOtaState).toBeUndefined();
    expect(latestCommand?.lastAuthoritativeOtaAt).toBeUndefined();
  });
});
