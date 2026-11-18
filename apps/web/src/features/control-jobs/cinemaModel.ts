/**
 * Pure view model for the Incoming Jobs "cinema" board.
 *
 * The board is a wall display: it must answer, from three metres away, how much
 * came in, what is moving, what needs a human, and which station is quiet. That
 * makes it a different projection of the same feed the page already reads, not
 * a second source of truth:
 *
 *   - counts come from `countStatusBuckets`, the same module the page's status
 *     chips use, so a cinema tile can never disagree with the chip above the
 *     list;
 *   - "needs review" is `jobNeedsAttention` minus the operator's acknowledgement,
 *     the single definition shared with the verdict table (never a second status
 *     list), so a job the list has moved to "other" cannot still glow amber on
 *     the wall;
 *   - only the time-window math (arrivals in the last N minutes, the 30-minute
 *     throughput ladder) is new here, and it is deliberately plain arithmetic
 *     with an explicit `now` so it stays testable without a clock.
 *
 * Everything is exported as a plain function: the component owns animation and
 * layout, this module owns numbers.
 */

import { countStatusBuckets } from '../../lib/controlJobsView.js';
import { jobNeedsAttention } from '../../lib/jobQueueView.js';
import { extractJobPayload } from '../../lib/jobPayload.js';

export const CINEMA_MINUTE_MS = 60_000;

/** The subset of a mirrored control-plane job the board reads. */
export interface CinemaJob {
  id: string;
  status: string;
  createdAt: string;
  deviceId: string;
  printerId: string;
  requestId?: string;
  printerCode?: string;
  /** Incoming data, so the board can show a value the operator recognises. */
  payload?: Record<string, unknown>;
  payloadSnapshot?: string;
  metadata?: Record<string, unknown>;
  /** Control-plane acknowledgement: an operator already checked this outcome. */
  reviewedAt?: string;
}

/** One station as the board lists it. Station names are display strings. */
export interface CinemaStation {
  deviceId: string;
  name: string;
  connectionState: string;
  jobs: readonly CinemaJob[];
}

export type CinemaTone = 'printed' | 'active' | 'attention' | 'other';

/**
 * The optional panels around the feed. The feed itself is never a choice: it is
 * the reason the board exists, so a "no panels" board cannot be configured.
 */
export const CINEMA_PANELS = ['flow', 'stations', 'ticker'] as const;

export type CinemaPanel = (typeof CINEMA_PANELS)[number];

/**
 * Read the `cinemaPanels` URL value. Missing, unknown or empty input keeps the
 * full board rather than producing a stripped one, so a hand-typed or stale
 * kiosk URL can never leave the wall showing less than the default.
 */
export function parseCinemaPanels(raw: string | null): CinemaPanel[] {
  if (raw === null) return [...CINEMA_PANELS];
  const wanted = new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  const kept = CINEMA_PANELS.filter((panel) => wanted.has(panel));
  return kept.length > 0 ? kept : [...CINEMA_PANELS];
}

/**
 * Four visual families, derived from the same buckets as the page:
 * attention (must be looked at), active (somewhere in the pipeline), printed
 * (SUCCESS), other (cancelled / duplicate / anything left over).
 */
export function cinemaTone(status: string): CinemaTone {
  if (jobNeedsAttention(status)) return 'attention';
  if (status === 'SUCCESS') return 'printed';
  if (
    status === 'ACCEPTED' ||
    status === 'VALIDATED' ||
    status === 'QUEUED' ||
    status === 'DISPATCHED' ||
    status === 'PRINTING'
  ) {
    return 'active';
  }
  return 'other';
}

export function isStationOnline(connectionState: string): boolean {
  return connectionState === 'ONLINE';
}

/**
 * Whether the board should still ask a human about this job: the shared verdict
 * *and* not yet acknowledged by an operator. Same rule as the NEEDS_REVIEW case
 * in `matchesStatusBucket`, so the board's tile and the page's chip above the
 * list can never count different rows.
 */
export function cinemaNeedsReview(job: CinemaJob): boolean {
  return !job.reviewedAt && jobNeedsAttention(job.status);
}

/**
 * The tone one job shows. An acknowledged outcome keeps the station's real
 * status but leaves the attention family, because the list files it under
 * "other" - the acknowledgement is a triage fact, not print evidence, so a board
 * that still painted it amber would send someone to a printer that was already
 * checked.
 */
