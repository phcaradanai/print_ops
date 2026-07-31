import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryUserRepository } from '../infra/repos/in-memory-user.repo.js';
import { authRoutes } from '../routes/auth.routes.js';
import { hashPassword, validatePassword, verifyPassword } from '../infra/auth/password.js';

const apps: ReturnType<typeof Fastify>[] = [];

async function authApp(users = new InMemoryUserRepository(), runnerBootstrapSecret?: string) {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'test-jwt-secret-that-is-not-production' });
  app.decorate('authenticate', async (req: Parameters<typeof app.authenticate>[0], reply: Parameters<typeof app.authenticate>[1]) => {
    try { await req.jwtVerify(); } catch (error) { reply.send(error); }
  });
  await authRoutes(app, { users, runnerBootstrapSecret });
  return { app, users };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('production password handling', () => {
  it('enforces the documented password policy and verifies only scrypt hashes', async () => {
    expect(validatePassword('short')).toEqual({ valid: false, error: expect.any(String) });
    const encoded = await hashPassword('Strong-password1!');
    expect(encoded).toMatch(/^scrypt\$/);
    expect(await verifyPassword('Strong-password1!', encoded)).toBe(true);
    expect(await verifyPassword('Wrong-password1!', encoded)).toBe(false);
    expect(await verifyPassword('Strong-password1!', 'plaintext')).toBe(false);
    expect(encoded).not.toContain('Strong-password1!');
  });
});

describe('owner bootstrap', () => {
  it('creates exactly one owner and disables bootstrap', async () => {
    const { app, users } = await authApp();
    const before = await app.inject({ method: 'GET', url: '/auth/bootstrap' });
    expect(before.json()).toEqual({ state: 'REQUIRED_NEW', ownerEmailHints: [] });

    const payload = {
      name: 'Pilot Owner',
      email: 'owner@example.test',
      password: 'Strong-password1!',
      passwordConfirmation: 'Strong-password1!',
    };
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/bootstrap', payload }),
      app.inject({ method: 'POST', url: '/auth/bootstrap', payload }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect((await users.findAll()).filter((user) => user.role === 'OWNER')).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/auth/bootstrap' })).json()).toEqual({ state: 'READY', ownerEmailHints: [] });
  });

  it('requires the existing owner email when migrating a passwordless database', async () => {
    const users = new InMemoryUserRepository();
    users.seed({
      id: 'legacy-owner',
      email: 'legacy@example.test',
      name: 'Legacy',
      role: 'OWNER',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = await authApp(users);
    expect((await app.inject({ method: 'GET', url: '/auth/bootstrap' })).json()).toEqual({
      state: 'MIGRATION_REQUIRED',
      ownerEmailHints: ['l*****@example.test'],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/auth/bootstrap',
      payload: {
        name: 'Attacker',
        email: 'other@example.test',
        password: 'Strong-password1!',
        passwordConfirmation: 'Strong-password1!',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message ?? response.json().error).toMatch(/l\*+@example\.test/);
    expect(await users.findByEmail('other@example.test')).toBeUndefined();
  });

  it('never authenticates passwordless or plaintext legacy users', async () => {
    const users = new InMemoryUserRepository();
    users.seed({
      id: 'legacy',
      email: 'legacy@example.test',
      name: 'Legacy',
      passwordHash: 'legacy-plaintext',
      role: 'OWNER',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = await authApp(users);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'legacy@example.test', password: 'legacy-plaintext' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('packaged runner bootstrap credential', () => {
  it('issues a JWT only for the exact per-installation secret', async () => {
    const { app } = await authApp(undefined, 'runner-secret-123');
    expect((await app.inject({
      method: 'POST',
      url: '/auth/runner',
      payload: { secret: 'wrong' },
    })).statusCode).toBe(401);
    const valid = await app.inject({
      method: 'POST',
      url: '/auth/runner',
      payload: { secret: 'runner-secret-123' },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().token).toEqual(expect.any(String));
  });
});
