import { describe, it, expect } from 'vitest';
import { parseGetPrinterOutput, detectConnectionType } from './printer-discovery.js';

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
