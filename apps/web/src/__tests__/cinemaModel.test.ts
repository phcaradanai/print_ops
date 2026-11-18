import { describe, expect, it } from 'vitest';
import {
  buildCinemaKpis,
  buildStationRows,
  buildThroughput,
  cinemaJobLabel,
  cinemaTone,
  describeCinemaFields,
  flowPeak,
  formatClockTime,
  isNewArrival,
  recentJobs,
  type CinemaJob,
  type CinemaStation,
} from '../features/control-jobs/cinemaModel.js';

const NOW = Date.parse('2026-11-18T10:30:00.000Z');
const MINUTE = 60_000;

function job(overrides: Partial<CinemaJob> & { id: string }): CinemaJob {
  return {
    status: 'SUCCESS',
    createdAt: new Date(NOW - 5 * MINUTE).toISOString(),
    deviceId: 'dev-a',
    printerId: 'printer-a',
    ...overrides,
  };
}

function station(overrides: Partial<CinemaStation> & { deviceId: string }): CinemaStation {
  return {
    name: overrides.deviceId,
    connectionState: 'ONLINE',
    jobs: [],
    ...overrides,
  };
}

describe('cinemaTone', () => {
  it('splits statuses into the four board families', () => {
    expect(cinemaTone('SUCCESS')).toBe('printed');
    for (const status of ['ACCEPTED', 'VALIDATED', 'QUEUED', 'DISPATCHED', 'PRINTING']) {
      expect(cinemaTone(status), status).toBe('active');
    }
    for (const status of ['FAILED', 'UNVERIFIED', 'TIMEOUT', 'SOMETHING_NEW']) {
      expect(cinemaTone(status), status).toBe('attention');
    }
    for (const status of ['CANCELLED', 'DUPLICATE_RETURNED']) {
      expect(cinemaTone(status), status).toBe('other');
    }
  });
});

describe('buildCinemaKpis', () => {
  it('derives counts from the shared bucket module, never a second status list', () => {
    const jobs = [
      job({ id: 'printed', status: 'SUCCESS' }),
      job({ id: 'review', status: 'UNVERIFIED' }),
      job({ id: 'printing', status: 'PRINTING' }),
      job({ id: 'cancelled', status: 'CANCELLED' }),
    ];
    const kpis = buildCinemaKpis(jobs, [station({ deviceId: 'dev-a' })], NOW);
    expect(kpis).toMatchObject({
      total: 4,
      needsReview: 1,
      inProgress: 1,
      printed: 1,
      other: 1,
    });
  });

  it('counts arrivals inside the ten-minute and one-hour windows only', () => {
    const jobs = [
      job({ id: 'inside-10', createdAt: new Date(NOW - 9 * MINUTE).toISOString() }),
      job({ id: 'edge-10', createdAt: new Date(NOW - 10 * MINUTE).toISOString() }),
      job({ id: 'inside-hour', createdAt: new Date(NOW - 40 * MINUTE).toISOString() }),
      job({ id: 'older', createdAt: new Date(NOW - 90 * MINUTE).toISOString() }),
      job({ id: 'future', createdAt: new Date(NOW + 5 * MINUTE).toISOString() }),
    ];
    const kpis = buildCinemaKpis(jobs, [], NOW);
    expect(kpis.recent10m).toBe(2);
    expect(kpis.lastHour).toBe(3);
  });

  it('counts only ONLINE stations and survives an empty fleet', () => {
    const stations = [
      station({ deviceId: 'on', connectionState: 'ONLINE' }),
      station({ deviceId: 'off', connectionState: 'OFFLINE' }),
    ];
    expect(buildCinemaKpis([], stations, NOW)).toMatchObject({
      stationsOnline: 1,
      stationsTotal: 2,
      lastArrivalAt: null,
    });
    expect(buildCinemaKpis([], [], NOW)).toMatchObject({ total: 0, stationsOnline: 0, stationsTotal: 0 });
  });

  it('reports the newest arrival it can parse', () => {
    const newest = new Date(NOW - MINUTE).toISOString();
    const kpis = buildCinemaKpis(
      [job({ id: 'a', createdAt: new Date(NOW - 10 * MINUTE).toISOString() }), job({ id: 'b', createdAt: newest })],
      [],
      NOW,
    );
    expect(kpis.lastArrivalAt).toBe(newest);
  });
});

