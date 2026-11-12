import type { DynamicField } from './types.js';

/** localStorage, not the system clipboard: works across profiles and tabs without a permission prompt. */
const CLIPBOARD_KEY = 'printops.paperProfiles.clipboard';

export function copyFieldsToClipboard(fields: DynamicField[], storage: Storage = localStorage): void {
  if (fields.length) storage.setItem(CLIPBOARD_KEY, JSON.stringify(fields));
}

/** Fields previously copied, or [] when nothing usable is stored. */
export function readFieldsFromClipboard(storage: Storage = localStorage): DynamicField[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CLIPBOARD_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f): f is DynamicField => Boolean(f) && typeof f === 'object'
      && typeof f.type === 'string' && typeof f.key === 'string'
      && Number.isFinite(f.xMm) && Number.isFinite(f.yMm));
  } catch {
    return [];
  }
}
