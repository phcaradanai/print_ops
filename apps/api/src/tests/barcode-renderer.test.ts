import { describe, it, expect } from 'vitest';
import {
  qrGeometry,
  renderBarcodeDataUri,
  renderZplQrGraphic,
} from '../infra/template/barcode-renderer.js';

describe('renderBarcodeDataUri', () => {
  it('renders a code128 barcode as a PNG data URI', async () => {
    const uri = await renderBarcodeDataUri('ABC123', 'barcode', 'code128');
    expect(uri).toMatch(/^data:image\/png;base64,/);
    // Decode enough to confirm it's a real PNG (magic bytes 89 50 4E 47).
    const b64 = uri.slice('data:image/png;base64,'.length);
    const bytes = Buffer.from(b64, 'base64');
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('renders a QR code as a vector data URI so printer-DPI scaling stays sharp', async () => {
    const uri = await renderBarcodeDataUri('HN-0001', 'qrcode');
    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });

  it('defaults to code128 when no symbology is given', async () => {
    const uri = await renderBarcodeDataUri('42', 'barcode');
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects data that is invalid for the requested symbology (ean13 requires 12-13 digits)', async () => {
    await expect(renderBarcodeDataUri('not-a-valid-ean', 'barcode', 'ean13')).rejects.toThrow();
  });

  it('renders code39 and datamatrix symbologies', async () => {
    await expect(renderBarcodeDataUri('HELLO', 'barcode', 'code39')).resolves.toMatch(/^data:image\/png;base64,/);
    await expect(renderBarcodeDataUri('HELLO', 'barcode', 'datamatrix')).resolves.toMatch(/^data:image\/png;base64,/);
  });

  it('keeps QR raster generation independent from its CSS physical size', async () => {
    const small = await renderBarcodeDataUri('HN-0001', 'qrcode', undefined, { qrSizeMm: 10 });
    const large = await renderBarcodeDataUri('HN-0001', 'qrcode', undefined, { qrSizeMm: 20 });
    expect(large).toBe(small);
  });

  it('produces a taller 1D barcode raster when heightMm is doubled', async () => {
    const short = await renderBarcodeDataUri('ABC123', 'barcode', 'code128', { heightMm: 6 });
    const tall = await renderBarcodeDataUri('ABC123', 'barcode', 'code128', { heightMm: 18 });
    const shortBytes = Buffer.from(short.slice('data:image/png;base64,'.length), 'base64');
    const tallBytes = Buffer.from(tall.slice('data:image/png;base64,'.length), 'base64');
    const shortHeight = shortBytes.readUInt32BE(20);
    const tallHeight = tallBytes.readUInt32BE(20);
    expect(tallHeight).toBeGreaterThan(shortHeight);
  });
});

describe('renderZplQrGraphic physical sizing', () => {
  const cases = [
    [10, 203, 80], [15, 203, 120], [20, 203, 160], [25, 203, 200], [30, 203, 240],
    [10, 300, 118], [15, 300, 177], [20, 300, 236], [25, 300, 295], [30, 300, 354],
    [10, 600, 236], [15, 600, 354], [20, 600, 472], [25, 600, 591], [30, 600, 709],
  ] as const;

  it.each(cases)('renders %dmm at %d DPI to %d symbol dots within ±0.1mm', (mm, dpi, dots) => {
    const graphic = renderZplQrGraphic('HN-0001', mm, dpi);
    expect(graphic.symbolDots).toBe(dots);
    expect(Math.abs(graphic.physicalSizeMm - mm)).toBeLessThanOrEqual(0.1);
    expect(graphic.command).toMatch(/^\^GFA,/);
    expect(graphic.command).toMatch(/\^FS$/);
    expect(graphic.quietZoneDots).toBeGreaterThan(0);
    expect(graphic.totalDots).toBe(graphic.symbolDots + graphic.quietZoneDots * 2);
  });

  it('keeps the four-module quiet zone outside the configured symbol size', () => {
    const graphic = renderZplQrGraphic('HN-0001', 20, 203);
    const geometry = qrGeometry('HN-0001', 20);
    expect(graphic.modules).toBe(21);
    expect(graphic.quietZoneDots).toBe(Math.round((graphic.symbolDots * 4) / graphic.modules));
    expect(graphic.physicalSizeMm).toBeCloseTo(20.02, 2);
    expect(geometry).toEqual({ modules: 21, quietZoneMm: (20 * 4) / 21 });
  });
});
