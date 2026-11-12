import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { runtimeArchitectureFromEnv } from '../infra/runtime-architecture.js';

describe('runtime executor architecture', () => {
  it('reports Linux CUPS as the API-owned executor and rejects a competing runner', () => {
    const env = {
      PRINTOPS_RUNTIME_MODE: 'linux-server',
      PRINTOPS_LOCAL_WORKER: 'true',
      PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED: 'false',
    };
    expect(runtimeArchitectureFromEnv(env)).toMatchObject({
      runtimeMode: 'linux-server',
      executor: { owner: 'api-local-worker', mode: 'typescript-cups', enabled: true },
      discovery: { jobsEnabled: false },
    });
    expect(() => runtimeArchitectureFromEnv({ ...env, PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED: 'true' })).toThrow(/LINUX_EXECUTOR_INVARIANT/);
    expect(() => runtimeArchitectureFromEnv({ ...env, PRINTOPS_LOCAL_WORKER: 'false' })).toThrow(/LINUX_EXECUTOR_INVARIANT/);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports the packaged API worker as the sole executor', () => {
    const architecture = runtimeArchitectureFromEnv({
      PRINTOPS_RUNTIME_MODE: 'packaged-windows-desktop',
      PRINTOPS_LOCAL_WORKER: 'true',
      PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED: 'false',
    });

    expect(architecture).toMatchObject({
      runtimeMode: 'packaged-windows-desktop',
      executor: {
        owner: 'api-local-worker',
        mode: 'typescript-windows-spooler',
        enabled: true,
      },
      discovery: {
        owner: 'go-runner',
        mode: 'windows-installed-printers',
        jobsEnabled: false,
      },
      invariant: { ok: true, code: 'SINGLE_EXECUTOR' },
      supportedProductionProtocols: ['windows-spooler'],
    });
  });

  it('refuses packaged startup if the discovery runner can also claim jobs', () => {
    expect(() => runtimeArchitectureFromEnv({
      PRINTOPS_RUNTIME_MODE: 'packaged-windows-desktop',
      PRINTOPS_LOCAL_WORKER: 'true',
      PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED: 'true',
    })).toThrow(/DESKTOP_EXECUTOR_INVARIANT/);
  });

  it('refuses packaged startup without the API local worker', () => {
    expect(() => runtimeArchitectureFromEnv({
      PRINTOPS_RUNTIME_MODE: 'packaged-windows-desktop',
      PRINTOPS_LOCAL_WORKER: 'false',
      PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED: 'false',
    })).toThrow(/DESKTOP_EXECUTOR_INVARIANT/);
  });

  it('lets the bundled Windows entry screen check health without opening CORS to other origins', async () => {
    vi.stubEnv('PRINTOPS_RUNTIME_MODE', 'packaged-windows-desktop');
    vi.stubEnv('PRINTOPS_LOCAL_WORKER', 'true');
    vi.stubEnv('PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED', 'false');
    vi.stubEnv('PRINTOPS_DEV_SEED', 'false');
    vi.stubEnv('DB_MODE', 'memory');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    const { app } = await buildApp({ jwtSecret: 'desktop-bootstrap-test-secret' });
    try {
      const bundled = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://tauri.localhost' },
      });
      expect(bundled.statusCode).toBe(200);
      expect(bundled.headers['access-control-allow-origin']).toBe('http://tauri.localhost');
      expect(bundled.json().status).toBe('ok');

      const unrelated = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://unrelated.example' },
      });
      expect(unrelated.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('exposes the validated architecture through the authenticated diagnostics route', async () => {
    vi.stubEnv('PRINTOPS_RUNTIME_MODE', 'packaged-windows-desktop');
    vi.stubEnv('PRINTOPS_LOCAL_WORKER', 'true');
    vi.stubEnv('PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED', 'false');
    const built = await buildApp({ jwtSecret: 'runtime-architecture-test-secret' });
    try {
      const login = await built.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@printerops.local', password: 'Dev-password1!' },
      });
      expect(login.statusCode).toBe(200);
      const token = (login.json() as { token: string }).token;

      const response = await built.app.inject({
        method: 'GET',
        url: '/api/v1/print-flow/runtime-architecture',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        executor: { owner: 'api-local-worker' },
        discovery: { owner: 'go-runner', jobsEnabled: false },
        invariant: { code: 'SINGLE_EXECUTOR' },
      });
    } finally {
      await built.app.close();
    }
  });
});
