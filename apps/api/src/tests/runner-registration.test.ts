import { describe, expect, it } from 'vitest';
import { InMemoryRunnerRepository } from '../infra/repos/in-memory-runner.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { RegisterRunnerService } from '../services/register-runner.service.js';
import { latestRunnersByIdentity } from '../routes/runner.routes.js';

describe('runner registration identity', () => {
  it('reuses a runner when the same desktop host reconnects', async () => {
    const runners = new InMemoryRunnerRepository();
    const audits = new InMemoryAuditRepository();
    const service = new RegisterRunnerService(runners, audits, new InMemoryEventBus());

    const first = await service.execute({
      name: 'desktop-runner',
      hostname: 'PC_NIPPON',
      supportedProtocols: ['windows-spooler'],
      metadata: { version: '0.1.0' },
    });
    const restarted = await service.execute({
      name: 'desktop-runner',
      hostname: 'PC_NIPPON',
      supportedProtocols: ['windows-spooler', 'raw-tcp-9100'],
      metadata: { version: '0.1.1' },
    });

    expect(restarted.id).toBe(first.id);
    expect(await runners.findAll()).toHaveLength(1);
    expect(restarted.supportedProtocols).toEqual(['windows-spooler', 'raw-tcp-9100']);
    expect(restarted.metadata).toEqual({ version: '0.1.1' });
    expect(restarted.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it('reuses the runner when its hostname changes, as a recreated container does', async () => {
    const runners = new InMemoryRunnerRepository();
    const audits = new InMemoryAuditRepository();
    const service = new RegisterRunnerService(runners, audits, new InMemoryEventBus());

    const first = await service.execute({
      name: 'printops-runner-vm1',
      hostname: '8280db9e3559',
      supportedProtocols: [],
      metadata: {},
    });
    const redeployed = await service.execute({
      name: 'printops-runner-vm1',
      hostname: '129f628dc5df',
      supportedProtocols: [],
      metadata: {},
    });

    expect(redeployed.id).toBe(first.id);
    expect(redeployed.hostname).toBe('129f628dc5df');
    expect(await runners.findAll()).toHaveLength(1);
  });

  it('lists one card per runner name, preferring the newest activity', async () => {
    const runners = new InMemoryRunnerRepository();
    await runners.create({ id: 'older', name: 'desktop-runner', hostname: 'OLD-HOST', supportedProtocols: [], metadata: {} });
    await runners.create({ id: 'newest', name: 'desktop-runner', hostname: 'NEW-HOST', supportedProtocols: [], metadata: {} });
    await runners.create({ id: 'other-pc', name: 'lab-runner', hostname: 'PC_LAB', supportedProtocols: [], metadata: {} });
    // A heartbeat makes the newest record win even when it is listed first or last.
    await runners.update('newest', { lastHeartbeatAt: new Date('2026-11-19T05:00:00Z') });
    await runners.update('older', { lastHeartbeatAt: new Date('2026-11-18T05:00:00Z') });

    const visible = latestRunnersByIdentity(await runners.findAll());

    expect(visible.map((runner) => runner.id).sort()).toEqual(['newest', 'other-pc']);
  });

  it('refuses to resurrect a runner an operator terminated', async () => {
    const runners = new InMemoryRunnerRepository();
    const audits = new InMemoryAuditRepository();
    const service = new RegisterRunnerService(runners, audits, new InMemoryEventBus());
    const first = await service.execute({
      name: 'desktop-runner',
      hostname: 'PC_NIPPON',
      supportedProtocols: [],
      metadata: {},
    });
    await runners.update(first.id, { status: 'offline', metadata: { ...first.metadata, terminated: true } });

    await expect(service.execute({
      name: 'desktop-runner',
      hostname: 'PC_NIPPON_REBUILT',
      supportedProtocols: [],
      metadata: {},
    })).rejects.toThrow(/terminated by an operator/);
  });
});
