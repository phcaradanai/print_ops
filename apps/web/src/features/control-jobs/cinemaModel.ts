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
 *   - "needs review" is `jobNeedsAttention`, the single definition shared with
 *     the verdict table (never a second status list);
 *   - only the time-window math (arrivals in the last N minutes, the 30-minute
 *     throughput ladder) is new here, and it is deliberately plain arithmetic
 *     with an explicit `now` so it stays testable without a clock.
 *
 * Everything is exported as a plain function: the component owns animation and
 * layout, this module owns numbers.
 */

import { countStatusBuckets } from '../../lib/controlJobsView.js';
import { jobNeedsAttention } from '../../lib/jobQueueView.js';

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
  const counts = countStatusBuckets(jobs);
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
    bucket[cinemaTone(job.status)] += 1;
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
    const counts = countStatusBuckets(station.jobs);
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
