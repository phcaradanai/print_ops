import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { describe, expect, it } from 'vitest';
import type { Role, User } from '@printerops/domain';
import { InMemoryUserRepository } from '../infra/repos/in-memory-user.repo.js';
import { v1UserRoutes } from '../routes/v1/users.routes.js';

const ROLES: Role[] = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'];

async function buildTestApp() {
  const app = Fastify();
  await app.register(jwt, { secret: 'user-role-visibility-test-secret' });
  app.decorate('authenticate', async function (req) {
    await req.jwtVerify();
  });

  const users = new InMemoryUserRepository();
  const now = new Date('2026-07-31T00:00:00.000Z');
  for (const role of ROLES) {
    users.seed({
      id: role.toLowerCase(),
      email: `${role.toLowerCase()}@example.test`,
      name: role,
      passwordHash: `scrypt$hidden-${role}`,
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    } satisfies User);
  }

  await app.register(async (v1) => v1UserRoutes(v1, { users }), { prefix: '/api/v1' });
  return app;
}

describe('user directory role visibility', () => {
  it.each([
    ['OWNER', ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']],
    ['ADMIN', ['ADMIN', 'OPERATOR', 'VIEWER']],
    ['OPERATOR', ['OPERATOR', 'VIEWER']],
    ['VIEWER', ['VIEWER']],
  ] as const)('%s sees only its own role and lower roles', async (role, visibleRoles) => {
    const app = await buildTestApp();
    const authorization = `Bearer ${app.jwt.sign({ sub: role.toLowerCase(), role, email: `${role.toLowerCase()}@example.test` })}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().map((user: { role: Role }) => user.role)).toEqual(visibleRoles);
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('scrypt$');
    await app.close();
  });
});
