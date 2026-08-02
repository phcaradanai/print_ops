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

  it('keeps distinct computers separate and hides legacy duplicates from the list', async () => {
    const runners = new InMemoryRunnerRepository();
    await runners.create({ id: 'newest', name: 'desktop-runner', hostname: 'PC_NIPPON', supportedProtocols: [], metadata: {} });
    await runners.create({ id: 'older', name: 'desktop-runner', hostname: 'PC_NIPPON', supportedProtocols: [], metadata: {} });
    await runners.create({ id: 'other-pc', name: 'desktop-runner', hostname: 'PC_LAB', supportedProtocols: [], metadata: {} });

    const visible = latestRunnersByIdentity(await runners.findAll());

    expect(visible.map((runner) => runner.id)).toEqual(['newest', 'other-pc']);
  });
});
