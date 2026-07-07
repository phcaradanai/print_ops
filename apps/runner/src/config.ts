import type { DiscoveryAdapterMode } from './printer-discovery.js';

export interface RunnerConfig {
  apiUrl: string;
  apiToken: string;
  runnerName: string;
  hostname: string;
  supportedProtocols: string[];
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  discoveryIntervalMs: number;
  discoveryAdapter: DiscoveryAdapterMode;
  devEmail: string;
  devPassword: string;
}

export function loadConfig(): RunnerConfig {
  const rawAdapter = process.env['DISCOVERY_ADAPTER'] ?? 'auto';
  const discoveryAdapter: DiscoveryAdapterMode =
    rawAdapter === 'windows' || rawAdapter === 'macos' || rawAdapter === 'fake' ? rawAdapter : 'auto';
  return {
    apiUrl: process.env['API_URL'] ?? 'http://localhost:3001',
    apiToken: process.env['RUNNER_API_TOKEN'] ?? '',
    runnerName: process.env['RUNNER_NAME'] ?? `runner-${process.env['HOSTNAME'] ?? 'local'}`,
    hostname: process.env['HOSTNAME'] ?? 'localhost',
    supportedProtocols: (process.env['SUPPORTED_PROTOCOLS'] ?? 'fake,ipp,cups').split(','),
    pollIntervalMs: Number(process.env['POLL_INTERVAL_MS'] ?? 2000),
    heartbeatIntervalMs: Number(process.env['HEARTBEAT_INTERVAL_MS'] ?? 10000),
    discoveryIntervalMs: Number(process.env['DISCOVERY_INTERVAL_MS'] ?? 60000),
    discoveryAdapter,
    devEmail: process.env['RUNNER_DEV_EMAIL'] ?? 'admin@printerops.local',
    devPassword: process.env['RUNNER_DEV_PASSWORD'] ?? 'dev-password',
  };
}
