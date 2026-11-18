/**
 * Cinema mode for the Web Control "Incoming Jobs" page.
 *
 * A full-viewport, chrome-free wall board: no nav rail, no page header, no
 * filter toolbar. It is a presentation surface for a screen that stays on
 * (reception desk, control room, TV on the wall), so it leans on size, contrast
 * and motion to communicate, and it exits on *any* key or click so nobody has
 * to hunt for a close button.
 *
 * Rules this file follows, and why:
 *
 *   - It portals to `document.body` and makes `#root` inert, so the shell
 *     behind it is unreachable by focus or screen reader while the board is up.
 *   - It tries the real Fullscreen API on entry (best effort: a packaged
 *     WebView or a browser policy may refuse) and closes when the operator
 *     leaves fullscreen, because Esc is handled by the browser there.
 *   - Any keydown, any pointerdown, or leaving fullscreen exits. The listener
 *     is attached inside an effect, so the click that opened the board cannot
 *     immediately close it.
 *   - Numbers and layout come from `cinemaModel.ts`; this component owns only
 *     rendering and the two display animations (count-up, new-row pulse).
 *   - `prefers-reduced-motion` disables every animation, including the count-up.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../i18n/index.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { formatMessage as fill } from '../../lib/formatMessage.js';
import {
  buildCinemaKpis,
  buildStationRows,
  buildThroughput,
  cinemaJobLabel,
  cinemaJobValues,
  cinemaJobTone,
  CINEMA_PANELS,
  flowPeak,
  formatClockTime,
  isNewArrival,
  recentJobs,
  type CinemaFlowBucket,
  type CinemaJob,
  type CinemaPanel,
  type CinemaStation,
  type CinemaTone,
} from './cinemaModel.js';
import './cinemaBoard.css';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A coarse "now" for the board's derived data.
 *
 * Interval budget, deliberately split:
 *   - the board ticks at `BOARD_TICK_MS`, the same cadence as the control feed.
 *     Ticking faster cannot produce new numbers: they only change when a poll
 *     lands, so a one-second board timer would re-render ~100 nodes for nothing.
 *   - the header clock keeps its own one-second timer inside `CinemaClock`, so
 *     the seconds stay exact without dragging the whole board along.
 *   - both stop while the document is hidden, so a backgrounded tab does not
 *     keep timers alive for a screen nobody is looking at.
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    };

    start();
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, [intervalMs]);
  return now;
}

/** The feed cadence, mirrored here so the board's clock follows it. */
const BOARD_TICK_MS = 5_000;

/** Header clock: the only part of the board that needs a one-second timer. */
function CinemaClock({ locale, localeTag }: { locale: 'en' | 'th'; localeTag: string }) {
  const now = useNow(1_000);
  const calendar = new Date(now).toLocaleDateString(localeTag, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
  return (
    <div className="cinema-clock">
      <span className="cinema-clock-time">{formatClockTime(now, locale, false)}</span>
      <span className="cinema-clock-date">{calendar}</span>
    </div>
  );
}

/**
 * Eased count-up for KPI values. It animates only on change: the first paint
 * shows the real number (a board that counts up from zero every refresh is
 * noise), and reduced-motion users always get the final value immediately.
 */
function useCountUp(value: number): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;

    if (prefersReducedMotion()) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const started = performance.now();
    const duration = 520;
    const step = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };

    frameRef.current = window.requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value]);

  return display;
}

