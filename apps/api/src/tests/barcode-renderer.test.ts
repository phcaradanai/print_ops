import { describe, it, expect } from 'vitest';
import { renderBarcodeDataUri } from '../infra/template/barcode-renderer.js';

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

  it('renders a QR code as a PNG data URI', async () => {
    const uri = await renderBarcodeDataUri('HN-0001', 'qrcode');
    expect(uri).toMatch(/^data:image\/png;base64,/);
    const bytes = Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64');
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
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
