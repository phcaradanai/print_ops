export type RuntimeMode = 'packaged-windows-desktop' | 'server';

export interface RuntimeArchitecture {
  runtimeMode: RuntimeMode;
  executor: {
    owner: 'api-local-worker' | 'external-runner';
    mode: 'typescript-windows-spooler' | 'external-runner';
    enabled: boolean;
  };
  discovery: {
    owner: 'go-runner';
    mode: 'windows-installed-printers' | 'platform-configured';
    jobsEnabled: boolean;
  };
  invariant: {
    ok: true;
    code: 'SINGLE_EXECUTOR';
  };
  supportedProductionProtocols: string[];
  deferredProtocols: string[];
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * Resolve and validate ownership before any repository, queue, or worker starts.
 *
 * The desktop shell launches both child processes and injects both sides of
 * this contract. If the discovery runner is accidentally allowed to poll jobs,
 * refusing API startup is safer than racing two executors against one queue.
 */
export function runtimeArchitectureFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeArchitecture {
  const packaged = env['PRINTOPS_RUNTIME_MODE'] === 'packaged-windows-desktop';
  const localWorkerEnabled = enabled(env['PRINTOPS_LOCAL_WORKER']);
  const discoveryRunnerJobsEnabled = enabled(
    env['PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED'],
  );

  if (packaged && (!localWorkerEnabled || discoveryRunnerJobsEnabled)) {
    throw new Error(
      'DESKTOP_EXECUTOR_INVARIANT: packaged Windows mode requires ' +
      'PRINTOPS_LOCAL_WORKER=true and PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED=false. ' +
      'Refusing startup because two executor paths could claim or print the same job.',
    );
  }

  return {
    runtimeMode: packaged ? 'packaged-windows-desktop' : 'server',
    executor: {
      owner: localWorkerEnabled ? 'api-local-worker' : 'external-runner',
      mode: localWorkerEnabled ? 'typescript-windows-spooler' : 'external-runner',
      enabled: localWorkerEnabled || !packaged,
    },
    discovery: {
      owner: 'go-runner',
      mode: packaged ? 'windows-installed-printers' : 'platform-configured',
      jobsEnabled: discoveryRunnerJobsEnabled,
    },
    invariant: {
      ok: true,
      code: 'SINGLE_EXECUTOR',
    },
    supportedProductionProtocols: packaged ? ['windows-spooler'] : [],
    deferredProtocols: ['ipp', 'cups', 'raw-tcp-9100'],
  };
}