export interface CinemaBoardProps {
  stations: readonly CinemaStation[];
  /** Jobs in the current scope (one station, or every station merged). */
  jobs: readonly CinemaJob[];
  /** "JOHN" or "All stations" - already localised by the page. */
  scopeLabel: string;
  /**
   * Incoming payload keys to show as the row label, in order. Empty means the
   * row falls back to the job reference, which is the pre-picker behaviour.
   */
  displayFields?: readonly string[];
  /** Keep the job reference after the chosen values. Default true. */
  showReference?: boolean;
  /** How much of the row the value label takes; the operator picks per screen. */
  labelWidth?: 'narrow' | 'balanced' | 'wide';
  /**
   * Optional panels around the feed. Absent means the full board, so a caller
   * that does not care gets the complete wall display.
   */
  panels?: readonly CinemaPanel[];
  lastSuccessAt: number | null;
  /** True until the first feed response arrives; the board must not claim "Live". */
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  /** True when the last refresh failed; the board says so instead of lying. */
  failed: boolean;
  onExit: () => void;
}

type LiveTone = 'live' | 'sync' | 'stale' | 'down';

function ToneBar({ tone }: { tone: CinemaTone | 'neutral' }) {
  return <span className={`cinema-tone cinema-tone--${tone}`} aria-hidden="true" />;
}

