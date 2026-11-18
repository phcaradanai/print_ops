/**
 * One-pass `{name}` interpolation, matching the app's i18n convention.
 *
 * The dictionaries deliberately use whole-token placeholders instead of ICU, so
 * `{count}` never depends on English word order and a Thai string can put it
 * anywhere. This lives in `lib` because more than one surface needs it; keeping
 * a private copy in each page is how the copies drift.
 */
export function formatMessage(
  template: string,
  vars: Record<string, string | number>,
): string {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}
