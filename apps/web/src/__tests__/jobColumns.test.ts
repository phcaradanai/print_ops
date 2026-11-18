import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOB_COLUMNS,
  JOB_COLUMNS_STORAGE_KEY,
  normalizeJobColumns,
  parseStoredJobColumns,
  readStoredJobColumns,
  serializeJobColumns,
  visibleJobColumns,
  writeStoredJobColumns,
} from '../lib/jobColumns.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    read: (key: string) => data.get(key) ?? null,
  };
}

describe('job columns', () => {
  it('ships destination + received by default, with job, status and actions fixed', () => {
    expect([...DEFAULT_JOB_COLUMNS]).toEqual(['destination', 'received']);
    expect(visibleJobColumns(DEFAULT_JOB_COLUMNS)).toEqual([
      'job',
      'destination',
      'status',
      'received',
      'actions',
    ]);
  });

  it('keeps the canonical order regardless of click order', () => {
    expect(visibleJobColumns(['error', 'copies', 'destination'])).toEqual([
      'job',
      'destination',
      'status',
      'copies',
      'error',
      'actions',
    ]);
    expect(visibleJobColumns(['template', 'station'])).toEqual([
      'job',
      'station',
      'status',
      'template',
      'actions',
    ]);
  });

  it('never lets the fixed columns be removed or duplicated', () => {
    const all = visibleJobColumns(['job', 'status', 'actions', 'station', 'station']);
    expect(all).toEqual(['job', 'station', 'status', 'actions']);
    expect(visibleJobColumns([])).toEqual(['job', 'status', 'actions']);
  });

  it('drops unknown ids and duplicates from stored input', () => {
    expect(normalizeJobColumns(['copies', 'legacy_column', 'copies', 'source'])).toEqual([
      'copies',
      'source',
    ]);
  });

  it('falls back to the default for unreadable, non-array or foreign stored values', () => {
    expect(parseStoredJobColumns(null)).toEqual([...DEFAULT_JOB_COLUMNS]);
    expect(parseStoredJobColumns('')).toEqual([...DEFAULT_JOB_COLUMNS]);
    expect(parseStoredJobColumns('not json')).toEqual([...DEFAULT_JOB_COLUMNS]);
    expect(parseStoredJobColumns('{"columns":["copies"]}')).toEqual([...DEFAULT_JOB_COLUMNS]);
    expect(parseStoredJobColumns('["copies"]')).toEqual(['copies']);
    expect(parseStoredJobColumns('[]')).toEqual([]);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    writeStoredJobColumns(['runner', 'copies'], storage);
    expect(storage.read(JOB_COLUMNS_STORAGE_KEY)).toBe('["copies","runner"]');
    expect(readStoredJobColumns(storage)).toEqual(['copies', 'runner']);
  });

  it('reads the default when storage is missing or throws', () => {
    expect(readStoredJobColumns(null)).toEqual([...DEFAULT_JOB_COLUMNS]);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredJobColumns(throwing)).toEqual([...DEFAULT_JOB_COLUMNS]);
    expect(() =>
      writeStoredJobColumns(['copies'], {
        setItem: () => {
          throw new Error('full');
        },
      }),
    ).not.toThrow();
  });
});
