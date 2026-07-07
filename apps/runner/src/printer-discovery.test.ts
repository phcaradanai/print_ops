import { describe, it, expect } from 'vitest';
import {
  parseGetPrinterOutput,
  detectConnectionType,
  detectCupsConnectionType,
  parseLpstatPOutput,
  parseLpstatVOutput,
  parseLpstatDOutput,
  parseCupsPrinters,
  discoverPrinters,
} from './printer-discovery.js';

describe('detectConnectionType', () => {
  it('detects USB from USB001 port', () => {
    expect(detectConnectionType('USB001')).toBe('usb');
  });

  it('detects tcp_ip from IP address port', () => {
    expect(detectConnectionType('192.168.1.100')).toBe('tcp_ip');
    expect(detectConnectionType('IP_192.168.1.100')).toBe('tcp_ip');
  });

  it('detects wsd from WSD port', () => {
    expect(detectConnectionType('WSD-abc123')).toBe('wsd');
  });

  it('detects lpt_com from LPT1', () => {
    expect(detectConnectionType('LPT1')).toBe('lpt_com');
    expect(detectConnectionType('COM3')).toBe('lpt_com');
  });

  it('detects network_share from UNC path', () => {
    expect(detectConnectionType('\\\\printserver\\HP_Laser')).toBe('network_share');
  });

  it('returns unknown for unrecognised port', () => {
    expect(detectConnectionType('NMPIPE001')).toBe('unknown');
    expect(detectConnectionType(undefined)).toBe('unknown');
  });
});

describe('parseGetPrinterOutput', () => {
  it('parses a JSON array of printers', () => {
    const raw = JSON.stringify([
      { Name: 'HP LaserJet', DriverName: 'HP Universal PCL6', PortName: 'USB001', Shared: false, Default: true },
      { Name: 'Zebra ZD420', DriverName: 'ZDesigner ZD420', PortName: '192.168.1.50', Shared: true, Default: false },
    ]);
    const items = parseGetPrinterOutput(raw);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ localPrinterName: 'HP LaserJet', connectionType: 'usb', isDefault: true, isShared: false });
    expect(items[1]).toMatchObject({ localPrinterName: 'Zebra ZD420', connectionType: 'tcp_ip', isDefault: false, isShared: true });
  });

  it('parses a single-object JSON (not array) as PowerShell does for one printer', () => {
    const raw = JSON.stringify({ Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:', Shared: false, Default: false });
    const items = parseGetPrinterOutput(raw);
    expect(items).toHaveLength(1);
    expect(items[0]?.localPrinterName).toBe('Microsoft Print to PDF');
  });

  it('returns empty array for empty JSON array', () => {
    expect(parseGetPrinterOutput('[]')).toHaveLength(0);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseGetPrinterOutput('not json at all')).toHaveLength(0);
    expect(parseGetPrinterOutput('')).toHaveLength(0);
  });

  it('skips records with missing or empty Name', () => {
    const raw = JSON.stringify([
      { Name: '', DriverName: 'some driver', PortName: 'USB001' },
      { Name: 'Valid Printer', PortName: 'USB002' },
    ]);
    const items = parseGetPrinterOutput(raw);
    expect(items).toHaveLength(1);
    expect(items[0]?.localPrinterName).toBe('Valid Printer');
  });
});

// ── macOS CUPS parsers ───────────────────────────────────────────────────────

describe('detectCupsConnectionType', () => {
  it('detects usb from usb:// URI', () => {
    expect(detectCupsConnectionType('usb://HP/LaserJet?serial=ABC')).toBe('usb');
  });

  it('detects tcp_ip from socket URI', () => {
    expect(detectCupsConnectionType('socket://192.168.1.50:9100')).toBe('tcp_ip');
  });

  it('detects tcp_ip from ipp URI', () => {
    expect(detectCupsConnectionType('ipp://192.168.0.10/printers/Office')).toBe('tcp_ip');
    expect(detectCupsConnectionType('ipps://printer.local/ipp/print')).toBe('tcp_ip');
  });

  it('detects tcp_ip from dnssd URI', () => {
    expect(detectCupsConnectionType('dnssd://HP%20LaserJet._ipp._tcp.local/')).toBe('tcp_ip');
  });

  it('detects tcp_ip from lpd URI', () => {
    expect(detectCupsConnectionType('lpd://192.168.1.20/queue')).toBe('tcp_ip');
  });

  it('returns unknown for unrecognised URI', () => {
    expect(detectCupsConnectionType('file:///dev/usb/lp0')).toBe('unknown');
    expect(detectCupsConnectionType('')).toBe('unknown');
  });
});

