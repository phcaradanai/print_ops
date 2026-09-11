import { describe, expect, it } from 'vitest';
import { qrQuietZoneUpperBoundMm, resolveRenderTransform, resolveRenderTransformFrame } from '@printerops/shared';
import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_BARCODE_WIDTH_MM, DEFAULT_QR_SIZE_MM } from '../model/defaults.js';
import { getVisualPaperGeometry } from '../model/geometry.js';
import { getDynamicFieldTransformedBounds, validateDynamicFields } from '../model/validation.js';
import type { DynamicField, PaperForm } from '../model/types.js';

const form: PaperForm = {
  code: 'TEST',
  name: 'Test label',
  widthMm: 100,
  heightMm: 50,
  marginTopMm: 2,
  marginRightMm: 2,
  marginBottomMm: 2,
  marginLeftMm: 2,
  dpi: 203,
  orientation: 'landscape',
  unit: 'mm',
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
};

function field(overrides: Partial<DynamicField> = {}): DynamicField {
  return {
    id: 'field-1',
    key: 'value',
    label: 'Value',
    defaultValue: 'Sample',
    type: 'text',
    xMm: 10,
    yMm: 10,
    fontSize: 12,
    bold: false,
    color: '#111827',
    align: 'left',
    ...overrides,
  };
}

describe('paper profile field transform bounds', () => {
  it.each([0, 90, 180, 270])('keeps a centered field inside the frame at %d°', (rotation) => {
    const candidate = { ...form, rotation };
    const bounds = getDynamicFieldTransformedBounds(candidate, field({ xMm: 44, yMm: 18 }));
    const geometry = getVisualPaperGeometry(candidate);
    const frame = resolveRenderTransformFrame(
      geometry.widthMm,
      geometry.heightMm,
      resolveRenderTransform(candidate),
    );

    expect(bounds.minX).toBeGreaterThanOrEqual(-0.0001);
    expect(bounds.minY).toBeGreaterThanOrEqual(-0.0001);
    expect(bounds.maxX).toBeLessThanOrEqual(frame.width + 0.0001);
    expect(bounds.maxY).toBeLessThanOrEqual(frame.height + 0.0001);
  });

  it.each([
    { flipHorizontal: true, flipVertical: false },
    { flipHorizontal: false, flipVertical: true },
    { flipHorizontal: true, flipVertical: true },
  ])('keeps a rectangular barcode inside the frame with flips', (flips) => {
    const candidate = { ...form, rotation: 180, ...flips };
    expect(validateDynamicFields(candidate, [field({
      type: 'barcode',
      xMm: 34,
      yMm: 15,
      barcodeWidthMm: DEFAULT_BARCODE_WIDTH_MM,
      barcodeHeightMm: DEFAULT_BARCODE_HEIGHT_MM,
    })])).toEqual([]);
  });

  it('keeps QR content near every paper edge inside all quarter-turn frames', () => {
    const qrOuterSize = DEFAULT_QR_SIZE_MM + qrQuietZoneUpperBoundMm(DEFAULT_QR_SIZE_MM) * 2;
    const positions = [
      [0, 0],
      [geometryWidth(form) - qrOuterSize, 0],
      [0, geometryHeight(form) - qrOuterSize],
      [geometryWidth(form) - qrOuterSize, geometryHeight(form) - qrOuterSize],
    ];
    for (const rotation of [0, 90, 180, 270]) {
      for (const flipHorizontal of [false, true]) {
        for (const flipVertical of [false, true]) {
          const candidate = { ...form, rotation, flipHorizontal, flipVertical };
          expect(validateDynamicFields(candidate, positions.map(([xMm, yMm], index) => field({
            id: `qr-${index}`,
            type: 'qrcode',
            xMm,
            yMm,
            qrSizeMm: DEFAULT_QR_SIZE_MM,
          })))).toEqual([]);
        }
      }
    }
  });

  it('uses the portrait visual coordinate system for QR and text fields', () => {
    const candidate = { ...form, orientation: 'portrait' as const, rotation: 90, flipVertical: true };
    expect(validateDynamicFields(candidate, [
      field({ id: 'qr', type: 'qrcode', xMm: 30, yMm: 35, qrSizeMm: DEFAULT_QR_SIZE_MM }),
      field({ id: 'text', xMm: 40, yMm: 20, defaultValue: 'HN-123' }),
    ])).toEqual([]);
  });

  it('reports content that crosses the paper edge instead of moving it', () => {
    const candidate = { ...form, rotation: 270, flipHorizontal: true };
    const candidateField = field({ type: 'qrcode', xMm: 95, yMm: 40, qrSizeMm: DEFAULT_QR_SIZE_MM });
    const bounds = getDynamicFieldTransformedBounds(candidate, candidateField);
    const geometry = getVisualPaperGeometry(candidate);
    const frame = resolveRenderTransformFrame(
      geometry.widthMm,
      geometry.heightMm,
      resolveRenderTransform(candidate),
    );

    expect(validateDynamicFields(candidate, [candidateField])).toEqual([
      { field: 'fields.field-1', messageKey: 'validation.fieldOutsidePaper' },
    ]);
    expect(bounds.maxX > frame.width || bounds.maxY > frame.height || bounds.minX < 0 || bounds.minY < 0).toBe(true);
  });
});

function geometryWidth(profile: PaperForm): number {
  return profile.widthMm - profile.marginLeftMm - profile.marginRightMm;
}

function geometryHeight(profile: PaperForm): number {
  return profile.heightMm - profile.marginTopMm - profile.marginBottomMm;
}
