import { describe, it, expect } from 'vitest';
import { renderBarcodeSvg } from '../lib/barcode.js';

describe('renderBarcodeSvg', () => {
  it('renders a code128 barcode as SVG', () => {
    const svg = renderBarcodeSvg('ABC123', 'barcode', 'code128');
    expect(svg).toBeDefined();
    expect(svg).toContain('<svg');
  });

  it('renders a QR code as SVG', () => {
    const svg = renderBarcodeSvg('HN-0001', 'qrcode');
    expect(svg).toBeDefined();
    expect(svg).toContain('<svg');
  });

  it('returns undefined for empty data instead of throwing', () => {
    expect(renderBarcodeSvg('', 'barcode')).toBeUndefined();
  });

  it('returns undefined (not a throw) for data invalid in the requested symbology', () => {
    expect(renderBarcodeSvg('not-a-valid-ean', 'barcode', 'ean13')).toBeUndefined();
  });
});
