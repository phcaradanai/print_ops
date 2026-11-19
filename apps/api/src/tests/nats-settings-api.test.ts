/**
 * GET/PUT /api/v1/print-flow/nats-settings.
 *
 * The server build has no desktop shell to write `nats-settings.json` and
 * relaunch the API with PRINTOPS_NATS_* variables, so these routes are how a
 * Linux station configures NATS intake. What matters here:
 *  - the SAME schema and validation messages as apps/desktop/src-tauri/src/lib.rs;
 *  - the file is persisted and re-read on the next boot;
 *  - a save is applied to the running manager (no API restart);
 *  - mutating it needs a real permission and leaves a credential-redacted audit row.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import type { NatsSettings } from '../infra/nats/nats-settings.js';

const ENV_KEYS = [
  'DB_MODE',
  'PRINTOPS_DEV_SEED',
  'PRINTOPS_NATS_URL',
  'NATS_URL',
  'PRINTOPS_NATS_CLIENT_ID',
  'PRINTOPS_NATS_SUBJECT_PREFIX',
  'PRINTOPS_NATS_DURABLE',
  'PRINTOPS_NATS_SETTINGS_PATH',
  'PRINTOPS_DATA_DIR',
  'PRINTOPS_DB_PATH',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let tempDir: string;
let settingsFile: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'printops-nats-settings-'));
  settingsFile = join(tempDir, 'data', 'nats-settings.json');
  process.env['DB_MODE'] = 'memory';
  process.env['PRINTOPS_DEV_SEED'] = 'true';
  process.env['PRINTOPS_NATS_SETTINGS_PATH'] = settingsFile;
  for (const key of ['PRINTOPS_NATS_URL', 'NATS_URL', 'PRINTOPS_NATS_CLIENT_ID', 'PRINTOPS_NATS_SUBJECT_PREFIX', 'PRINTOPS_NATS_DURABLE'] as const) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

async function tokenFor(app: Awaited<ReturnType<typeof buildApp>>['app'], email: string): Promise<string> {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'Dev-password1!' },
  });
  expect(login.statusCode).toBe(200);
  return (login.json() as { token: string }).token;
}

const validSettings: NatsSettings = {
  enabled: true,
  url: 'nats://127.0.0.1:1',
  clientId: 'pharmacy-counter-01',
  subjectPrefix: 'medisync.print.intake',
};

describe('NATS intake settings over the API', () => {
  it('reports defaults, then round-trips validated settings through the file and the live manager', async () => {
    const built = await buildApp({ jwtSecret: 'nats-settings-route-secret' });
    const token = await tokenFor(built.app, 'sysadmin@printerops.local');
    const auth = { authorization: `Bearer ${token}` };

    const initial = await built.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-settings',
      headers: auth,
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({
      settings: { enabled: false, url: '', clientId: '', subjectPrefix: 'medisync.print.intake' },
      source: 'default',
    });

    const saved = await built.app.inject({
      method: 'PUT',
      url: '/api/v1/print-flow/nats-settings',
      headers: auth,
      payload: validSettings,
    });
    expect(saved.statusCode).toBe(200);
    const applied = saved.json() as {
      settings: NatsSettings;
      source: string;
      status: { enabled: boolean; clientId?: string; subject?: string; state: string };
    };
    expect(applied.settings).toEqual(validSettings);
    expect(applied.source).toBe('file');
    // Applied to the running manager: no API restart, no env var, no relaunch.
    expect(applied.status.enabled).toBe(true);
    expect(applied.status.clientId).toBe('pharmacy-counter-01');
    expect(applied.status.subject).toBe('medisync.print.intake.pharmacy-counter-01');

    // Persisted with the desktop shell's exact field names.
    expect(existsSync(settingsFile)).toBe(true);
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual(validSettings);

    const reread = await built.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-settings',
      headers: auth,
    });
    expect(reread.json()).toMatchObject({ settings: validSettings, source: 'file' });

    // The status endpoint the dashboard already polls reflects the new config.
    const status = await built.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-status',
      headers: auth,
    });
    expect(status.json()).toMatchObject({
      enabled: true,
      clientId: 'pharmacy-counter-01',
      subject: 'medisync.print.intake.pharmacy-counter-01',
    });

    // The topology read view follows the applied settings too: it is read from
    // the manager, not from a boot-time snapshot.
    const topology = await built.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/config',
      headers: auth,
    });
    expect(topology.json()).toMatchObject({
      nats: {
        enabled: true,
        clientId: 'pharmacy-counter-01',
        subject: 'medisync.print.intake.pharmacy-counter-01',
      },
    });

    await built.app.close();
  });

  it('disables intake at runtime and keeps it disabled after a restart', async () => {
    const first = await buildApp({ jwtSecret: 'nats-settings-route-secret' });
    const token = await tokenFor(first.app, 'sysadmin@printerops.local');
    const auth = { authorization: `Bearer ${token}` };
    await first.app.inject({
      method: 'PUT',
      url: '/api/v1/print-flow/nats-settings',
      headers: auth,
      payload: validSettings,
    });

    const disabled = await first.app.inject({
      method: 'PUT',
      url: '/api/v1/print-flow/nats-settings',
      headers: auth,
      payload: { ...validSettings, enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect((disabled.json() as { status: { enabled: boolean; state: string } }).status)
      .toMatchObject({ enabled: false, state: 'DISABLED' });
    const status = await first.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-status',
      headers: auth,
    });
    expect(status.json()).toMatchObject({ enabled: false, connected: false });
    await first.app.close();

    // A persisted "disabled" must survive the restart, exactly like a persisted
    // "enabled": otherwise turning NATS off would silently come back on.
    const restarted = await buildApp({ jwtSecret: 'nats-settings-route-secret' });
    const restartedToken = await tokenFor(restarted.app, 'sysadmin@printerops.local');
    const afterBoot = await restarted.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-settings',
      headers: { authorization: `Bearer ${restartedToken}` },
    });
    expect(afterBoot.json()).toMatchObject({
      settings: { ...validSettings, enabled: false },
      source: 'file',
    });
    await restarted.app.close();
  });

  it('prefers the saved file over the environment and falls back to the environment when there is no file', async () => {
    process.env['PRINTOPS_NATS_URL'] = 'nats://127.0.0.1:1';
    process.env['PRINTOPS_NATS_CLIENT_ID'] = 'env-station';
    process.env['PRINTOPS_NATS_SUBJECT_PREFIX'] = 'custom.intake';

    const fromEnv = await buildApp({ jwtSecret: 'nats-settings-route-secret' });
    const token = await tokenFor(fromEnv.app, 'sysadmin@printerops.local');
    const auth = { authorization: `Bearer ${token}` };
    const envView = await fromEnv.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-settings',
      headers: auth,
    });
    expect(envView.json()).toEqual({
      settings: {
        enabled: true,
        url: 'nats://127.0.0.1:1',
        clientId: 'env-station',
        subjectPrefix: 'custom.intake',
      },
      source: 'env',
    });
    await fromEnv.app.close();

    // An operator save wins over the still-present environment on the next boot.
    mkdirSync(join(tempDir, 'data'), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify({ ...validSettings, clientId: 'file-station' }), 'utf8');

    const fromFile = await buildApp({ jwtSecret: 'nats-settings-route-secret' });
    const fileToken = await tokenFor(fromFile.app, 'sysadmin@printerops.local');
    const fileView = await fromFile.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-settings',
      headers: { authorization: `Bearer ${fileToken}` },
    });
    expect(fileView.json()).toMatchObject({
      settings: { ...validSettings, clientId: 'file-station' },
      source: 'file',
    });
    const status = await fromFile.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-status',
      headers: { authorization: `Bearer ${fileToken}` },
    });
    expect(status.json()).toMatchObject({ enabled: true, clientId: 'file-station' });
    await fromFile.app.close();
  });

  it('rejects invalid settings with the desktop shell messages and writes nothing', async () => {
    const built = await buildApp({ jwtSecret: 'nats-settings-route-secret' });
    const token = await tokenFor(built.app, 'sysadmin@printerops.local');
    const auth = { authorization: `Bearer ${token}` };

    const cases: Array<{ payload: unknown; message: string }> = [
      {
        payload: { ...validSettings, url: 'https://broker.example' },
        message: 'NATS URL must start with nats://',
      },
      { payload: { ...validSettings, url: '   ' }, message: 'NATS URL is required when NATS is enabled' },
      {
        payload: { ...validSettings, clientId: 'counter.01' },
        message: 'Client ID may contain only letters, digits, _ and -',
      },
      {
        payload: { ...validSettings, subjectPrefix: 'medisync.*' },
        message: 'Subject prefix must contain literal NATS tokens separated by dots',
      },
      {
        payload: { ...validSettings, subjectPrefix: '' },
        message: 'Subject prefix must contain literal NATS tokens separated by dots',
      },
      { payload: { ...validSettings, enabled: 'yes' }, message: 'NATS settings must include "enabled"' },
    ];

    for (const testCase of cases) {
      const response = await built.app.inject({
        method: 'PUT',
        url: '/api/v1/print-flow/nats-settings',
        headers: auth,
        payload: testCase.payload as Record<string, unknown>,
      });
      expect(response.statusCode, JSON.stringify(testCase.payload)).toBe(400);
      const body = response.json() as { error: string; message: string };
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.message).toContain(testCase.message);
    }

    // Nothing was written, so the API still reports the untouched default.
    expect(existsSync(settingsFile)).toBe(false);
    const view = await built.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-settings',
      headers: auth,
    });
    expect(view.json()).toMatchObject({ source: 'default' });
    await built.app.close();
  });

  it('hides the edit view and the change itself from a VIEWER, and audits the change with a redacted URL', async () => {
    const built = await buildApp({ jwtSecret: 'nats-settings-route-secret' });
    const sysadmin = await tokenFor(built.app, 'sysadmin@printerops.local');
    const viewer = await tokenFor(built.app, 'viewer@printerops.local');

    // The settings view is the EDIT form: its URL is unredacted, so a read-only
    // role does not get it (nats-status/config stay available and redacted).
    const viewerRead = await built.app.inject({
      method: 'GET',
      url: '/api/v1/print-flow/nats-settings',
      headers: { authorization: `Bearer ${viewer}` },
    });
    expect(viewerRead.statusCode).toBe(403);

    const viewerWrite = await built.app.inject({
      method: 'PUT',
      url: '/api/v1/print-flow/nats-settings',
      headers: { authorization: `Bearer ${viewer}` },
      payload: validSettings,
    });
    expect(viewerWrite.statusCode).toBe(403);
    expect(existsSync(settingsFile)).toBe(false);

    const withCredentials = { ...validSettings, url: 'nats://operator:super-secret@127.0.0.1:1' };
    const saved = await built.app.inject({
      method: 'PUT',
      url: '/api/v1/print-flow/nats-settings',
      headers: { authorization: `Bearer ${sysadmin}` },
      payload: withCredentials,
    });
    expect(saved.statusCode).toBe(200);

    const audit = await built.app.inject({
      method: 'GET',
      url: '/audit-logs?resourceType=nats_settings',
      headers: { authorization: `Bearer ${sysadmin}` },
    });
    expect(audit.statusCode).toBe(200);
    const rows = audit.json() as Array<{
      action: string;
      resourceType: string;
      actorId: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    }>;
    const entry = rows.find((row) => row.action === 'nats_settings.updated');
    expect(entry, JSON.stringify(rows)).toBeTruthy();
    expect(entry?.after).toMatchObject({
      enabled: true,
      clientId: 'pharmacy-counter-01',
      url: 'nats://***@127.0.0.1:1',
    });
    // The audit trail is readable by every ADMIN/OWNER: broker credentials must
    // never land in it, even though the edit form may show them.
    expect(audit.body).not.toContain('super-secret');
    expect(readFileSync(settingsFile, 'utf8')).toContain('super-secret');
    await built.app.close();
  });
});