export function CinemaBoard(props: CinemaBoardProps) {
  const { locale, t } = useLocale();
  const {
    stations,
    jobs,
    scopeLabel,
    displayFields = [],
    showReference = true,
    labelWidth = 'balanced',
    panels = CINEMA_PANELS,
    lastSuccessAt,
    loading,
    refreshing,
    stale,
    failed,
    onExit,
  } = props;

  const now = useNow(BOARD_TICK_MS);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Whether this mounted board is the one that put the document in fullscreen. */
  const ownsFullscreen = useRef(false);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  const kpis = useMemo(() => buildCinemaKpis(jobs, stations, now), [jobs, stations, now]);
  const buckets = useMemo(() => buildThroughput(jobs, now, 30), [jobs, now]);
  const peak = useMemo(() => flowPeak(buckets), [buckets]);
  const flowTotal = useMemo(() => buckets.reduce((sum, bucket) => sum + bucket.total, 0), [buckets]);
  const stationRows = useMemo(() => buildStationRows(stations), [stations]);
  const feed = useMemo(() => recentJobs(jobs, 8), [jobs]);
  const ticker = useMemo(() => recentJobs(jobs, 12), [jobs]);

  const stationNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const station of stations) names.set(station.deviceId, station.name);
    return names;
  }, [stations]);

  const totalCount = useCountUp(kpis.total);
  const reviewCount = useCountUp(kpis.needsReview);
  const activeCount = useCountUp(kpis.inProgress);
  const printedCount = useCountUp(kpis.printed);
  const stationCount = useCountUp(kpis.stationsOnline);

  const health: { tone: LiveTone; label: string } = loading
    ? { tone: 'sync', label: t('control.cinema.loading') }
    : failed
      ? { tone: 'down', label: t('control.cinema.offline') }
      : stale
        ? { tone: 'stale', label: t('control.cinema.stale') }
        : refreshing
          ? { tone: 'sync', label: t('control.cinema.updating') }
          : { tone: 'live', label: t('control.cinema.live') };

  const localeTag = locale === 'th' ? 'th-TH' : 'en-GB';
  const lastUpdate = lastSuccessAt === null ? t('status.never') : formatRelativeTime(t, lastSuccessAt, now);

  /**
   * Exit contract: any key, a tap/click, or leaving fullscreen.
   *
   * The pointer path deliberately exits on `pointerup` only when the pointer
   * barely moved, so the same surface can still be scrolled by touch at the
   * narrow layouts (where the board is taller than the viewport). No keydown is
   * `preventDefault`ed: the board has nothing to type into, and swallowing
   * browser or assistive-technology shortcuts would be a worse trap than the
   * one it prevents.
   *
   * Fullscreen is best effort and ownership-tracked: React 18 StrictMode runs
   * this effect twice in development, so the "we entered fullscreen" flag lives
   * on a ref and is only set when the grant actually belongs to a mounted board.
   */
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const appRoot = document.getElementById('root');
    const appRootWasInert = appRoot?.hasAttribute('inert') ?? false;

    body.style.overflow = 'hidden';
    appRoot?.setAttribute('inert', '');
    rootRef.current?.focus({ preventScroll: true });

    const exit = () => exitRef.current();

    /**
     * "Any key exits" is the contract - staff walk up to the wall, press
     * something, and are back in the list. Two kinds of key are excluded, both
     * for the operator rather than the keyboard:
     *
     *   - pure navigation keys (Tab and the arrows/Home/End/Page keys). Those are
     *     exactly what a screen reader uses to read the board, and closing the
     *     screen on the first arrow press would hide the summary from the people
     *     who cannot see it;
     *   - a bare modifier, because holding Ctrl or Shift is not "pressing a key"
     *     and assistive tech chords start that way.
     *
     * Escape still exits, and so does any click.
     */
    const NON_EXIT_KEYS = new Set([
      'Tab',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Shift',
      'Control',
      'Alt',
      'Meta',
    ]);
    const onKeyDown = (event: KeyboardEvent) => {
      if (NON_EXIT_KEYS.has(event.key)) return;
      exit();
    };

    let press: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      press = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = press;
      press = null;
      if (!start) {
        exit();
        return;
      }
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 6) exit();
    };
    const onPointerCancel = () => {
      press = null;
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) exit();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const element = document.documentElement;
    if (!document.fullscreenElement && typeof element.requestFullscreen === 'function') {
      void element.requestFullscreen().then(
        () => {
          if (!document.querySelector('.cinema')) {
            // The board closed while the browser was deciding: do not leave the
            // operator in a fullscreen window with no board in it.
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            return;
          }
          ownsFullscreen.current = true;
        },
        () => undefined,
      );
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      body.style.overflow = previousOverflow;
      if (!appRootWasInert) appRoot?.removeAttribute('inert');
      if (ownsFullscreen.current && document.fullscreenElement) {
        ownsFullscreen.current = false;
        void document.exitFullscreen().catch(() => undefined);
      }
      returnFocus?.focus({ preventScroll: true });
    };
  }, []);

  const shownStations = stationRows.slice(0, 4);
  const hiddenStations = Math.max(0, stationRows.length - shownStations.length);
  // A one-station board is about that station: no fleet ladder, and its
  // connection moves into the header where the operator already looks.
  const singleStation = stationRows.length === 1 ? stationRows[0] : null;
  // The panel choice is a floor, not an override: a fleet ladder with nothing to
  // compare still hides itself, and the flow keeps the full top row either way.
  const showFlowPanel = panels.includes('flow');
  const showStationsPanel = panels.includes('stations') && stationRows.length > 1;
  const showTicker = panels.includes('ticker');
  const bodyClassName = [
    'cinema-body',
    showStationsPanel ? '' : 'cinema-body--single',
    showFlowPanel ? '' : 'cinema-body--no-flow',
  ]
    .filter(Boolean)
    .join(' ');

  const board = (
    <div
      className="cinema"
      role="dialog"
      aria-modal="true"
      aria-label={t('control.cinema.label')}
      tabIndex={-1}
      ref={rootRef}
    >
      <div className="cinema-aurora" aria-hidden="true" />

      <p className="ui-visually-hidden">
        {loading
          ? t('control.cinema.loading')
          : fill(t('control.cinema.summary'), {
              total: kpis.total,
              review: kpis.needsReview,
              active: kpis.inProgress,
              printed: kpis.printed,
              online: kpis.stationsOnline,
              stations: kpis.stationsTotal,
            })}
      </p>

      <header className="cinema-head">
        <div className="cinema-identity">
          <span className="cinema-brand">PrintOps</span>
          <span className="cinema-head-title">{t('control.cinema.title')}</span>
          <span className="cinema-scope">{scopeLabel}</span>
          {singleStation && (
            <span className={`cinema-connection${singleStation.online ? ' is-online' : ' is-offline'}`}>
              <span className={`cinema-dot${singleStation.online ? ' is-online' : ' is-offline'}`} aria-hidden="true" />
              {singleStation.online
                ? t('control.jobs.connectionOnline')
                : t('control.jobs.connectionOffline')}
            </span>
          )}
        </div>

        <CinemaClock locale={locale} localeTag={localeTag} />

        <div className="cinema-live">
          <span className={`cinema-live-dot cinema-live-dot--${health.tone}`} aria-hidden="true" />
          <span className="cinema-live-label">{health.label}</span>
          <span className="cinema-live-meta">{lastUpdate}</span>
          <span className="cinema-live-hint">{t('control.cinema.exitHint')}</span>
        </div>
      </header>

      <section className="cinema-kpis" aria-label={t('control.cinema.kpisLabel')}>
        <div
          className="cinema-kpi cinema-kpi--total"
          role="group"
          aria-label={t('control.cinema.kpiTotal')}
        >
          <span className="cinema-kpi-label">{t('control.cinema.kpiTotal')}</span>
          <span className="cinema-kpi-value">
            {loading ? '—' : totalCount.toLocaleString(localeTag)}
          </span>
          <span className="cinema-kpi-hint">
            {fill(t('control.cinema.kpiTotalHint'), { count: kpis.recent10m })}
          </span>
        </div>
        <div
          className={`cinema-kpi cinema-kpi--review${kpis.needsReview > 0 ? ' is-alert' : ''}`}
          role="group"
          aria-label={t('control.cinema.kpiNeedsReview')}
        >
          <span className="cinema-kpi-label">{t('control.cinema.kpiNeedsReview')}</span>
          <span className="cinema-kpi-value">
            {loading ? '—' : reviewCount.toLocaleString(localeTag)}
          </span>
          <span className="cinema-kpi-hint">
            {kpis.needsReview > 0
              ? t('control.cinema.kpiNeedsReviewHint')
              : t('control.cinema.kpiClearHint')}
          </span>
        </div>
        <div
          className="cinema-kpi cinema-kpi--active"
          role="group"
          aria-label={t('control.cinema.kpiInProgress')}
        >
          <span className="cinema-kpi-label">{t('control.cinema.kpiInProgress')}</span>
          <span className="cinema-kpi-value">
            {loading ? '—' : activeCount.toLocaleString(localeTag)}
          </span>
          <span className="cinema-kpi-hint">{t('control.cinema.kpiInProgressHint')}</span>
        </div>
        <div
          className="cinema-kpi cinema-kpi--printed"
          role="group"
          aria-label={t('control.cinema.kpiPrinted')}
        >
          <span className="cinema-kpi-label">{t('control.cinema.kpiPrinted')}</span>
          <span className="cinema-kpi-value">
            {loading ? '—' : printedCount.toLocaleString(localeTag)}
          </span>
          <span className="cinema-kpi-hint">{t('control.cinema.kpiPrintedHint')}</span>
        </div>
        <div
          className="cinema-kpi cinema-kpi--stations"
          role="group"
          aria-label={t('control.cinema.kpiStations')}
        >
          <span className="cinema-kpi-label">{t('control.cinema.kpiStations')}</span>
          <span className="cinema-kpi-value">
            {loading ? '—' : stationCount.toLocaleString(localeTag)}
            <span className="cinema-kpi-of">/{loading ? '—' : kpis.stationsTotal}</span>
          </span>
          <span className="cinema-kpi-hint">{t('control.cinema.kpiStationsHint')}</span>
        </div>
      </section>

      <div className={bodyClassName}>
        {showFlowPanel && (
        <section className="cinema-card cinema-flow" aria-label={t('control.cinema.flowTitle')}>
          <div className="cinema-card-head">
            <h2 className="cinema-card-title">{t('control.cinema.flowTitle')}</h2>
            <div className="cinema-card-meta">
              <span>{fill(t('control.cinema.flowRate'), { count: flowTotal })}</span>
              <span>{fill(t('control.cinema.flowPeak'), { count: peak })}</span>
            </div>
          </div>
          <div className="cinema-flow-chart" aria-hidden="true">
            {buckets.map((bucket, index) => (
              // Positional slots: every tick shifts all start times, so a
              // timestamp key would remount the ladder each second and kill
              // the height transition.
              <FlowColumn key={index} bucket={bucket} peak={peak} />
            ))}
          </div>
          <div className="cinema-legend">
            <span className="cinema-legend-item">
              <ToneBar tone="printed" />
              {t('control.jobs.countPrinted')}
              <b>{kpis.printed}</b>
            </span>
            <span className="cinema-legend-item">
              <ToneBar tone="active" />
              {t('control.jobs.countInProgress')}
              <b>{kpis.inProgress}</b>
            </span>
            <span className="cinema-legend-item">
              <ToneBar tone="attention" />
              {t('control.jobs.countNeedsReview')}
              <b>{kpis.needsReview}</b>
            </span>
            <span className="cinema-legend-item">
              <ToneBar tone="neutral" />
              {t('control.jobs.countOther')}
              <b>{kpis.other}</b>
            </span>
          </div>
        </section>
        )}

        {showStationsPanel && (
        <section className="cinema-card cinema-stations" aria-label={t('control.cinema.stationsTitle')}>
          <div className="cinema-card-head">
            <h2 className="cinema-card-title">{t('control.cinema.stationsTitle')}</h2>
            <div className="cinema-card-meta">
              <span>{fill(t('control.jobs.stationSummary'), { online: kpis.stationsOnline, total: kpis.stationsTotal })}</span>
            </div>
          </div>
          {shownStations.length === 0 ? (
            <p className="cinema-empty">
              {loading ? t('control.cinema.loading') : t('control.cinema.stationsEmpty')}
            </p>
          ) : (
            <ul className="cinema-station-list">
              {shownStations.map((station) => (
                <li key={station.deviceId} className={`cinema-station${station.online ? '' : ' is-offline'}`}>
                  <span className="cinema-station-head">
                    <span
                      className={`cinema-dot${station.online ? ' is-online' : ' is-offline'}`}
                      aria-hidden="true"
                    />
                    <span className="cinema-station-name" title={station.name}>
                      {station.name}
                    </span>
                    <span className="cinema-station-total">{station.total.toLocaleString(localeTag)}</span>
                  </span>
                  <span className="cinema-station-sub">
                    {!station.online && (
                      <em className="cinema-station-offline">{t('control.jobs.connectionOffline')}</em>
                    )}
                    {station.needsReview > 0 && (
                      <em className="cinema-station-alert">
                        {fill(t('control.cinema.stationAttention'), { count: station.needsReview })}
                      </em>
                    )}
                    <span>
                      {station.lastJobAt === null
                        ? t('control.cinema.stationNoJobs')
                        : formatRelativeTime(t, station.lastJobAt, now)}
                    </span>
                  </span>
                  <span className="cinema-station-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(station.share * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hiddenStations > 0 && (
            <p className="cinema-empty">{fill(t('control.cinema.stationsMore'), { count: hiddenStations })}</p>
          )}
        </section>
        )}

        <section className="cinema-card cinema-feed" aria-label={t('control.cinema.feedTitle')}>
          <div className="cinema-card-head">
            <h2 className="cinema-card-title">{t('control.cinema.feedTitle')}</h2>
            <div className="cinema-card-meta">
              {displayFields.length > 0 && (
                <span className="cinema-feed-fields">{displayFields.join(' · ')}</span>
              )}
              <span>{t('control.cinema.feedHint')}</span>
            </div>
          </div>
          {feed.length === 0 ? (
            <p className="cinema-empty">
              {loading ? t('control.cinema.loading') : t('control.cinema.feedEmpty')}
            </p>
          ) : (
            <ol
              className={`cinema-feed-list cinema-feed-list--${labelWidth}`}
              aria-label={t('control.cinema.feedTitle')}
            >
              {feed.map((job) => {
                const tone = toneOf(job);
                const fresh = isNewArrival(job.createdAt, now);
                const reference = job.requestId ?? job.id;
                const values = cinemaJobValues(job, displayFields);
                // The reference is the operator's call on both surfaces: hide it
                // when the incoming values already identify the row, and also when
                // the site simply does not use references at all.
                const showId = showReference;
                const title = values.length > 0
                  ? showId
                    ? `${values.join(' · ')} · ${reference}`
                    : values.join(' · ')
                  : reference;
                return (
                  <li key={job.id} className={`cinema-feed-row cinema-feed-row--${tone}${fresh ? ' is-new' : ''}`}>
                    <span className="cinema-feed-time">{formatClockTime(job.createdAt, locale)}</span>
                    <span className="cinema-feed-ref" title={title}>
                      {values.length > 0 ? (
                        <>
                          <span className="cinema-feed-label">
                            {values.map((value, index) => (
                              <span className="cinema-feed-value" key={`${job.id}-${index}`}>
                                {value}
                              </span>
                            ))}
                          </span>
                          {showId && <span className="cinema-feed-id">{reference}</span>}
                        </>
                      ) : showId ? (
                        reference
                      ) : null}
                    </span>
                    <span className="cinema-feed-where">
                      <span className="cinema-feed-station">
                        {stationNames.get(job.deviceId) ?? job.deviceId}
                      </span>
                      <span className="cinema-feed-arrow" aria-hidden="true">
                        →
                      </span>
                      <span className="cinema-feed-printer">{job.printerCode ?? job.printerId}</span>
                    </span>
                    <span className={`cinema-status cinema-status--${tone}`}>{job.status}</span>
                    {fresh ? <span className="cinema-feed-new">{t('control.cinema.newBadge')}</span> : <span />}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {showTicker && (
        <footer className="cinema-ticker" aria-hidden="true">
          <div className="cinema-ticker-track">
            {[...ticker, ...ticker].map((job, index) => (
              <span className={`cinema-ticker-item cinema-ticker-item--${toneOf(job)}`} key={`${job.id}-${index}`}>
                <span className="cinema-ticker-time">{formatClockTime(job.createdAt, locale)}</span>
                <span className="cinema-ticker-ref">
                  {cinemaJobLabel(job, displayFields) || (job.requestId ?? job.id)}
                </span>
                <span className="cinema-ticker-station">{stationNames.get(job.deviceId) ?? job.deviceId}</span>
                <span className="cinema-ticker-status">{job.status}</span>
              </span>
            ))}
          </div>
        </footer>
      )}
    </div>
  );

  return typeof document === 'undefined' ? board : createPortal(board, document.body);
}

function toneOf(job: CinemaJob): CinemaTone {
  return cinemaJobTone(job);
}

function FlowColumn({ bucket, peak }: { bucket: CinemaFlowBucket; peak: number }) {
  const height = peak === 0 ? 0 : Math.max(bucket.total === 0 ? 0 : 6, (bucket.total / peak) * 100);
  const segments: Array<{ tone: CinemaTone; count: number }> = [
    { tone: 'attention', count: bucket.attention },
    { tone: 'active', count: bucket.active },
    { tone: 'printed', count: bucket.printed },
    { tone: 'other', count: bucket.other },
  ];
  return (
    <div className="cinema-flow-col">
      <div
        className={`cinema-flow-bar${bucket.total === 0 ? ' is-empty' : ''}`}
        style={{ height: `${height}%` } as CSSProperties}
      >
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <span
              key={segment.tone}
              className={`cinema-flow-seg cinema-flow-seg--${segment.tone}`}
              style={{ flexGrow: segment.count } as CSSProperties}
            />
          ))}
      </div>
    </div>
  );
}

/** Kept as a named export for the page's tests and future surfaces. */
export default CinemaBoard;
export type { CinemaJob, CinemaStation, CinemaTone };
