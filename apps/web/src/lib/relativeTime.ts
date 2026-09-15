/**
 * "How long ago" formatting (FE-01.1).
 *
 * `Runners.tsx` and `LocalDiagnostics.tsx` carried byte-identical copies of
 * this ladder. FE-01.1 needs a third caller — the last-success timestamp shown
 * next to retained (stale) data — so it moves here instead of being copied a
 * third time.
 *
 * Uses the existing `status.secondsAgo` / `minutesAgo` / `hoursAgo` keys, whose
 * `{n}` placeholder is asserted in both locales by `i18n.test.ts`.
 */

export type Translate = (key: string) => string;

const MINUTE = 60_000;
const HOUR = 3_600_000;

export function formatRelativeTime(
  t: Translate,
  timestamp: number | string | null | undefined,
  now: number = Date.now(),
): string {
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    return t('status.never');
  }

  const value = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (Number.isNaN(value)) return t('status.never');

  // A clock skew between server and workstation must not print "in -3 minutes".
  const elapsed = Math.max(0, now - value);

  if (elapsed < MINUTE) {
    return t('status.secondsAgo').replace('{n}', String(Math.round(elapsed / 1000)));
  }
  if (elapsed < HOUR) {
    return t('status.minutesAgo').replace('{n}', String(Math.round(elapsed / MINUTE)));
  }
  return t('status.hoursAgo').replace('{n}', String(Math.round(elapsed / HOUR)));
}
