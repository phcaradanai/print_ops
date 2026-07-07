import { execFile } from 'node:child_process';
import type { DiscoveryItem, DiscoveredConnectionType } from '@printerops/domain';

export type { DiscoveryItem, DiscoveredConnectionType };

export function detectConnectionType(portName?: string): DiscoveredConnectionType {
  if (!portName) return 'unknown';
  const p = portName.toUpperCase();
  if (p.startsWith('USB')) return 'usb';
  if (p.startsWith('WSD')) return 'wsd';
  if (p.startsWith('LPT') || p.startsWith('COM')) return 'lpt_com';
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}/.test(portName) || p.startsWith('IP_')) return 'tcp_ip';
  if (portName.startsWith('\\\\')) return 'network_share';
  return 'unknown';
}

type RawPrinterRecord = {
  Name?: unknown;
  DriverName?: unknown;
  PortName?: unknown;
  Shared?: unknown;
  Default?: unknown;
  [key: string]: unknown;
};

/** Pure parser — testable on any platform. Parses PowerShell ConvertTo-Json output. */
export function parseGetPrinterOutput(raw: string): DiscoveryItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  const records: RawPrinterRecord[] = Array.isArray(parsed)
    ? (parsed as RawPrinterRecord[])
    : [parsed as RawPrinterRecord];
  return records
    .filter((r) => typeof r.Name === 'string' && r.Name.length > 0)
    .map((r) => {
      const portName = typeof r.PortName === 'string' ? r.PortName : undefined;
      return {
        localPrinterName: r.Name as string,
        driverName: typeof r.DriverName === 'string' ? r.DriverName : undefined,
        portName,
        connectionType: detectConnectionType(portName),
        isDefault: r.Default === true,
        isShared: r.Shared === true,
        attributes: { rawDriver: r.DriverName, rawPort: r.PortName },
      };
    });
}

function discoverWindows(): Promise<DiscoveryItem[]> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NonInteractive', '-NoProfile', '-Command',
        'Get-Printer | Select-Object Name,DriverName,PortName,Shared,Default | ConvertTo-Json -Compress',
      ],
      { timeout: 10000 },
      (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }
        resolve(parseGetPrinterOutput(stdout));
      }
    );
  });
}

function discoverUnix(): Promise<DiscoveryItem[]> {
  return new Promise((resolve) => {
    execFile('lpstat', ['-a'], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      const items = stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line): DiscoveryItem | null => {
          const name = line.split(' ')[0]?.trim() ?? '';
          if (!name) return null;
          return {
            localPrinterName: name,
            connectionType: 'unknown',
            isDefault: false,
            isShared: false,
          };
        })
        .filter((item): item is DiscoveryItem => item !== null);
      resolve(items);
    });
  });
}

/** Platform-aware discovery — side-effectful. Not directly tested (use parseGetPrinterOutput for tests). */
export function discoverPrinters(): Promise<DiscoveryItem[]> {
  if (process.platform === 'win32') return discoverWindows();
  return discoverUnix();
}
