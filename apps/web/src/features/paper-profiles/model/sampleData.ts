import type { DynamicField } from './types.js';

/** Looks up a dotted key the way the server's valueAt() does ("patient.hn"). */
function valueAt(data: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (current, part) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined),
    data,
  );
}

/**
 * Preview-only: shows each field with the value a real job payload would give it.
 * Fields the payload doesn't mention keep their own sample value.
 */
export function applySampleData(fields: DynamicField[], json: string): { fields: DynamicField[]; error: boolean } {
  if (!json.trim()) return { fields, error: false };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { fields, error: true };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { fields, error: true };
  return {
    fields: fields.map((field) => {
      const value = valueAt(data, field.key);
      return value == null || typeof value === 'object' ? field : { ...field, defaultValue: String(value) };
    }),
    error: false,
  };
}
