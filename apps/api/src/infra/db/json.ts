/**
 * Safe JSON round-tripping for sql.js TEXT columns.
 * All domain entities store complex fields (capabilities, status, metadata,
 * steps, evidence, allowed_templates, match_rules, etc.) as JSON text.
 */

export function toJson(v: unknown): string {
  return JSON.stringify(v);
}

export function fromJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw as string) as T;
  } catch {
    return fallback;
  }
}

/** sql.js returns booleans as 0/1 from INTEGER columns. */
export function toBool(raw: unknown): boolean {
  return raw === 1 || raw === '1' || raw === true;
}

/** ISO-8601 string → Date (null-safe). */
export function toDate(raw: unknown): Date {
  return raw ? new Date(raw as string) : new Date();
}

/** Date → ISO-8601 string. */
export function dateStr(d: Date): string {
  return d.toISOString();
}