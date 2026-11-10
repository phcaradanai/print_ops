import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryUserRepository } from '../infra/repos/in-memory-user.repo.js';
import { hashPassword, verifyPassword } from '../infra/auth/password.js';
import { authRoutes } from '../routes/auth.routes.js';

const apps: ReturnType<typeof Fastify>[] = [];
const initialPassword = 'Original-password1!';
const resetPassword = 'Replacement-password2!';

async function recoveryApp(users = new InMemoryUserRepository()) {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'test-jwt-secret-that-is-not-production' });
  app.decorate('authenticate', async (req: Parameters<typeof app.authenticate>[0], reply: Parameters<typeof app.authenticate>[1]) => {
    try { await req.jwtVerify(); } catch (error) { reply.send(error); }
  });
  await authRoutes(app, { users });
  return { app, users };
}

async function createOwner(users: InMemoryUserRepository, email: string) {
  users.seed({
    id: `owner-${email}`,
    email,
    name: 'Owner',
    passwordHash: await hashPassword(initialPassword),
    role: 'OWNER',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function login(app: Awaited<ReturnType<typeof recoveryApp>>['app'], email: string, password = initialPassword) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('account-scoped password recovery', () => {
  it('uses a one-time code and keeps identical emails separate between API instances', async () => {
    const appUsers = new InMemoryUserRepository();
    const webControlUsers = new InMemoryUserRepository();
    const email = 'owner@example.test';
    await createOwner(appUsers, email);
    await createOwner(webControlUsers, email);
    const appApi = await recoveryApp(appUsers);
    const webControlApi = await recoveryApp(webControlUsers);

    const appLogin = await login(appApi.app, email);
    const webControlLogin = await login(webControlApi.app, email);
    expect(appLogin.statusCode).toBe(200);
    expect(webControlLogin.statusCode).toBe(200);

    const appRecovery = await appApi.app.inject({
      method: 'POST',
      url: '/auth/recovery-code',
      headers: { authorization: `Bearer ${appLogin.json().token}` },
    });
    expect(appRecovery.statusCode).toBe(200);
    expect(appRecovery.headers['cache-control']).toBe('no-store');
    const code = appRecovery.json().recoveryCode as string;
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const crossInstanceAttempt = await webControlApi.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email, recoveryCode: code, newPassword: resetPassword },
    });
    expect(crossInstanceAttempt.statusCode).toBe(400);
    expect((await login(webControlApi.app, email)).statusCode).toBe(200);

    const reset = await appApi.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email, recoveryCode: code, newPassword: resetPassword },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.headers['cache-control']).toBe('no-store');
    const nextRecoveryCode = reset.json().recoveryCode as string;
    expect(nextRecoveryCode).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const oldCodeReuse = await appApi.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email, recoveryCode: code, newPassword: 'Third-password3!' },
    });
    expect(oldCodeReuse.statusCode).toBe(400);
    expect((await login(appApi.app, email)).statusCode).toBe(401);
    const updatedLogin = await login(appApi.app, email, resetPassword);
    expect(updatedLogin.statusCode).toBe(200);
    expect(appApi.app.jwt.verify<{ authVersion: number }>(updatedLogin.json().token).authVersion).toBe(1);
    expect(await verifyPassword(resetPassword, (await appUsers.findByEmail(email))?.passwordHash)).toBe(true);

    const secondReset = await appApi.app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email, recoveryCode: nextRecoveryCode, newPassword: 'Third-password3!' },
    });
    expect(secondReset.statusCode).toBe(200);
  });

  it('requires an authenticated active account to issue a recovery code', async () => {
    const users = new InMemoryUserRepository();
    await createOwner(users, 'owner@example.test');
    const { app } = await recoveryApp(users);

    const anonymous = await app.inject({ method: 'POST', url: '/auth/recovery-code' });
    expect(anonymous.statusCode).toBe(401);
  });
});
