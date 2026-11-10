import { describe, expect, it } from 'vitest';
import {
  InMemoryControlAuditRepository,
  InMemoryControlCommandRepository,
  InMemoryDeviceRegistryRepository,
} from '../infra/repos/in-memory-control.repo.js';
import { ControlCommandService } from '../services/control-command.service.js';

async function createDeviceRegistry() {
  const devices = new InMemoryDeviceRegistryRepository();
  for (const deviceId of ['dev_a', 'dev_b']) {
    await devices.create({
      deviceId,
      installationId: `inst_${deviceId}`,
      siteId: 'site-test',
      hostname: deviceId,
      platform: 'win32',
      architecture: 'x64',
      appVersion: '0.1.28',
      schemaVersion: 8,
      runnerVersion: '0.1.28',
      deviceTokenHash: 'a'.repeat(64),
    });
  }
  return devices;
}

describe('Control OTA transport safety', () => {
  it('ignores an event for one device that references another device command', async () => {
    const devices = await createDeviceRegistry();
    const commands = new InMemoryControlCommandRepository();
    const audit = new InMemoryControlAuditRepository();
    const service = new ControlCommandService({ commands, devices, audit });
    const command = await commands.create({
      deviceId: 'dev_a',
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      requestedBy: 'operator@example.test',
      idempotencyKey: 'ota-install-1',
    });

    await service.handleDeviceEvent({
      eventId: 'evt-cross-device',
      deviceId: 'dev_b',
      commandId: command.commandId,
      state: 'COMPLETED',
      currentVersion: '0.1.29',
      timestamp: new Date().toISOString(),
    });

    await expect(commands.findById(command.commandId)).resolves.toMatchObject({ status: 'PENDING' });
    await expect(devices.findById('dev_b')).resolves.toMatchObject({ otaState: 'IDLE' });
    await expect(audit.findAll()).resolves.toEqual([]);
  });
  it('does not let a delayed OTA event mark an offline device online', async () => {
    const devices = await createDeviceRegistry();
    const commands = new InMemoryControlCommandRepository();
    const service = new ControlCommandService({ commands, devices });
    const command = await commands.create({
      deviceId: 'dev_a',
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      requestedBy: 'operator@example.test',
      idempotencyKey: 'ota-install-stale-event',
    });
    const lastSeenAt = new Date(Date.now() - 120_000);
    await devices.update('dev_a', { connectionState: 'OFFLINE', lastSeenAt });

    await service.handleDeviceEvent({
      eventId: 'evt-delayed',
      deviceId: 'dev_a',
      commandId: command.commandId,
      state: 'INSTALLING',
      targetVersion: '0.1.29',
      currentVersion: '0.1.28',
      timestamp: new Date().toISOString(),
    });

    await expect(devices.findById('dev_a')).resolves.toMatchObject({
      connectionState: 'OFFLINE',
      lastSeenAt,
      otaState: 'INSTALLING',
    });
  });


  it('ignores terminal events whose target does not match the command', async () => {
    const devices = await createDeviceRegistry();
    const commands = new InMemoryControlCommandRepository();
    const audit = new InMemoryControlAuditRepository();
    const service = new ControlCommandService({ commands, devices, audit });
    const command = await commands.create({
      deviceId: 'dev_a',
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      requestedBy: 'operator@example.test',
      idempotencyKey: 'ota-install-target-check',
    });

    await service.handleDeviceEvent({
      eventId: 'evt-wrong-target',
      deviceId: 'dev_a',
      commandId: command.commandId,
      state: 'COMPLETED',
      targetVersion: '0.1.30',
      currentVersion: '0.1.30',
      timestamp: new Date().toISOString(),
    });

    await expect(commands.findById(command.commandId)).resolves.toMatchObject({ status: 'PENDING' });
    await expect(devices.findById('dev_a')).resolves.toMatchObject({ otaState: 'IDLE' });
    await expect(audit.findAll()).resolves.toEqual([]);
  });

  it('keeps a terminal outcome authoritative over delayed progress and accepts newer local recovery', async () => {
    const devices = await createDeviceRegistry();
    const commands = new InMemoryControlCommandRepository();
    const service = new ControlCommandService({ commands, devices });
    const command = await commands.create({
      deviceId: 'dev_a',
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      requestedBy: 'operator@example.test',
      idempotencyKey: 'ota-install-ordered-events',
    });
    const base = {
      deviceId: 'dev_a',
      commandId: command.commandId,
      targetVersion: '0.1.29',
      currentVersion: '0.1.28',
    };
    await service.handleDeviceEvent({
      ...base, eventId: 'evt-recovery', state: 'RECOVERY_REQUIRED',
      timestamp: '2026-01-01T00:00:03.000Z',
    });
    await service.handleDeviceEvent({
      ...base, eventId: 'evt-delayed-accepted', state: 'ACCEPTED',
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    await service.handleDeviceEvent({
      ...base, eventId: 'evt-delayed-checking', state: 'CHECKING',
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    await expect(commands.findById(command.commandId)).resolves.toMatchObject({
      status: 'FAILED', terminalState: 'RECOVERY_REQUIRED',
    });
    await expect(devices.findById('dev_a')).resolves.toMatchObject({ otaState: 'RECOVERY_REQUIRED' });

    await service.handleDeviceEvent({
      ...base, eventId: 'evt-local-recovery-completed', state: 'COMPLETED',
      timestamp: '2026-01-01T00:00:04.000Z',
    });
    await expect(commands.findById(command.commandId)).resolves.toMatchObject({
      status: 'COMPLETED', terminalState: 'COMPLETED',
    });
    await expect(devices.findById('dev_a')).resolves.toMatchObject({ otaState: 'COMPLETED' });
  });

  it('does not label a Core/best-effort command publish as DELIVERED without PubAck', async () => {
    const devices = await createDeviceRegistry();
    const commands = new InMemoryControlCommandRepository();
    const service = new ControlCommandService({
      commands,
      devices,
      natsPublisher: async () => ({ acknowledged: false }),
    });

    const command = await service.issueCommand({
      deviceId: 'dev_a',
      type: 'OTA_INSTALL',
      targetVersion: '0.1.29',
      requestedBy: 'operator@example.test',
      idempotencyKey: 'ota-install-no-puback',
    });

    expect(command.status).toBe('PENDING');
  });
  it('retries the same pending command after JetStream becomes available', async () => {
    const devices = await createDeviceRegistry();
    const commands = new InMemoryControlCommandRepository();
    const msgIds: string[] = [];
    let attempts = 0;
    const service = new ControlCommandService({
      commands,
      devices,
      natsPublisher: async (_subject, _payload, options) => {
        msgIds.push(options?.msgId ?? '');
        attempts++;
        return { acknowledged: attempts > 1 };
      },
    });
    const input = {
      deviceId: 'dev_a',
      type: 'OTA_INSTALL' as const,
      targetVersion: '0.1.29',
      requestedBy: 'operator@example.test',
      idempotencyKey: 'ota-install-retry-puback',
    };

    const pending = await service.issueCommand(input);
    const delivered = await service.issueCommand(input);

    expect(pending.status).toBe('PENDING');
    expect(delivered).toMatchObject({ commandId: pending.commandId, status: 'DELIVERED' });
    expect(msgIds).toEqual([pending.commandId, pending.commandId]);
    await expect(commands.findByDeviceId('dev_a')).resolves.toHaveLength(1);
  });

});