describe('parseLpstatPOutput', () => {
  const sample = [
    'printer HP_LaserJet is idle.  enabled since Mon Jan  1 00:00:00 2024',
    'printer Zebra_ZD420 processing  since Mon Jan  1 00:00:00 2024',
    'printer OfficeJet disabled since Mon Jan  1 00:00:00 2024 -',
    'some other line that should be ignored',
  ].join('\n');

  it('parses printer names and statuses', () => {
    const result = parseLpstatPOutput(sample);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: 'HP_LaserJet', status: 'idle' });
    expect(result[1]).toEqual({ name: 'Zebra_ZD420', status: 'processing' });
    expect(result[2]).toEqual({ name: 'OfficeJet', status: 'disabled' });
  });

  it('returns empty array for empty input', () => {
    expect(parseLpstatPOutput('')).toHaveLength(0);
    expect(parseLpstatPOutput('lpstat: No destinations added.')).toHaveLength(0);
  });
});

describe('parseLpstatVOutput', () => {
  const sample = [
    'device for HP_LaserJet: usb://HP/LaserJet%20Pro?serial=XYZ',
    'device for Zebra_ZD420: socket://192.168.1.50:9100',
    'device for OfficeJet: ipp://192.168.0.10/printers/OfficeJet',
  ].join('\n');

  it('parses device URIs into a name→uri map', () => {
    const map = parseLpstatVOutput(sample);
    expect(map.size).toBe(3);
    expect(map.get('HP_LaserJet')).toBe('usb://HP/LaserJet%20Pro?serial=XYZ');
    expect(map.get('Zebra_ZD420')).toBe('socket://192.168.1.50:9100');
    expect(map.get('OfficeJet')).toBe('ipp://192.168.0.10/printers/OfficeJet');
  });

  it('returns empty map for empty input', () => {
    expect(parseLpstatVOutput('').size).toBe(0);
  });
});

describe('parseLpstatDOutput', () => {
  it('extracts default printer name', () => {
    expect(parseLpstatDOutput('system default destination: HP_LaserJet')).toBe('HP_LaserJet');
    expect(parseLpstatDOutput('system default destination: HP_LaserJet\n')).toBe('HP_LaserJet');
  });

  it('returns undefined when no default is set', () => {
    expect(parseLpstatDOutput('no system default destination')).toBeUndefined();
    expect(parseLpstatDOutput('')).toBeUndefined();
    expect(parseLpstatDOutput('lpstat: No destinations added.')).toBeUndefined();
  });
});

describe('parseCupsPrinters', () => {
  const lpstatP = [
    'printer HP_LaserJet is idle.  enabled since Mon Jan  1 00:00:00 2024',
    'printer Zebra_ZD420 is idle.  enabled since Mon Jan  1 00:00:00 2024',
  ].join('\n');
  const lpstatV = [
    'device for HP_LaserJet: usb://HP/LaserJet%20Pro?serial=XYZ',
    'device for Zebra_ZD420: socket://192.168.1.50:9100',
  ].join('\n');
  const lpstatD = 'system default destination: HP_LaserJet';

  it('combines lpstat outputs into DiscoveryItems', () => {
    const items = parseCupsPrinters(lpstatP, lpstatV, lpstatD);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      localPrinterName: 'HP_LaserJet',
      connectionType: 'usb',
      isDefault: true,
      isShared: false,
    });
    expect(items[1]).toMatchObject({
      localPrinterName: 'Zebra_ZD420',
      connectionType: 'tcp_ip',
      isDefault: false,
    });
  });

  it('handles printer with no URI in lpstat -v', () => {
    const items = parseCupsPrinters(lpstatP, '', lpstatD);
    expect(items).toHaveLength(2);
    expect(items[0]?.connectionType).toBe('unknown');
  });

  it('returns empty array when lpstat -p has no printers', () => {
    expect(parseCupsPrinters('', lpstatV, lpstatD)).toHaveLength(0);
    expect(parseCupsPrinters('lpstat: No destinations added.', lpstatV, lpstatD)).toHaveLength(0);
  });

  it('marks no printer as default when lpstat -d is empty', () => {
    const items = parseCupsPrinters(lpstatP, lpstatV, '');
    expect(items.every((i) => !i.isDefault)).toBe(true);
  });
});

describe('discoverPrinters (fake adapter)', () => {
  it('returns two fake printers with computerName and osName', async () => {
    const items = await discoverPrinters('fake');
    expect(items).toHaveLength(2);
    expect(items[0]?.localPrinterName).toBe('Fake-Label-Printer');
    expect(items[1]?.localPrinterName).toBe('Fake-USB-Printer');
    expect(items[0]?.computerName).toBeTruthy();
    expect(items[0]?.osName).toBeTruthy();
  });

  it('fake items have correct connection types', async () => {
    const items = await discoverPrinters('fake');
    expect(items[0]?.connectionType).toBe('tcp_ip');
    expect(items[1]?.connectionType).toBe('usb');
  });
});
