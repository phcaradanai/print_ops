import { describe, it, expect } from 'vitest';
import {
  qrGeometry,
  renderBarcodeDataUri,
  renderZplQrGraphic,
} from '../infra/template/barcode-renderer.js';

describe('renderBarcodeDataUri', () => {
  it('renders a code128 barcode as a crisp SVG data URI', async () => {
    const uri = await renderBarcodeDataUri('ABC123', 'barcode', 'code128');
    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('<path');
  });

  it('defaults to bars-only output so HRI cannot overflow a fixed-height field', async () => {
    const barsOnly = await renderBarcodeDataUri('ABC123', 'barcode', 'code128');
    const withHri = await renderBarcodeDataUri('ABC123', 'barcode', 'code128', { includeText: true });
    const decode = (uri: string) => Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
    const barsOnlySvg = decode(barsOnly);
    const withHriSvg = decode(withHri);
    const barsOnlyHeight = Number(barsOnlySvg.match(/viewBox="0 0 \d+ (\d+)"/)?.[1]);
    const withHriHeight = Number(withHriSvg.match(/viewBox="0 0 \d+ (\d+)"/)?.[1]);
    expect(withHriSvg).not.toBe(barsOnlySvg);
    expect(withHriHeight).toBeGreaterThan(barsOnlyHeight);
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
    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('rejects data that is invalid for the requested symbology (ean13 requires 12-13 digits)', async () => {
    await expect(renderBarcodeDataUri('not-a-valid-ean', 'barcode', 'ean13')).rejects.toThrow();
  });

  it('renders code39 and datamatrix symbologies', async () => {
    await expect(renderBarcodeDataUri('HELLO', 'barcode', 'code39')).resolves.toMatch(/^data:image\/svg\+xml;base64,/);
    await expect(renderBarcodeDataUri('HELLO', 'barcode', 'datamatrix')).resolves.toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('keeps QR raster generation independent from its CSS physical size', async () => {
    const small = await renderBarcodeDataUri('HN-0001', 'qrcode', undefined, { qrSizeMm: 10 });
    const large = await renderBarcodeDataUri('HN-0001', 'qrcode', undefined, { qrSizeMm: 20 });
    expect(large).toBe(small);
  });

  it('produces a taller 1D barcode SVG when heightMm is doubled', async () => {
    const short = await renderBarcodeDataUri('ABC123', 'barcode', 'code128', { heightMm: 6 });
    const tall = await renderBarcodeDataUri('ABC123', 'barcode', 'code128', { heightMm: 18 });
    const shortSvg = Buffer.from(short.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
    const tallSvg = Buffer.from(tall.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
    const shortHeight = Number(shortSvg.match(/viewBox="0 0 \d+ (\d+)"/)?.[1]);
    const tallHeight = Number(tallSvg.match(/viewBox="0 0 \d+ (\d+)"/)?.[1]);
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
