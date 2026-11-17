import { hostname, networkInterfaces, release } from 'node:os';

export const LOCAL_CONTROL_CAPABILITIES = [
  'ota',
  'inventory-v1',
  'content-sync-v1',
  'content-pull-v1',
] as const;

export interface LocalControlDeviceInfo {
  hostname: string;
  osVersion: string;
  installationPath?: string;
  dataPath?: string;
  ipAddresses: string[];
  capabilities: string[];
}

/** Report only this enrolled PrintOps host; this does not scan the local network. */
export function getLocalControlDeviceInfo(
  env: NodeJS.ProcessEnv = process.env,
): LocalControlDeviceInfo {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) => entry.address)
    .filter((address, index, all) => all.indexOf(address) === index)
    .slice(0, 16);
  // Publish `host:port` because a station is not always on the default print port: a
  // containerised station listens on its own service port (3001). A control plane that
  // receives a bare host would have to guess, and guessing reached a different station.
  const port = (env['PORT'] ?? '').trim() || '31415';
  const ipAddresses = addresses.map((address) => `${address}:${port}`);

  return {
    hostname: hostname(),
    osVersion: release(),
    ...(env['PRINTOPS_OTA_INSTALL_ROOT'] ? { installationPath: env['PRINTOPS_OTA_INSTALL_ROOT'] } : {}),
    ...(env['PRINTOPS_DB_PATH'] ? { dataPath: env['PRINTOPS_DB_PATH'] } : {}),
    ipAddresses,
    capabilities: [...LOCAL_CONTROL_CAPABILITIES],
  };
}
