import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnyDomainEvent } from '@printerops/domain';
import { ConflictError } from '@printerops/shared';
import { buildApp } from '../app.js';
import { InMemoryRunnerRepository } from '../infra/repos/in-memory-runner.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryDiscoveredPrinterRepository } from '../infra/repos/in-memory-discovered-printer.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { RegisterRunnerService } from '../services/register-runner.service.js';
import { RunnerHeartbeatService } from '../services/runner-heartbeat.service.js';
import { RunnerLifecycleService, isRunnerTerminated } from '../services/runner-lifecycle.service.js';

const RUNNER_A = { name: 'runner-a', hostname: 'host-a', supportedProtocols: ['fake'], metadata: {} };
const RUNNER_B = { name: 'runner-b', hostname: 'host-b', supportedProtocols: ['fake'], metadata: {} };

describe('RunnerLifecycleService', () => {
  let runners: InMemoryRunnerRepository;
  let audit: InMemoryAuditRepository;
  let events: InMemoryEventBus;
  let discovered: InMemoryDiscoveredPrinterRepository;
  let published: AnyDomainEvent[];
  let lifecycle: RunnerLifecycleService;
  let register: RegisterRunnerService;
  let heartbeat: RunnerHeartbeatService;

  beforeEach(() => {
    runners = new InMemoryRunnerRepository();
    audit = new InMemoryAuditRepository();
    events = new InMemoryEventBus();
    discovered = new InMemoryDiscoveredPrinterRepository();
    published = [];
    events.subscribe('RunnerTerminated', (event) => { published.push(event); });
    events.subscribe('RunnerDeleted', (event) => { published.push(event); });
    lifecycle = new RunnerLifecycleService(runners, audit, events, discovered);
    register = new RegisterRunnerService(runners, audit, events);
    heartbeat = new RunnerHeartbeatService(runners, events);
  });

  it('refuses to terminate the only runner that can receive work', async () => {
    const runner = await register.execute({ ...RUNNER_A });
    await expect(lifecycle.terminate(runner.id, 'owner-1')).rejects.toBeInstanceOf(ConflictError);
    expect(isRunnerTerminated((await runners.findById(runner.id))!)).toBe(false);
  });

  it('terminates one runner of two and keeps a usable one', async () => {
    const a = await register.execute({ ...RUNNER_A });
    await register.execute({ ...RUNNER_B });

    const terminated = await lifecycle.terminate(a.id, 'owner-1');
    expect(terminated.status).toBe('offline');
    expect(isRunnerTerminated(terminated)).toBe(true);
    expect(terminated.metadata?.['terminatedBy']).toBe('owner-1');

    const logs = await audit.findAll();
    expect(logs.some((log) => log.action === 'runner.terminated' && log.resourceId === a.id)).toBe(true);
    expect(published.some((event) => event.eventType === 'RunnerTerminated')).toBe(true);
  });

  it('terminating is idempotent for an already terminated runner', async () => {
    const a = await register.execute({ ...RUNNER_A });
    await register.execute({ ...RUNNER_B });
    const once = await lifecycle.terminate(a.id, 'owner-1');
    const twice = await lifecycle.terminate(a.id, 'owner-1');
    expect(twice.metadata).toEqual(once.metadata);
  });

  it('refuses to delete the last usable runner but allows deleting the tombstone', async () => {
    const a = await register.execute({ ...RUNNER_A });
    await expect(lifecycle.remove(a.id, 'owner-1')).rejects.toBeInstanceOf(ConflictError);

    const b = await register.execute({ ...RUNNER_B });
    await lifecycle.terminate(a.id, 'owner-1');

    // b is now the only usable runner, so it still cannot be deleted.
    await expect(lifecycle.remove(b.id, 'owner-1')).rejects.toBeInstanceOf(ConflictError);
    // The terminated record can always be removed; that is how a host revives.
    await lifecycle.remove(a.id, 'owner-1');
    expect(await runners.findById(a.id)).toBeUndefined();
    expect(published.some((event) => event.eventType === 'RunnerDeleted')).toBe(true);
  });

  it('blocks heartbeats, registration and job claims for a terminated runner', async () => {
    const a = await register.execute({ ...RUNNER_A });
    const b = await register.execute({ ...RUNNER_B });
    await lifecycle.terminate(a.id, 'owner-1');

    await expect(heartbeat.execute(a.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(register.execute({ ...RUNNER_A })).rejects.toBeInstanceOf(ConflictError);

    // The untouched runner is unaffected.
    await expect(heartbeat.execute(b.id)).resolves.toMatchObject({ id: b.id, status: 'online' });
  });

  it('counts legacy duplicate rows as a remaining receiver', async () => {
    // Two rows for the same logical runner: removing one leaves a usable record, so the
    // "at least one must remain" rule is not tripped by duplicates the UI already hides.
    const first = await register.execute({ ...RUNNER_A });
    await runners.create({ ...RUNNER_A, id: 'legacy-duplicate' });
    await lifecycle.terminate(first.id, 'owner-1');
    expect(isRunnerTerminated((await runners.findById('legacy-duplicate'))!)).toBe(false);
  });

  it('deletes the removed runner\'s discovered printers and audits how many went', async () => {
    const a = await register.execute({ ...RUNNER_A });
    const b = await register.execute({ ...RUNNER_B });
    for (const name of ['HP LaserJet Pro', 'Zebra ZD420']) {
      await discovered.upsert({
        runnerId: a.id,
        localPrinterName: name,
        connectionType: 'usb',
        isDefault: false,
        isShared: false,
        computerName: 'host-a',
      });
    }
    await discovered.upsert({
      runnerId: b.id,
      localPrinterName: 'HP LaserJet Pro',
      connectionType: 'usb',
      isDefault: false,
      isShared: false,
      computerName: 'host-b',
    });

    // A terminated runner is the normal path (the operator saw it, then removed it).
    await lifecycle.terminate(a.id, 'owner-1');
    await lifecycle.remove(a.id, 'owner-1');

    expect(await discovered.findAll({ runnerId: a.id })).toHaveLength(0);
    // The surviving runner's identical printer is untouched.
    expect(await discovered.findAll({ runnerId: b.id })).toHaveLength(1);

    const log = (await audit.findAll()).find(
      (entry) => entry.action === 'runner.deleted' && entry.resourceId === a.id,
    );
    expect(log?.metadata).toMatchObject({ actor: 'owner-1', discoveredPrintersRemoved: 2 });
  });

  it('still deletes a runner whose discovered printers are already gone', async () => {
    const a = await register.execute({ ...RUNNER_A });
    await register.execute({ ...RUNNER_B });
    await lifecycle.terminate(a.id, 'owner-1');
    await lifecycle.remove(a.id, 'owner-1');

    const log = (await audit.findAll()).find(
      (entry) => entry.action === 'runner.deleted' && entry.resourceId === a.id,
    );
    expect(log?.metadata).toMatchObject({ discoveredPrintersRemoved: 0 });
  });
});

describe('runner terminate/delete routes', () => {
  let app: FastifyInstance;
  let authorization: string;

  beforeEach(async () => {
    process.env['DB_MODE'] = 'memory';
    process.env['PRINTOPS_DEV_SEED'] = 'true';
    const built = await buildApp();
    app = built.app;
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'sysadmin@printerops.local', password: 'Dev-password1!' },
    });
    authorization = `Bearer ${(login.json() as { token: string }).token}`;
  });

  afterEach(async () => {
    await app.close();
  });

  const registerRunner = async (input: typeof RUNNER_A): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/runners/register',
      headers: { authorization },
      payload: input,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  };

  it('refuses to terminate or delete the last runner with a 409 and an explanation', async () => {
    const id = await registerRunner(RUNNER_A);

    const terminate = await app.inject({
      method: 'POST',
      url: `/api/runners/${id}/terminate`,
      headers: { authorization },
    });
    expect(terminate.statusCode).toBe(409);
    expect((terminate.json() as { message: string }).message).toContain('at least one runner must remain');

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/runners/${id}`,
      headers: { authorization },
    });
    expect(remove.statusCode).toBe(409);
    expect(remove.json()).toMatchObject({ error: 'CONFLICT' });
  });

  it('terminates and then deletes a runner once another one exists', async () => {
    const a = await registerRunner(RUNNER_A);
    const b = await registerRunner(RUNNER_B);

    const terminate = await app.inject({
      method: 'POST',
      url: `/api/runners/${a}/terminate`,
      headers: { authorization },
    });
    expect(terminate.statusCode).toBe(200);
    const body = terminate.json() as { status: string; metadata: Record<string, unknown> };
    expect(body.status).toBe('offline');
    expect(body.metadata['terminated']).toBe(true);

    // A terminated runner can no longer claim work, heartbeat, or come back.
    const claim = await app.inject({
      method: 'POST',
      url: `/api/v1/runners/${a}/jobs/next`,
      headers: { authorization },
      payload: {},
    });
    expect(claim.statusCode).toBe(409);

    const legacyPoll = await app.inject({
      method: 'GET',
      url: `/api/runners/${a}/poll`,
      headers: { authorization },
    });
    expect(legacyPoll.statusCode).toBe(409);

    const hb = await app.inject({
      method: 'POST',
      url: `/api/runners/${a}/heartbeat`,
      headers: { authorization },
    });
    expect(hb.statusCode).toBe(409);

    const reRegister = await app.inject({
      method: 'POST',
      url: '/api/runners/register',
      headers: { authorization },
      payload: RUNNER_A,
    });
    expect(reRegister.statusCode).toBe(409);

    // The remaining runner is still claimable (no queued job returns null, not 409).
    const claimB = await app.inject({
      method: 'POST',
      url: `/api/v1/runners/${b}/jobs/next`,
      headers: { authorization },
      payload: {},
    });
    expect(claimB.statusCode).toBe(200);
    expect(claimB.json()).toEqual({ job: null });

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/runners/${a}`,
      headers: { authorization },
    });
    expect(remove.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/runners', headers: { authorization } });
    const remaining = (list.json() as Array<{ id: string }>).map((runner) => runner.id);
    expect(remaining).not.toContain(a);
    expect(remaining).toContain(b);
  });

  it('requires runner:manage for terminate and delete', async () => {
    const id = await registerRunner(RUNNER_A);
    await registerRunner(RUNNER_B);
    const viewerLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'viewer@printerops.local', password: 'Dev-password1!' },
    });
    const viewerAuth = `Bearer ${(viewerLogin.json() as { token: string }).token}`;

    const terminate = await app.inject({
      method: 'POST',
      url: `/api/runners/${id}/terminate`,
      headers: { authorization: viewerAuth },
    });
    expect(terminate.statusCode).toBe(403);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/runners/${id}`,
      headers: { authorization: viewerAuth },
    });
    expect(remove.statusCode).toBe(403);
  });
});
