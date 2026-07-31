import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { runtimeArchitectureFromEnv } from '../infra/runtime-architecture.js';

describe('runtime executor architecture', () => {
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
