import { describe, expect, it } from 'vitest';
import type { PaperProfile } from '@printerops/domain';
import { composeDatamaxDplRows, renderDatamaxDpl } from './datamax-dpl-renderer.js';

function profile(overrides: Partial<PaperProfile> = {}): PaperProfile {
  return {
    id: 'paper-profile',
    code: 'DATAMAX_CELL',
    name: 'Datamax cell',
    widthMm: 30,
    heightMm: 11,
    marginTopMm: 0,
    marginRightMm: 0,
    marginBottomMm: 0,
    marginLeftMm: 0,
    dpi: 203,
    orientation: 'landscape',
    unit: 'mm',
    fields: [{
      id: 'barcode-field',
      key: 'barcode',
      label: 'Barcode',
      defaultValue: '',
      type: 'barcode',
      barcodeSymbology: 'code128',
      barcodeWidthMm: 26,
      barcodeHeightMm: 8,
      xMm: 0,
      yMm: 0,
      fontSize: 8,
      bold: false,
      color: '#000000',
      align: 'center',
    }],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function barcodeRecord(dpl: string): string {
  const record = dpl.split('\r').find((line) => /^[1-4]E/.test(line));
  if (!record) throw new Error(`No native barcode record in ${JSON.stringify(dpl)}`);
  return record;
}

describe('Datamax native DPL renderer', () => {
  it('uses native Code 128 with integer module width and a cell safe area', () => {
    const result = renderDatamaxDpl('{{barcode:barcode}}', { barcode: '12345678' }, profile());
    const record = barcodeRecord(result.dpl);

    expect(result.dpl).toContain('\x02L\rm\rD11\r');
    expect(record).toMatch(/^1E2[1-9]\d{3}\d{4}\d{4}C12345678$/);
    expect(result.dpl).not.toContain('<svg');
    expect(Number(record.slice(3, 4))).toBeGreaterThanOrEqual(1);
    expect(Number(record.slice(7, 11))).toBeGreaterThanOrEqual(10);
    expect(Number(record.slice(11, 15))).toBeGreaterThanOrEqual(10);
    expect(Number(record.slice(11, 15))).toBeLessThan(290);
    expect(record.slice(4, 7)).toBe('070');
    expect(record.slice(7, 11)).toBe('0015');
    expect(record.slice(11, 15)).toBe('0051');
  });

  it('centers the rendered footprint after a quarter-turn and rejects an impossible fit', () => {
    const rotated = renderDatamaxDpl(
      '{{barcode:barcode}}',
      { barcode: '123456' },
      profile({ widthMm: 50, heightMm: 40, rotation: 90 }),
    );
    const record = barcodeRecord(rotated.dpl);
    expect(record[0]).toBe('2');
    expect(record.slice(7, 11)).toBe('0328');
    expect(record.slice(11, 15)).toBe('0210');
    expect(Number(record.slice(7, 11))).toBeGreaterThan(10);
    expect(Number(record.slice(7, 11))).toBeLessThan(390);
    expect(Number(record.slice(11, 15))).toBeGreaterThan(10);
    expect(Number(record.slice(11, 15))).toBeLessThan(490);

    const rotated270 = renderDatamaxDpl(
      '{{barcode:barcode}}',
      { barcode: '123456' },
      profile({ widthMm: 50, heightMm: 40, rotation: 270 }),
    );
    const record270 = barcodeRecord(rotated270.dpl);
    expect(record270[0]).toBe('4');
    expect(record270.slice(7, 11)).toBe('0073');
    expect(record270.slice(11, 15)).toBe('0290');

    expect(() => renderDatamaxDpl(
      '{{barcode:barcode}}',
      { barcode: '123456' },
      profile({ rotation: 90 }),
    )).toThrow(/does not fit the rotated cell safe area/);
  });
  it('keeps short, baseline, odd, and long values dynamic without clipping', () => {
    const values = ['1234', '1234567', '12345678', '123456789012'];
    const records = values.map((value) => barcodeRecord(
      renderDatamaxDpl('{{barcode:barcode}}', { barcode: value }, profile()).dpl,
    ));

    records.forEach((record, index) => {
      const value = values[index]!;
      expect(record).toContain(`C${value}`);
      if (value.length < 8) expect(record).not.toContain(`C${value.padStart(8, '0')}`);
      expect(Number(record[3])).toBeGreaterThanOrEqual(1);
      expect(Number(record.slice(7, 11))).toBe(15);
      expect(Number(record.slice(11, 15))).toBeGreaterThanOrEqual(10);
    });
    expect(records[0]![3]).toBe('3');
    expect(records[1]![3]).toBe('2');
    expect(records[2]![3]).toBe('2');
    expect(records[3]![3]).toBe('2');
  });

  it('places three labels in one physical row and starts the fourth on the next row', () => {
    const cell = profile();
    const media: PaperProfile = {
      ...cell,
      id: 'media-profile',
      widthMm: 98,
      layout: {
        columns: 3,
        cellWidthMm: 30,
        cellHeightMm: 11,
        columnGapMm: 2,
        rowPitchMm: 13,
      },
    };
    const labels = ['000001', '000002', '000003', '000004'].map((value) =>
      renderDatamaxDpl('{{barcode:barcode}}', { barcode: value }, cell).dpl,
    );
    const output = composeDatamaxDplRows(labels, media);
    const records = output.split('\r').filter((line) => /^[1-4]E/.test(line));
    const formatBlocks = output.match(/\x02L\rm\rD11\r/g) ?? [];
    expect(formatBlocks).toHaveLength(2);
    expect(records).toHaveLength(4);
    expect(Number(records[0]!.slice(11, 15))).toBeLessThan(Number(records[1]!.slice(11, 15)));
    expect(Number(records[1]!.slice(11, 15))).toBeLessThan(Number(records[2]!.slice(11, 15)));
    expect(records[3]).toContain('C000004');
  });
});
