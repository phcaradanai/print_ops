import { describe, expect, it } from 'vitest';
import { resizeFieldPatch } from '../model/fieldGeometry.js';
import type { DynamicField } from '../model/types.js';

const base = { id: 'f', key: 'k', label: '', defaultValue: '', xMm: 5, yMm: 5, fontSize: 10, bold: false, color: '#000', align: 'left' } as const;
const field = (patch: Partial<DynamicField>) => ({ ...base, type: 'text', ...patch }) as DynamicField;

describe('canvas resize handle', () => {
  it('grows a left-aligned barcode by the drag and clamps to the allowed range', () => {
    expect(resizeFieldPatch(field({ type: 'barcode', barcodeWidthMm: 30, barcodeHeightMm: 10 }), 5, 2, 10))
      .toEqual({ barcodeWidthMm: 35, barcodeHeightMm: 12 });
    expect(resizeFieldPatch(field({ type: 'barcode', barcodeWidthMm: 30, barcodeHeightMm: 10 }), -100, 100, 10))
      .toEqual({ barcodeWidthMm: 4, barcodeHeightMm: 60 });
  });

  it('accounts for the anchor: centered grows twice, right-aligned grows leftwards', () => {
    expect(resizeFieldPatch(field({ type: 'barcode', align: 'center', barcodeWidthMm: 30, barcodeHeightMm: 10 }), 5, 0, 10).barcodeWidthMm).toBe(40);
    expect(resizeFieldPatch(field({ type: 'barcode', align: 'right', barcodeWidthMm: 30, barcodeHeightMm: 10 }), -5, 0, 10).barcodeWidthMm).toBe(35);
  });

  it('keeps a QR code square, following the larger drag', () => {
    expect(resizeFieldPatch(field({ type: 'qrcode', qrSizeMm: 20 }), 2, 6, 20)).toEqual({ qrSizeMm: 26 });
  });

  it('scales text font size with the box height', () => {
    expect(resizeFieldPatch(field({ fontSize: 10 }), 0, 5, 5)).toEqual({ fontSize: 20 });
    expect(resizeFieldPatch(field({ fontSize: 10 }), 0, -100, 5)).toEqual({ fontSize: 6 });
  });
});
