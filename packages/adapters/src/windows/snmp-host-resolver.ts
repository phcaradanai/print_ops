/**
 * Find the network address to talk SNMP to, for a printer installed on this
 * Windows host.
 *
 * Two kinds of ports matter in practice:
 *  - Standard TCP/IP ports expose `PrinterHostAddress` directly.
 *  - WSD ports (what Windows creates for auto-discovered EPSONs) expose no
 *    IPv4 address at all; the device address lives in the PnP registry entry as
 *    an IPv6 link-local URL, e.g. `http://[fe80::5257:9cff:fe4f:6a3c%6]:80/WSD/DEVICE`.
 *    That address is directly usable for SNMP.
 *
 * Resolution is cached briefly per printer name. Negative answers expire fast
 * so removing/re-adding a WSD printer is discovered without reinstalling or
 * restarting the desktop app.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const isWindows = process.platform === 'win32';

const POSITIVE_CACHE_MS = 10 * 60_000;
const NEGATIVE_CACHE_MS = 15_000;
const cache = new Map<string, { host?: string; expiresAt: number }>();

const resolveScript = (printerName: string): string => `
$PrinterName = '${printerName.replace(/'/g, "''")}'
$ErrorActionPreference = 'SilentlyContinue'

# 1. Standard TCP/IP port — the host address is on the port itself.
$printer = Get-Printer -Name $PrinterName
if ($printer) {
  $port = Get-PrinterPort -Name $printer.PortName
  if ($port -and $port.PrinterHostAddress) {
    Write-Output $port.PrinterHostAddress
    exit 0
  }
}

# 2. WSD port — dig the device URL out of the PnP registry entry.
$base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\SWD\\DAFWSDProvider'
foreach ($key in Get-ChildItem $base) {
  $props = Get-ItemProperty $key.PSPath
  if ($props.FriendlyName -ne $PrinterName) { continue }
  if ($props.LocationInformation -match '\\[([0-9a-fA-F:%]+)\\]') {
    Write-Output $Matches[1]
    exit 0
  }
  if ($props.LocationInformation -match 'https?://([0-9.]+)') {
    Write-Output $Matches[1]
    exit 0
  }
}
`;

/**
 * Resolve an SNMP-reachable address for a Windows printer, or undefined when
 * none can be determined. Never throws.
 */
export async function resolveSnmpHost(printerName: string): Promise<string | undefined> {
  if (!isWindows || !printerName) return undefined;
  const cached = cache.get(printerName);
  if (cached && cached.expiresAt > Date.now()) return cached.host;
  if (cached) cache.delete(printerName);

  let host: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', resolveScript(printerName)],
      { timeout: 10_000 },
    );
    const value = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (value) host = value;
  } catch {
    host = undefined;
  }

  cache.set(printerName, {
    host,
    expiresAt: Date.now() + (host ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS),
  });
  return host;
}

/** Drop a cached resolution (e.g. after a printer is re-added on a new port). */
export function clearSnmpHostCache(printerName?: string): void {
  if (printerName) cache.delete(printerName);
  else cache.clear();
}
