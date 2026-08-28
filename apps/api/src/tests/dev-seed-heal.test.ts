import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildApp } from '../app.js';
import { closeDatabase, getDb, initDatabase } from '../infra/db/sqlite.js';
import { SqliteUserRepository } from '../infra/repos/sqlite/sqlite-user.repo.js';
import { hashPassword } from '../infra/auth/password.js';

const SQL_WASM_PATH = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

const originalDbMode = process.env['DB_MODE'];
const originalDbPath = process.env['PRINTOPS_DB_PATH'];
const originalWasmPath = process.env['SQL_WASM_PATH'];
const originalDevSeed = process.env['PRINTOPS_DEV_SEED'];

let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'printops-dev-seed-heal-'));
  process.env['DB_MODE'] = 'sqlite';
  process.env['PRINTOPS_DB_PATH'] = join(tempDir, 'printops.db');
  process.env['SQL_WASM_PATH'] = SQL_WASM_PATH;
  process.env['PRINTOPS_DEV_SEED'] = 'true';
  await initDatabase();
});

afterEach(async () => {
  await closeDatabase({ save: false });
  process.env['DB_MODE'] = originalDbMode;
  process.env['PRINTOPS_DB_PATH'] = originalDbPath;
  process.env['SQL_WASM_PATH'] = originalWasmPath;
  process.env['PRINTOPS_DEV_SEED'] = originalDevSeed;
  rmSync(tempDir, { recursive: true, force: true });
});

async function seedLegacyDevUser(email: string, role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER', isActive = true) {
  const repo = new SqliteUserRepository();
  await repo.seed({
    id: `legacy-${email}`,
    email,
    name: email.split('@')[0] ?? email,
    // Pre-hardening builds stored a placeholder hash that verifyPassword can
    // never accept.
    passwordHash: '123456',
    role,
    isActive,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('dev seed heals legacy accounts', () => {
  it('seeds the default OWNER when PRINTOPS_DEV_SEED is omitted', async () => {
    delete process.env['PRINTOPS_DEV_SEED'];

    const built = await buildApp({ jwtSecret: 'default-seed-owner-test-secret' });
    try {
      for (const [email, role] of [
        ['sysadmin@printerops.local', 'OWNER'],
        ['admin@printerops.local', 'ADMIN'],
        ['user@printerops.local', 'OPERATOR'],
        ['viewer@printerops.local', 'VIEWER'],
      ] as const) {
        const login = await built.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'Dev-password1!' },
        });
        expect(login.statusCode).toBe(200);
        expect(login.json().user.role).toBe(role);
      }
    } finally {
      await built.app.close();
    }
  });

  it('keeps the explicit PRINTOPS_DEV_SEED=false opt-out for owner setup', async () => {
    process.env['PRINTOPS_DEV_SEED'] = 'false';

    const built = await buildApp({ jwtSecret: 'default-seed-opt-out-test-secret' });
    try {
      const bootstrap = await built.app.inject({ method: 'GET', url: '/auth/bootstrap' });
      expect(bootstrap.json()).toEqual({ state: 'REQUIRED_NEW', ownerEmailHints: [] });

      const login = await built.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'sysadmin@printerops.local', password: 'Dev-password1!' },
      });
      expect(login.statusCode).toBe(401);
    } finally {
      await built.app.close();
    }
  });

  it('re-hashes an OWNER whose legacy placeholder hash can never verify', async () => {
    await seedLegacyDevUser('sysadmin@printerops.local', 'OWNER');

    const built = await buildApp({ jwtSecret: 'dev-seed-heal-owner-test-secret' });
    try {
      const login = await built.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'sysadmin@printerops.local', password: 'Dev-password1!' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().user.role).toBe('OWNER');

      // The stored hash must have been replaced by a real scrypt hash.
      const healed = new SqliteUserRepository();
      const user = await healed.findByEmail('sysadmin@printerops.local');
      expect(user?.passwordHash).toMatch(/^scrypt\$/);
    } finally {
      await built.app.close();
    }
  });

  it('reactivates dev accounts deactivated by an earlier owner bootstrap', async () => {
    await seedLegacyDevUser('sysadmin@printerops.local', 'OWNER');
    await seedLegacyDevUser('admin@printerops.local', 'ADMIN', false);

    const built = await buildApp({ jwtSecret: 'dev-seed-heal-active-test-secret' });
    try {
      for (const [email, role] of [
        ['sysadmin@printerops.local', 'OWNER'],
        ['admin@printerops.local', 'ADMIN'],
      ] as const) {
        const login = await built.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'Dev-password1!' },
        });
        expect(login.statusCode).toBe(200);
        expect(login.json().user.role).toBe(role);
      }
    } finally {
      await built.app.close();
    }
  });

  it('leaves a freshly seeded dev user untouched (idempotent)', async () => {
    // Fresh seed writes a scrypt hash; the heal must not rewrite it.
    const built = await buildApp({ jwtSecret: 'dev-seed-heal-idempotent-test-secret' });
    try {
      const repo = new SqliteUserRepository();
      const user = await repo.findByEmail('sysadmin@printerops.local');
      expect(user?.passwordHash).toMatch(/^scrypt\$/);
      expect(await hashPassword('Dev-password1!')).not.toBe(user?.passwordHash);
    } finally {
      await built.app.close();
    }
  });
});
