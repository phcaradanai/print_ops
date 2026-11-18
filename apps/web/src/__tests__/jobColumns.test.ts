import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOB_COLUMNS,
  JOB_COLUMNS_STORAGE_KEY,
  MAX_PAYLOAD_COLUMNS,
  isPayloadColumnId,
  normalizeJobColumns,
  parseStoredJobColumns,
  payloadColumnId,
  payloadColumnKey,
  readStoredJobColumns,
  serializeJobColumns,
  visibleJobColumns,
  writeStoredJobColumns,
  type JobTableColumn,
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

/** Built-in ids and payload keys in render order, for readable assertions. */
function rendered(columns: JobTableColumn[]): string[] {
  return columns.map((column) => (column.kind === 'builtin' ? column.id : column.key));
}

describe('job columns', () => {
  it('ships reference + destination + received by default, with status and actions fixed', () => {
    expect([...DEFAULT_JOB_COLUMNS]).toEqual(['job', 'destination', 'received']);
    expect(rendered(visibleJobColumns(DEFAULT_JOB_COLUMNS))).toEqual([
      'job',
      'destination',
      'status',
      'received',
      'actions',
    ]);
  });

  it('lets the reference column go, but never status or actions', () => {
    expect(rendered(visibleJobColumns(['destination', 'received']))).toEqual([
      'destination',
      'status',
      'received',
      'actions',
    ]);
    expect(rendered(visibleJobColumns(['job', 'copies']))).toEqual([
      'job',
      'status',
      'copies',
      'actions',
    ]);
  });

  it('keeps the canonical order regardless of click order', () => {
    expect(rendered(visibleJobColumns(['error', 'copies', 'destination']))).toEqual([
      'destination',
      'status',
      'copies',
      'error',
      'actions',
    ]);
    expect(rendered(visibleJobColumns(['template', 'station']))).toEqual([
      'station',
      'status',
      'template',
      'actions',
    ]);
  });

  it('never lets the fixed columns be removed or duplicated', () => {
    const all = visibleJobColumns(['status', 'actions', 'station', 'station']);
    expect(rendered(all)).toEqual(['station', 'status', 'actions']);
    expect(rendered(visibleJobColumns([]))).toEqual(['status', 'actions']);
  });

  it('puts incoming-value columns after the job fields and before Actions, in click order', () => {
    const columns = visibleJobColumns(['payload:patient_name', 'copies', 'payload:hn', 'job']);
    expect(rendered(columns)).toEqual([
      'job',
      'status',
      'copies',
      'patient_name',
      'hn',
      'actions',
    ]);
    expect(columns.filter((column) => column.kind === 'payload')).toEqual([
      { kind: 'payload', id: 'payload:patient_name', key: 'patient_name' },
      { kind: 'payload', id: 'payload:hn', key: 'hn' },
    ]);
  });

  it('caps incoming-value columns, generously enough for a wide screen', () => {
    // The ceiling stops "select everything", not the fourth value an operator
    // actually needs; past it the extra ids are dropped in click order.
    const selected = Array.from({ length: MAX_PAYLOAD_COLUMNS + 2 }, (_, index) =>
      payloadColumnId(`key-${index}`),
    );
    const payloads = visibleJobColumns(selected).filter((column) => column.kind === 'payload');
    expect(payloads).toHaveLength(MAX_PAYLOAD_COLUMNS);
    expect(payloads.map((column) => (column.kind === 'payload' ? column.key : ''))).toEqual(
      Array.from({ length: MAX_PAYLOAD_COLUMNS }, (_, index) => `key-${index}`),
    );
    expect(MAX_PAYLOAD_COLUMNS).toBeGreaterThan(3);
  });

  it('round-trips payload column ids and rejects malformed ones', () => {
    expect(isPayloadColumnId('payload:hn')).toBe(true);
    expect(isPayloadColumnId('payload:')).toBe(false);
    expect(isPayloadColumnId('hn')).toBe(false);
    expect(payloadColumnKey('payload:hn')).toBe('hn');

    expect(normalizeJobColumns(['payload:', 'payload:hn', 'hn', 'legacy', 'payload:hn'])).toEqual([
      'payload:hn',
    ]);
  });

  it('drops unknown built-in ids but keeps valid payload ids from stored input', () => {
    expect(normalizeJobColumns(['copies', 'legacy_column', 'copies', 'source'])).toEqual([
      'copies',
      'source',
    ]);
    expect(parseStoredJobColumns('["copies","payload:hn"]')).toEqual(['copies', 'payload:hn']);
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
    writeStoredJobColumns(['runner', 'payload:hn', 'copies'], storage);
    expect(storage.read(JOB_COLUMNS_STORAGE_KEY)).toBe('["copies","runner","payload:hn"]');
    expect(readStoredJobColumns(storage)).toEqual(['copies', 'runner', 'payload:hn']);
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
