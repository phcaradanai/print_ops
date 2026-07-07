import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import type { DiscoveryItem, DiscoveredConnectionType } from '@printerops/domain';

export type { DiscoveryItem, DiscoveredConnectionType };

// ── Windows port-name based detection ──────────────────────────────────────

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

// ── CUPS URI-scheme based detection ────────────────────────────────────────

export function detectCupsConnectionType(uri: string): DiscoveredConnectionType {
  if (!uri) return 'unknown';
  if (uri.startsWith('usb://')) return 'usb';
  if (
    uri.startsWith('socket://') ||
    uri.startsWith('ipp://') ||
    uri.startsWith('ipps://') ||
    uri.startsWith('dnssd://') ||
    uri.startsWith('lpd://') ||
    uri.startsWith('http://') ||
    uri.startsWith('https://')
  ) return 'tcp_ip';
  return 'unknown';
}

// ── Windows parser (pure — testable on any platform) ───────────────────────

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

// ── macOS CUPS parsers (pure — testable on any platform) ───────────────────

/** Parses `lpstat -p` output. Returns list of printer names and their status. */
export function parseLpstatPOutput(raw: string): { name: string; status: 'idle' | 'processing' | 'disabled' }[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('printer '))
    .map((line) => {
      // "printer <name> is idle."  /  "printer <name> disabled since …"  / "printer <name> processing …"
      const parts = line.split(/\s+/);
      const name = parts[1] ?? '';
      if (!name) return null;
      let status: 'idle' | 'processing' | 'disabled' = 'idle';
      if (line.includes('disabled')) status = 'disabled';
      else if (line.includes('processing')) status = 'processing';
      return { name, status };
    })
    .filter((item): item is { name: string; status: 'idle' | 'processing' | 'disabled' } => item !== null && item.name.length > 0);
}

/** Parses `lpstat -v` output. Returns a map of printer name → device URI. */
export function parseLpstatVOutput(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    // "device for <name>: <uri>"
    const match = /^device for ([^:]+):\s*(.+)$/.exec(trimmed);
    if (match) {
      const name = match[1]?.trim() ?? '';
      const uri = match[2]?.trim() ?? '';
      if (name && uri) result.set(name, uri);
    }
  }
  return result;
}

/** Parses `lpstat -d` output. Returns the default printer name or undefined. */
export function parseLpstatDOutput(raw: string): string | undefined {
  // "system default destination: <name>"
  const match = /system default destination:\s*(.+)/.exec(raw.trim());
  return match?.[1]?.trim() || undefined;
}

/**
 * Pure combinator — testable on any platform.
 * Takes raw stdout from lpstat -p, lpstat -v, lpstat -d and returns DiscoveryItem[].
 */
export function parseCupsPrinters(
  lpstatP: string,
  lpstatV: string,
  lpstatD: string
): DiscoveryItem[] {
  const printers = parseLpstatPOutput(lpstatP);
  const uriMap = parseLpstatVOutput(lpstatV);
  const defaultName = parseLpstatDOutput(lpstatD);

  return printers.map((p) => {
    const uri = uriMap.get(p.name);
    return {
      localPrinterName: p.name,
      portName: uri,
      connectionType: uri ? detectCupsConnectionType(uri) : 'unknown',
      isDefault: p.name === defaultName,
      isShared: false,
      attributes: { cupsStatus: p.status, deviceUri: uri },
    };
  });
}

// ── Platform-aware adapters (side-effectful) ────────────────────────────────

function exec(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err || !stdout ? '' : stdout);
    });
  });
}

function runnerMeta(): { computerName: string; osName: string } {
  return {
    computerName: hostname(),
    osName: process.platform,
  };
}

function withMeta(items: DiscoveryItem[]): DiscoveryItem[] {
  const meta = runnerMeta();
  return items.map((item) => ({ ...item, ...meta }));
}

async function discoverWindows(): Promise<DiscoveryItem[]> {
  const stdout = await exec(
    'powershell.exe',
    [
      '-NonInteractive', '-NoProfile', '-Command',
      'Get-Printer | Select-Object Name,DriverName,PortName,Shared,Default | ConvertTo-Json -Compress',
    ],
    10000
  );
  return withMeta(parseGetPrinterOutput(stdout));
}

async function discoverMacOs(): Promise<DiscoveryItem[]> {
  const [lpstatP, lpstatV, lpstatD] = await Promise.all([
    exec('lpstat', ['-p'], 5000),
    exec('lpstat', ['-v'], 5000),
    exec('lpstat', ['-d'], 5000),
  ]);
  return withMeta(parseCupsPrinters(lpstatP, lpstatV, lpstatD));
}

function discoverFake(): DiscoveryItem[] {
  const meta = runnerMeta();
  return [
    {
      localPrinterName: 'Fake-Label-Printer',
      driverName: 'Fake ZPL Driver',
      portName: '127.0.0.1:9100',
      connectionType: 'tcp_ip',
      isDefault: true,
      isShared: false,
      attributes: { fake: true },
      ...meta,
    },
    {
      localPrinterName: 'Fake-USB-Printer',
      driverName: 'Fake USB Driver',
      portName: 'USB001',
      connectionType: 'usb',
      isDefault: false,
      isShared: false,
      attributes: { fake: true },
      ...meta,
    },
  ];
}

export type DiscoveryAdapterMode = 'auto' | 'windows' | 'macos' | 'fake';

/** Platform-aware discovery — side-effectful. Not directly tested (use pure parsers for unit tests). */
export async function discoverPrinters(mode: DiscoveryAdapterMode = 'auto'): Promise<DiscoveryItem[]> {
  if (mode === 'fake') return discoverFake();
  if (mode === 'windows') return discoverWindows();
  if (mode === 'macos') return discoverMacOs();
  // auto
  if (process.platform === 'win32') return discoverWindows();
  if (process.platform === 'darwin') return discoverMacOs();
  return discoverMacOs(); // linux falls back to CUPS too
}