describe('buildThroughput', () => {
  it('returns one contiguous bucket per minute, ending with the running minute', () => {
    const buckets = buildThroughput([], NOW, 30);
    expect(buckets).toHaveLength(30);
    expect(buckets[0]!.startMs).toBe(NOW - 30 * MINUTE);
    expect(buckets[29]!.startMs).toBe(NOW - MINUTE);
    expect(buckets.every((bucket) => bucket.total === 0)).toBe(true);
  });

  it('places each job in its minute and stacks the four families', () => {
    const jobs = [
      job({ id: 'now', status: 'SUCCESS', createdAt: new Date(NOW - 1_000).toISOString() }),
      job({ id: 'same-minute', status: 'FAILED', createdAt: new Date(NOW - 2_000).toISOString() }),
      job({ id: 'five-min', status: 'PRINTING', createdAt: new Date(NOW - 5 * MINUTE).toISOString() }),
      job({ id: 'old', status: 'SUCCESS', createdAt: new Date(NOW - 45 * MINUTE).toISOString() }),
      job({ id: 'bad', status: 'SUCCESS', createdAt: 'not-a-date' }),
    ];
    const buckets = buildThroughput(jobs, NOW, 30);
    const last = buckets[29]!;
    expect(last).toMatchObject({ total: 2, printed: 1, attention: 1, active: 0 });
    expect(buckets[25]!).toMatchObject({ total: 1, active: 1 });
    expect(buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(3);
  });

  it('excludes a job stamped exactly at `now`, which belongs to the next tick', () => {
    const buckets = buildThroughput(
      [job({ id: 'edge', createdAt: new Date(NOW).toISOString() })],
      NOW,
      30,
    );
    expect(flowPeak(buckets)).toBe(0);
  });

  it('reports the peak minute', () => {
    const jobs = [
      job({ id: 'a', createdAt: new Date(NOW - 3 * MINUTE).toISOString() }),
      job({ id: 'b', createdAt: new Date(NOW - 3 * MINUTE).toISOString() }),
      job({ id: 'c', createdAt: new Date(NOW - 8 * MINUTE).toISOString() }),
    ];
    expect(flowPeak(buildThroughput(jobs, NOW))).toBe(2);
  });
});

describe('buildStationRows', () => {
  it('orders online first, then busiest, then device id', () => {
    const rows = buildStationRows([
      // The busiest station is offline: only the online-first branch can put it last.
      station({ deviceId: 'dev-c', name: 'C offline', connectionState: 'OFFLINE', jobs: [job({ id: '1' }), job({ id: '2' }), job({ id: '3' })] }),
      // Equal totals in reverse id order: only the id tie-break can order these.
      station({ deviceId: 'dev-b', name: 'B', jobs: [job({ id: '4' })] }),
      station({ deviceId: 'dev-a', name: 'A', jobs: [job({ id: '5' })] }),
    ]);
    expect(rows.map((row) => row.deviceId)).toEqual(['dev-a', 'dev-b', 'dev-c']);
    expect(rows.at(-1)!.online).toBe(false);
  });

  it('scales each bar against the busiest station and keeps an empty fleet at zero', () => {
    const rows = buildStationRows([
      station({ deviceId: 'big', jobs: [job({ id: '1' }), job({ id: '2' }), job({ id: '3' }), job({ id: '4' })] }),
      station({ deviceId: 'small', jobs: [job({ id: '5' })] }),
      station({ deviceId: 'empty', jobs: [] }),
    ]);
    expect(rows.find((row) => row.deviceId === 'big')!.share).toBe(1);
    expect(rows.find((row) => row.deviceId === 'small')!.share).toBe(0.25);
    expect(rows.find((row) => row.deviceId === 'empty')!.share).toBe(0);
    expect(buildStationRows([])).toEqual([]);
  });

  it('carries per-station review and pipeline counts plus the newest arrival', () => {
    const newest = new Date(NOW - 2 * MINUTE).toISOString();
    const rows = buildStationRows([
      station({
        deviceId: 'dev-a',
        jobs: [
          job({ id: '1', status: 'UNVERIFIED', createdAt: newest }),
          job({ id: '2', status: 'FAILED', createdAt: new Date(NOW - 20 * MINUTE).toISOString() }),
          job({ id: '3', status: 'PRINTING', createdAt: new Date(NOW - 30 * MINUTE).toISOString() }),
        ],
      }),
    ]);
    expect(rows[0]).toMatchObject({ needsReview: 2, inProgress: 1, total: 3, lastJobAt: newest });
  });
});

describe('recentJobs', () => {
  it('sorts newest first, caps the list and tolerates unparseable timestamps', () => {
    const jobs = [
      job({ id: 'older', createdAt: new Date(NOW - 10 * MINUTE).toISOString() }),
      job({ id: 'newest', createdAt: new Date(NOW - MINUTE).toISOString() }),
      job({ id: 'broken', createdAt: 'not-a-date' }),
      job({ id: 'middle', createdAt: new Date(NOW - 5 * MINUTE).toISOString() }),
    ];
    expect(recentJobs(jobs, 3).map((entry) => entry.id)).toEqual(['newest', 'middle', 'older']);
    expect(recentJobs(jobs, 10).map((entry) => entry.id).at(-1)).toBe('broken');
    expect(recentJobs(jobs, 0)).toEqual([]);
    // The caller's array is not reordered in place.
    expect(jobs.map((entry) => entry.id)).toEqual(['older', 'newest', 'broken', 'middle']);
  });

  it('breaks a timestamp tie on id so rows never swap between refreshes', () => {
    const same = new Date(NOW - MINUTE).toISOString();
    const jobs = [job({ id: 'b', createdAt: same }), job({ id: 'a', createdAt: same })];
    expect(recentJobs(jobs, 2).map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('isNewArrival', () => {
  it('marks jobs inside the pulse window and nothing else', () => {
    expect(isNewArrival(new Date(NOW - 30_000).toISOString(), NOW)).toBe(true);
    expect(isNewArrival(new Date(NOW - 120_000).toISOString(), NOW)).toBe(true);
    expect(isNewArrival(new Date(NOW - 121_000).toISOString(), NOW)).toBe(false);
    expect(isNewArrival(new Date(NOW + 1_000).toISOString(), NOW)).toBe(false);
    expect(isNewArrival('not-a-date', NOW)).toBe(false);
  });
});

describe('formatClockTime', () => {
  it('returns a fixed HH:MM:SS clock and a dash for unusable timestamps', () => {
    expect(formatClockTime(NOW, 'en')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatClockTime(NOW, 'th', false)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatClockTime('not-a-date', 'en')).toBe('—');
  });
});

describe('describeCinemaFields', () => {
  it('counts the jobs carrying each incoming value and keeps a sample', () => {
    const jobs = [
      job({ id: 'a', payload: { hn: '123456', patient_name: 'Somchai Dee' } }),
      job({ id: 'b', payload: { hn: '998877', patient_name: 'Suda Jaidee' } }),
      job({ id: 'c', payload: { hn: '112233' } }),
    ];
    const options = describeCinemaFields(jobs);
    expect(options).toEqual([
      { key: 'hn', count: 3, sample: '123456' },
      { key: 'patient_name', count: 2, sample: 'Somchai Dee' },
    ]);
  });

  it('ignores blank values and keeps the first non-empty one as the sample', () => {
    const jobs = [
      job({ id: 'a', payload: { hn: '   ', patient_name: '' } }),
      job({ id: 'b', payload: { hn: '777888', patient_name: 'Late Name' } }),
    ];
    expect(describeCinemaFields(jobs)).toEqual([
      { key: 'hn', count: 1, sample: '777888' },
      { key: 'patient_name', count: 1, sample: 'Late Name' },
    ]);
  });

  it('reads the same flattened payload as the drawer, including the snapshot', () => {
    const snapshot = job({
      id: 'snapshot',
      payloadSnapshot: JSON.stringify({ hn: '555666', ward: 'OPD-2' }),
    });
    expect(describeCinemaFields([snapshot])).toEqual([
      { key: 'hn', count: 1, sample: '555666' },
      { key: 'ward', count: 1, sample: 'OPD-2' },
    ]);
  });

  it('returns nothing for a feed with no incoming data', () => {
    expect(describeCinemaFields([job({ id: 'bare' })])).toEqual([]);
    expect(describeCinemaFields([])).toEqual([]);
  });
});

describe('cinemaJobLabel', () => {
  const labelled = job({
    id: 'a',
    payload: { hn: '123456', patient_name: 'Somchai Dee', prescription: '213456' },
  });

  it('joins the chosen values in the operator’s order', () => {
    expect(cinemaJobLabel(labelled, ['patient_name', 'hn'])).toBe('Somchai Dee · 123456');
    expect(cinemaJobLabel(labelled, ['hn'])).toBe('123456');
  });

  it('falls back to nothing when no field is chosen or nothing matches', () => {
    expect(cinemaJobLabel(labelled, [])).toBe('');
    expect(cinemaJobLabel(labelled, ['missing_key'])).toBe('');
    expect(cinemaJobLabel(job({ id: 'bare' }), ['hn'])).toBe('');
  });

  it('skips a blank value instead of leaving a dangling separator', () => {
    expect(cinemaJobLabel(labelled, ['prescription', 'missing_key', 'hn'])).toBe('213456 · 123456');
    expect(cinemaJobLabel(job({ id: 'blank', payload: { hn: '  ' } }), ['hn'])).toBe('');
  });

  it('matches keys case-insensitively, like the payload filters', () => {
    expect(cinemaJobLabel(job({ id: 'upper', payload: { HN: '909090' } }), ['hn'])).toBe('909090');
  });
});
