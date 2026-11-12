import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { InMemoryNetworkPrinterSearchRepository } from '../infra/repos/in-memory-network-printer-search.repo.js';
import { SqliteNetworkPrinterSearchRepository } from '../infra/repos/sqlite/sqlite-network-printer-search.repo.js';
import { InMemoryRunnerRepository } from '../infra/repos/in-memory-runner.repo.js';
import { InMemoryDiscoveredPrinterRepository } from '../infra/repos/in-memory-discovered-printer.repo.js';
import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { RbacPermissionPolicy } from '../infra/permission/rbac-permission.policy.js';
import { CheckPermissionService } from '../services/check-permission.service.js';
import { RegisterDiscoveredPrinterService } from '../services/register-discovered-printer.service.js';
import { NetworkPrinterSearchService, parseNetworkTargets } from '../services/network-printer-search.service.js';
import { v1NetworkPrinterSearchRoutes } from '../routes/v1/network-printer-search.routes.js';
import { closeDatabase, initDatabase } from '../infra/db/sqlite.js';
import type { NetworkPrinterSearchRepositoryPort } from '@printerops/domain';

const require = createRequire(import.meta.url);
process.env['SQL_WASM_PATH'] = require.resolve('sql.js/dist/sql-wasm.wasm');

describe('network targets', () => {
  it('normalizes CIDR host bits and deduplicates overlapping targets', () => {
    expect(parseNetworkTargets('10.4.0.3/30,10.4.0.2-10.4.0.4')).toEqual([
      '10.4.0.0', '10.4.0.1', '10.4.0.2', '10.4.0.3', '10.4.0.4',
    ]);
    expect(parseNetworkTargets('192.168.1.25/24')).toHaveLength(256);
    expect(parseNetworkTargets('255.255.255.255')).toEqual(['255.255.255.255']);
  });
  it.each(['', 'printer.local', '10.0.0.256', '10.0.0.2-10.0.0.1', '0.0.0.0/0', '10.0.0.1/23', '10.0.0.1/33', '10.0.0.1/1.5'])('rejects invalid or oversized input %s', (input) => {
    expect(() => parseNetworkTargets(input)).toThrow();
  });
});

