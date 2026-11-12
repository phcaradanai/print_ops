import { describe, expect, it } from 'vitest';
import { copyFieldsToClipboard, readFieldsFromClipboard } from '../model/clipboard.js';
import type { DynamicField } from '../model/types.js';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) } as Storage;
}

describe('field clipboard', () => {
  it('round-trips fields and drops anything malformed', () => {
    const storage = memoryStorage();
    const field = { id: 'a', key: 'hn', label: '', defaultValue: '', type: 'text', xMm: 1, yMm: 2, fontSize: 9, bold: false, color: '#000', align: 'left' } as DynamicField;
    copyFieldsToClipboard([field], storage);
    expect(readFieldsFromClipboard(storage)).toEqual([field]);
    storage.setItem('printops.paperProfiles.clipboard', '[{"type":"text"},null,"x"]');
    expect(readFieldsFromClipboard(storage)).toEqual([]);
    storage.setItem('printops.paperProfiles.clipboard', '{oops');
    expect(readFieldsFromClipboard(storage)).toEqual([]);
  });
});
