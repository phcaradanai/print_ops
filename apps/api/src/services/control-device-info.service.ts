import { hostname, networkInterfaces, release } from 'node:os';

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
  const ipAddresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) => entry.address)
    .filter((address, index, all) => all.indexOf(address) === index)
    .slice(0, 16);

  return {
    hostname: hostname(),
    osVersion: release(),
    ...(env['PRINTOPS_OTA_INSTALL_ROOT'] ? { installationPath: env['PRINTOPS_OTA_INSTALL_ROOT'] } : {}),
    ...(env['PRINTOPS_DB_PATH'] ? { dataPath: env['PRINTOPS_DB_PATH'] } : {}),
    ipAddresses,
    capabilities: ['ota', 'inventory-v1', 'content-sync-v1', 'content-pull-v1'],
  };
}
