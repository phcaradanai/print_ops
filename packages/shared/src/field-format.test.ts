import { describe, expect, it } from 'vitest';
import { formatFieldValue } from './field-format.js';

describe('formatFieldValue', () => {
  it('formats dates from their written components, including the Buddhist year', () => {
    expect(formatFieldValue({ type: 'date', dateFormat: 'DD/MM/BBBB' }, '2026-11-12')).toBe('12/11/2569');
    expect(formatFieldValue({ type: 'date', dateFormat: 'YY-MM-DD HH:mm' }, '2026-01-02T23:59:00Z')).toBe('26-01-02 23:59');
    expect(formatFieldValue({ type: 'date', dateFormat: 'DD/MM/YYYY' }, 'tomorrow')).toBe('tomorrow');
  });

  it('formats numbers with decimals and thousands', () => {
    expect(formatFieldValue({ type: 'number', decimals: 2, thousands: true }, '1234567.5')).toBe('1,234,567.50');
    expect(formatFieldValue({ type: 'number', thousands: true }, '-1234')).toBe('-1,234');
    expect(formatFieldValue({ type: 'number', decimals: 0 }, 'n/a')).toBe('n/a');
  });

  it('adds prefix and suffix, but never to barcode data', () => {
    expect(formatFieldValue({ type: 'text', prefix: 'HN: ', suffix: ' *' }, '123')).toBe('HN: 123 *');
    expect(formatFieldValue({ type: 'barcode', prefix: 'X' }, '123')).toBe('123');
  });
});
