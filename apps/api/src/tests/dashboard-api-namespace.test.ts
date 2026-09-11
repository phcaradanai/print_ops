import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;
const openApps: BuiltApp['app'][] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('dashboard API namespace', () => {
  it('serves health, login, and authenticated resources below /api', async () => {
    const built = await buildApp({ jwtSecret: 'dashboard-api-namespace-test-secret' });
    openApps.push(built.app);

    const health = await built.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok' });

    const login = await built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@printerops.local', password: 'Dev-password1!' },
    });
    expect(login.statusCode).toBe(200);

    const jobs = await built.app.inject({
      method: 'GET',
      url: '/api/jobs?limit=500',
      headers: { authorization: `Bearer ${login.json().token as string}` },
    });
    expect(jobs.statusCode).toBe(200);
    expect(jobs.json()).toEqual(expect.any(Array));
  });

  it('keeps the old root API available for non-browser compatibility clients', async () => {
    const built = await buildApp({ jwtSecret: 'dashboard-api-compatibility-test-secret' });
    openApps.push(built.app);

    expect((await built.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await built.app.inject({ method: 'GET', url: '/jobs' })).statusCode).toBe(401);
  });

  it('serves the packaged SPA for an HTML deep-link instead of returning a raw JWT error', async () => {
    const built = await buildApp({ jwtSecret: 'dashboard-deep-link-test-secret' });
    openApps.push(built.app);

    const response = await built.app.inject({
      method: 'GET',
      url: '/jobs',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<div id="root"></div>');
    expect(response.body).not.toContain('FST_JWT_NO_AUTHORIZATION_IN_HEADER');
  });
});