for (const storage of ['memory', 'sqlite'] as const) {
  describe.sequential(`network searches (${storage})`, () => {
    let repo: NetworkPrinterSearchRepositoryPort;
    let runners: InMemoryRunnerRepository;
    let discovered: InMemoryDiscoveredPrinterRepository;
    let audit: InMemoryAuditRepository;
    let service: NetworkPrinterSearchService;
    let now: number;
    let dir: string;

    beforeEach(async () => {
      now = Date.parse('2026-11-12T00:00:00Z');
      if (storage === 'sqlite') {
        dir = mkdtempSync(join(tmpdir(), 'printops-search-'));
        process.env['PRINTOPS_DB_PATH'] = join(dir, 'test.db');
        await initDatabase();
      }
      repo = storage === 'sqlite' ? new SqliteNetworkPrinterSearchRepository() : new InMemoryNetworkPrinterSearchRepository();
      runners = new InMemoryRunnerRepository();
      discovered = new InMemoryDiscoveredPrinterRepository();
      audit = new InMemoryAuditRepository();
      await runners.create({ id: 'r1', name: 'VPN', hostname: 'vpn-pc', supportedProtocols: [], metadata: { network_printer_search: true } });
      service = new NetworkPrinterSearchService(repo, runners, discovered, audit, () => new Date(now));
    });
    afterEach(() => {
      if (storage === 'sqlite') {
        closeDatabase();
        delete process.env['PRINTOPS_DB_PATH'];
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('allows one queued search and one claimant under concurrent requests', async () => {
      const starts = await Promise.allSettled([service.start('r1', '10.0.0.1', 'admin'), service.start('r1', '10.0.0.2', 'admin')]);
      expect(starts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const claims = await Promise.all([service.claim('r1'), service.claim('r1')]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)?.claimToken).toBeTruthy();
      expect((await service.latest('r1'))?.state).toBe('RUNNING');
    });

    it('persists claims across repository instances', async () => {
      if (storage !== 'sqlite') return;
      const search = await service.start('r1', '10.0.0.1', 'admin');
      await service.claim('r1');
      const reopened = new SqliteNetworkPrinterSearchRepository();
      expect((await reopened.findById(search.id, new Date(now)))?.state).toBe('RUNNING');
      expect(await reopened.claim('r1', new Date(now))).toBeUndefined();
      closeDatabase();
      await initDatabase();
      expect((await reopened.findById(search.id, new Date(now)))?.state).toBe('RUNNING');
    });

    it('expires unclaimed work and rejects late results after lease expiry', async () => {
      const queued = await service.start('r1', '10.0.0.1', 'admin');
      now += 120_001;
      expect((await service.get(queued.id)).state).toBe('EXPIRED');
      expect(await service.claim('r1')).toBeUndefined();
      const next = await service.start('r1', '10.0.0.1', 'admin');
      const claim = (await service.claim('r1'))!;
      now += 75_001;
      await expect(service.finish('r1', next.id, claim.claimToken!, ['10.0.0.1'], false)).rejects.toThrow();
      expect(await discovered.findAll()).toHaveLength(0);
    });

    it('rejects old Runners, missing Runners and unrequested result addresses', async () => {
      await runners.update('r1', { metadata: {} });
      await expect(service.start('r1', '10.0.0.1', 'admin')).rejects.toThrow();
      await expect(service.start('missing', '10.0.0.1', 'admin')).rejects.toThrow();
      await runners.update('r1', { metadata: { network_printer_search: true } });
      const search = await service.start('r1', '10.0.0.1', 'admin');
      const claim = (await service.claim('r1'))!;
      await expect(service.finish('r2', search.id, claim.claimToken!, ['10.0.0.1'], false)).rejects.toThrow();
      await expect(service.finish('r1', search.id, 'wrong', ['10.0.0.1'], false)).rejects.toThrow();
      await expect(service.finish('r1', search.id, claim.claimToken!, ['10.0.0.2'], false)).rejects.toThrow();
    });

    it('registers TCP candidates and preserves registration through repeated scans and result retries', async () => {
      const search = await service.start('r1', '10.0.0.1', 'admin');
      const claim = (await service.claim('r1'))!;
      const result = await service.finish('r1', search.id, claim.claimToken!, ['10.0.0.1'], false);
      expect(result.state).toBe('COMPLETED');
      const dp = (await discovered.findAll())[0]!;
      const printers = new InMemoryPrinterRepository();
      const register = new RegisterDiscoveredPrinterService(discovered, printers, audit,
        new CheckPermissionService(new RbacPermissionPolicy(), new InMemoryEventBus()));
      const printer = await register.execute(dp.id, { userId: 'admin', role: 'ADMIN' });
      expect(printer.protocol).toBe('raw_tcp_9100');
      expect(printer.connectionUri).toBe('tcp://10.0.0.1:9100');
      expect(printer.metadata['runnerId']).toBe('r1');
      await service.finish('r1', search.id, claim.claimToken!, ['10.0.0.1'], false);
      const next = await service.start('r1', '10.0.0.1', 'admin');
      const nextClaim = (await service.claim('r1'))!;
      await service.finish('r1', next.id, nextClaim.claimToken!, ['10.0.0.1'], false);
      expect(await discovered.findAll()).toHaveLength(1);
      expect((await discovered.findById(dp.id))?.registeredPrinterId).toBe(printer.id);
    });

    it('keeps partial results while reporting an incomplete search', async () => {
      const search = await service.start('r1', '10.0.0.1-10.0.0.2', 'admin');
      const claim = (await service.claim('r1'))!;
      expect((await service.finish('r1', search.id, claim.claimToken!, ['10.0.0.1'], true)).state).toBe('FAILED');
      expect(await discovered.findAll()).toHaveLength(1);
    });

    it('registers different addresses whose digits would collide if dots were removed', async () => {
      const search = await service.start('r1', '10.1.0.11,10.10.1.1', 'admin');
      const claim = (await service.claim('r1'))!;
      await service.finish('r1', search.id, claim.claimToken!, ['10.1.0.11', '10.10.1.1'], false);
      const printers = new InMemoryPrinterRepository();
      const register = new RegisterDiscoveredPrinterService(discovered, printers, audit,
        new CheckPermissionService(new RbacPermissionPolicy(), new InMemoryEventBus()));
      for (const dp of await discovered.findAll()) await register.execute(dp.id, { userId: 'admin', role: 'ADMIN' });
      expect(await printers.findAll()).toHaveLength(2);
    });

    it('rejects malformed network endpoints at registration', async () => {
      const dp = await discovered.upsert({ runnerId: 'r1', localPrinterName: 'TCP candidate', connectionType: 'tcp_ip',
        isDefault: false, isShared: false, attributes: { discoverySource: 'network_scan', networkAddress: 'not-an-ip', networkPort: 9100 } });
      const printers = new InMemoryPrinterRepository();
      const register = new RegisterDiscoveredPrinterService(discovered, printers, audit,
        new CheckPermissionService(new RbacPermissionPolicy(), new InMemoryEventBus()));
      await expect(register.execute(dp.id, { userId: 'admin', role: 'ADMIN' })).rejects.toThrow('Invalid network printer endpoint');
      expect(await printers.findAll()).toHaveLength(0);
    });

    it('guards operator and Runner routes, and never reveals claim credentials to dashboard readers', async () => {
      const app = Fastify();
      await app.register(jwt, { secret: 'network-search-test-secret-long-enough' });
      await v1NetworkPrinterSearchRoutes(app, { searches: service });
      const headers = (role: string, kind?: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub: 'test', role, kind })}` });
      try {
        const url = '/runners/r1/printer-searches';
        expect((await app.inject({ method: 'POST', url, payload: { targets: '10.0.0.1' }, headers: headers('VIEWER') })).statusCode).toBe(403);
        expect((await app.inject({ method: 'POST', url, payload: { targets: '10.0.0.1' }, headers: headers('ADMIN', 'runner') })).statusCode).toBe(403);
        const start = await app.inject({ method: 'POST', url, payload: { targets: '10.0.0.1' }, headers: headers('ADMIN') });
        expect(start.statusCode).toBe(202);
        expect((await app.inject({ method: 'POST', url: `${url}/claim`, headers: headers('VIEWER') })).statusCode).toBe(403);
        const claim = await app.inject({ method: 'POST', url: `${url}/claim`, headers: headers('ADMIN', 'runner') });
        expect(claim.statusCode).toBe(200);
        expect(claim.json().claimToken).toBeTruthy();
        const read = await app.inject({ url: `/printer-searches/${start.json().id}`, headers: headers('VIEWER') });
        expect(read.statusCode).toBe(200);
        expect(read.json().claimToken).toBeUndefined();
        const report = await app.inject({ method: 'POST', url: `${url}/${start.json().id}/results`,
          headers: headers('ADMIN', 'runner'), payload: { claimToken: claim.json().claimToken, addresses: ['10.0.0.1'], incomplete: false } });
        expect(report.statusCode).toBe(200);
        expect(report.json().state).toBe('COMPLETED');
        expect(report.json().claimToken).toBeUndefined();
        expect((await discovered.findAll())[0]?.portName).toBe('10.0.0.1:9100');
      } finally { await app.close(); }
    });
  });
}