export function cinemaJobTone(job: CinemaJob): CinemaTone {
  if (job.reviewedAt && jobNeedsAttention(job.status)) return 'other';
  return cinemaTone(job.status);
}

function toMs(createdAt: string): number | null {
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : null;
}

function latestJobMs(jobs: readonly CinemaJob[]): number | null {
  let latest: number | null = null;
  for (const job of jobs) {
    const ms = toMs(job.createdAt);
    if (ms === null) continue;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

export interface CinemaKpis {
  total: number;
  needsReview: number;
  inProgress: number;
  printed: number;
  other: number;
  /** Arrived during the last ten minutes — the "is it busy right now" number. */
  recent10m: number;
  /** Arrived during the last hour, across the loaded window. */
  lastHour: number;
  stationsOnline: number;
  stationsTotal: number;
  lastArrivalAt: string | null;
}

/**
 * Headline numbers for the loaded window. "Total" is the window the feed
 * carries (the newest mirror slice per station), exactly like the page's All
 * count — the board never invents a longer history than the API returned.
 */
export function buildCinemaKpis(
  jobs: readonly CinemaJob[],
  stations: readonly CinemaStation[],
  now: number,
): CinemaKpis {
  const counts = countStatusBuckets(jobs, { isAttention: cinemaNeedsReview });
  const tenMinutesAgo = now - 10 * CINEMA_MINUTE_MS;
  const hourAgo = now - 60 * CINEMA_MINUTE_MS;

  let recent10m = 0;
  let lastHour = 0;
  let lastArrivalMs: number | null = null;

  for (const job of jobs) {
    const ms = toMs(job.createdAt);
    if (ms === null) continue;
    if (ms >= tenMinutesAgo && ms <= now) recent10m += 1;
    if (ms >= hourAgo && ms <= now) lastHour += 1;
    if (lastArrivalMs === null || ms > lastArrivalMs) lastArrivalMs = ms;
  }

  return {
    total: counts.all,
    needsReview: counts.needsReview,
    inProgress: counts.inProgress,
    printed: counts.printed,
    other: counts.other,
    recent10m,
    lastHour,
    stationsOnline: stations.filter((station) => isStationOnline(station.connectionState)).length,
    stationsTotal: stations.length,
    lastArrivalAt: lastArrivalMs === null ? null : new Date(lastArrivalMs).toISOString(),
  };
}

export interface CinemaFlowBucket {
  /** Bucket start, epoch ms. Buckets are contiguous one-minute slices. */
  startMs: number;
  total: number;
  printed: number;
  active: number;
  attention: number;
  other: number;
}

/**
 * The last `minutes` one-minute slices ending at `now` (the last bucket is the
 * running minute). Jobs outside the window, and timestamps this build cannot
 * parse, are ignored rather than clamped into the chart — a wrong bar is worse
 * than a missing one.
 */
export function buildThroughput(
  jobs: readonly CinemaJob[],
  now: number,
  minutes = 30,
): CinemaFlowBucket[] {
  const span = Math.max(1, Math.trunc(minutes));
  const windowStart = now - span * CINEMA_MINUTE_MS;
  const buckets: CinemaFlowBucket[] = Array.from({ length: span }, (_, index) => ({
    startMs: windowStart + index * CINEMA_MINUTE_MS,
    total: 0,
    printed: 0,
    active: 0,
    attention: 0,
    other: 0,
  }));

  for (const job of jobs) {
    const ms = toMs(job.createdAt);
    if (ms === null || ms < windowStart || ms >= now) continue;
    const index = Math.min(span - 1, Math.floor((ms - windowStart) / CINEMA_MINUTE_MS));
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.total += 1;
    bucket[cinemaJobTone(job)] += 1;
  }

  return buckets;
}

/** Peak one-minute arrival count, for scaling the chart and the "peak" label. */
export function flowPeak(buckets: readonly CinemaFlowBucket[]): number {
  return buckets.reduce((peak, bucket) => (bucket.total > peak ? bucket.total : peak), 0);
}

export interface CinemaStationRow {
  deviceId: string;
  name: string;
  online: boolean;
  total: number;
  needsReview: number;
  inProgress: number;
  lastJobAt: string | null;
  /** Bar width contribution: this station's share of the busiest station. */
  share: number;
}

/**
 * Station ladder for the right-hand panel: online stations first, then the
 * busiest, then a stable id tie-break so the order never flickers between the
 * five-second refreshes.
 */
export function buildStationRows(stations: readonly CinemaStation[]): CinemaStationRow[] {
  const rows = stations.map((station) => {
    const counts = countStatusBuckets(station.jobs, { isAttention: cinemaNeedsReview });
    const lastMs = latestJobMs(station.jobs);
    return {
      deviceId: station.deviceId,
      name: station.name,
      online: isStationOnline(station.connectionState),
      total: station.jobs.length,
      needsReview: counts.needsReview,
      inProgress: counts.inProgress,
      lastJobAt: lastMs === null ? null : new Date(lastMs).toISOString(),
      share: 0,
    };
  });

  const busiest = rows.reduce((max, row) => (row.total > max ? row.total : max), 0);

  return rows
    .map((row) => ({ ...row, share: busiest === 0 ? 0 : row.total / busiest }))
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.total !== b.total) return b.total - a.total;
      return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
    });
}

