import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryServiceAccountRepository } from '../infra/repos/in-memory-service-account.repo.js';
import { buildApiKeyAuth, hashApiKey } from '../infra/middleware/api-key.js';
import { serviceAccountRoutes } from '../routes/v1/service-accounts.routes.js';

const apps: ReturnType<typeof Fastify>[] = [];

async function testApp(role: 'OWNER' | 'ADMIN' = 'OWNER') {
  const app = Fastify();
  apps.push(app);
  const serviceAccounts = new InMemoryServiceAccountRepository();
  const audit = new InMemoryAuditRepository();
  await app.register(jwt, { secret: 'service-account-test-secret' });
  await serviceAccountRoutes(app, { serviceAccounts, audit });
  const token = app.jwt.sign({ sub: `${role.toLowerCase()}-id`, email: `${role.toLowerCase()}@example.test`, role });
  return { app, serviceAccounts, audit, authorization: `Bearer ${token}` };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('service-account key lifecycle', () => {
  it('shows plaintext only on create/rotate and audits every mutation', async () => {
    const { app, serviceAccounts, audit, authorization } = await testApp();
    const created = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: { authorization },
      payload: { name: 'Hospital Integration', sourceSystem: 'hospital-system' },
    });
    expect(created.statusCode).toBe(201);
    const firstKey = created.json().apiKey as string;
    expect(firstKey).toMatch(/^po_live_[A-Za-z0-9_-]{43}$/);

    const stored = (await serviceAccounts.findAll())[0]!;
    expect(stored.apiKeyHash).toBe(hashApiKey(firstKey));
    expect(stored.apiKeyHash).not.toContain(firstKey);

    const listed = await app.inject({
      method: 'GET',
      url: '/service-accounts',
      headers: { authorization },
    });
    expect(listed.body).not.toContain(firstKey);
    expect(listed.body).not.toContain(stored.apiKeyHash);

    const rotated = await app.inject({
      method: 'POST',
      url: `/service-accounts/${stored.id}/rotate`,
      headers: { authorization },
    });
    const secondKey = rotated.json().apiKey as string;
    expect(secondKey).not.toBe(firstKey);
    expect((await serviceAccounts.findById(stored.id))?.apiKeyHash).toBe(hashApiKey(secondKey));

    const revoked = await app.inject({
      method: 'POST',
      url: `/service-accounts/${stored.id}/revoke`,
      headers: { authorization },
    });
    expect(revoked.statusCode).toBe(200);
    expect((await serviceAccounts.findById(stored.id))?.isActive).toBe(false);

    const logs = await audit.findAll({ resourceType: 'service_account' });
    expect(logs.map((log) => log.action)).toEqual([
      'service_account.created',
      'service_account.key_rotated',
      'service_account.revoked',
    ]);
    expect(logs.every((log) => log.actorId === 'owner-id' && log.actorEmail === 'owner@example.test')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(firstKey);
    expect(JSON.stringify(logs)).not.toContain(secondKey);
  });

  it('denies administrators because API-key ownership is OWNER-only', async () => {
    const { app, authorization } = await testApp('ADMIN');
    const response = await app.inject({
      method: 'POST',
      url: '/service-accounts',
      headers: { authorization },
      payload: { name: 'Denied', sourceSystem: 'denied-system' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses API-key intake before owner bootstrap and accepts a valid active key afterward', async () => {
    const serviceAccounts = new InMemoryServiceAccountRepository();
    const key = 'po_live_test-key-material';
    const account = await serviceAccounts.create({
      name: 'Test',
      sourceSystem: 'test-system',
      apiKeyHash: hashApiKey(key),
      apiKeyPrefix: key.slice(0, 8),
      isActive: true,
      allowedPrinterCodes: [],
      allowedTemplateCodes: [],
      maxCopiesPerJob: 10,
      maxPayloadBytes: 65_536,
    });
    const app = Fastify();
    apps.push(app);
    let ready = false;
    app.get('/protected', { onRequest: [buildApiKeyAuth(serviceAccounts, async () => ready)] }, async () => ({ ok: true }));

    expect((await app.inject({ method: 'GET', url: '/protected', headers: { 'x-api-key': key } })).statusCode).toBe(503);
    ready = true;
    expect((await app.inject({ method: 'GET', url: '/protected', headers: { 'x-api-key': key } })).statusCode).toBe(200);
    await serviceAccounts.update(account.id, { isActive: false });
    expect((await app.inject({ method: 'GET', url: '/protected', headers: { 'x-api-key': key } })).statusCode).toBe(401);
  });
});
