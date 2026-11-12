import { describe, expect, it } from 'vitest';
import { applySampleData } from '../model/sampleData.js';
import type { DynamicField } from '../model/types.js';

const field = (key: string): DynamicField => ({
  id: key, key, label: key, defaultValue: 'sample', type: 'text',
  xMm: 0, yMm: 0, fontSize: 10, bold: false, color: '#000000', align: 'left',
});

describe('applySampleData', () => {
  it('fills fields from a payload, including dotted keys, and keeps the rest', () => {
    const { fields, error } = applySampleData([field('name'), field('patient.hn'), field('missing')],
      '{"name":"สมชาย ใจดี","patient":{"hn":12345}}');
    expect(error).toBe(false);
    expect(fields.map((f) => f.defaultValue)).toEqual(['สมชาย ใจดี', '12345', 'sample']);
  });

  it('flags invalid JSON or a non-object without changing fields', () => {
    const original = [field('name')];
    expect(applySampleData(original, '{oops')).toEqual({ fields: original, error: true });
    expect(applySampleData(original, '[1]')).toEqual({ fields: original, error: true });
    expect(applySampleData(original, '  ')).toEqual({ fields: original, error: false });
  });
});