/** Newest first, unparseable timestamps last, `id` as the stable tie-break. */
export function recentJobs<T extends CinemaJob>(jobs: readonly T[], limit: number): T[] {
  const sorted = [...jobs].sort((a, b) => {
    const aMs = toMs(a.createdAt);
    const bMs = toMs(b.createdAt);
    if (aMs !== null && bMs !== null && aMs !== bMs) return bMs - aMs;
    if (aMs !== null && bMs === null) return -1;
    if (aMs === null && bMs !== null) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted.slice(0, Math.max(0, limit));
}

/** A job that arrived inside the pulse window gets the "new" treatment. */
export function isNewArrival(createdAt: string, now: number, windowMs = 120_000): boolean {
  const ms = toMs(createdAt);
  return ms !== null && ms >= now - windowMs && ms <= now;
}

/** `HH:MM` / `HH:MM:SS` in the workstation's zone, used by rows and the ticker. */
export function formatClockTime(timestamp: string | number, locale: string, seconds = true): string {
  const ms = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleTimeString(locale === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

/**
 * The incoming values an operator can put on the board instead of the job
 * reference, ordered by how many jobs actually carry them.
 *
 * A reference like `REQ-UNVERIFIED-0001` means nothing to the person watching
 * the screen; `HN 123456` or a patient name does. This is the list behind the
 * display-field picker, and it deliberately reads the same flattened payload the
 * job drawer and the payload filters use (`extractJobPayload`), so the board
 * cannot offer a key the rest of the page cannot show.
 */
export interface CinemaFieldOption {
  key: string;
  /** Jobs in scope that carry a non-empty value for this key. */
  count: number;
  /** First non-empty value, for the picker's preview. */
  sample: string;
}

export function describeCinemaFields(jobs: readonly CinemaJob[]): CinemaFieldOption[] {
  const options = new Map<string, CinemaFieldOption>();

  for (const job of jobs) {
    for (const [key, value] of Object.entries(extractJobPayload(job))) {
      const text = value?.trim();
      if (!text) continue;
      const existing = options.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        options.set(key, { key, count: 1, sample: text });
      }
    }
  }

  return [...options.values()].sort(
    (a, b) => b.count - a.count || a.key.localeCompare(b.key),
  );
}

/**
 * The operator-facing label for one job: the chosen payload values joined with
 * a middot. Returns an empty string when the job carries none of them, so the
 * caller can fall back to the reference instead of showing a blank row.
 *
 * Key matching is case-insensitive, mirroring the payload filters: an incoming
 * system may send `HN` and `hn` in the same feed.
 */
export function cinemaJobLabel(job: CinemaJob, fields: readonly string[]): string {
  if (fields.length === 0) return '';
  const payload = extractJobPayload(job);
  const lower = new Map(
    Object.entries(payload).map(([key, value]) => [key.toLocaleLowerCase(), value]),
  );

  const values: string[] = [];
  for (const field of fields) {
    const value = payload[field] ?? lower.get(field.toLocaleLowerCase());
    const text = value?.trim();
    if (text) values.push(text);
  }
  return values.join(' · ');
}
