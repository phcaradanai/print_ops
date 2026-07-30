/**
 * Shared loading / empty / error surfaces (FE-01).
 *
 * Every page previously hand-rolled these with inline styles
 * (`<p className="loading-text">`, a centred `div` with a hardcoded `#888`
 * paragraph, or nothing at all). These three components are the single place
 * where a data-fetch state is rendered, so error visibility is uniform:
 * an operator always gets a title they can act on, the server's own message,
 * a retry affordance and — when the API supplied one — a trace id to quote to
 * support.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, errorMessage, errorTechnicalSummary } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { Alert } from './Alert.js';
import { Button } from './Button.js';

/** Busy placeholder. `label` overrides the generic "Loading…". */
export function LoadingState({ label }: { label?: string }) {
  const { t } = useLocale();
  return (
    <p className="state-panel state-panel--loading loading-text" role="status" aria-live="polite">
      {label ?? t('common.loading')}
    </p>
  );
}

/** Successful fetch, nothing to show. Not an error — never styled like one. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="state-panel state-panel--empty">
      <p className="state-panel-title">{title ?? t('state.empty.title')}</p>
      {hint && <p className="state-panel-hint">{hint}</p>}
      {action && <div className="state-panel-actions">{action}</div>}
    </div>
  );
}

/** Localized headline for a failure, chosen from the ApiError class. */
function useErrorHeadline(error: unknown, fallback?: string): string {
  const { t } = useLocale();
  if (fallback) return fallback;
  if (error instanceof ApiError) {
    if (error.isNetwork) return t('error.network.title');
    if (error.isAuth) return t('error.auth.title');
    if (error.isServer) return t('error.server.title');
  }
  return t('error.load.title');
}

interface ErrorViewProps {
  /** The thrown value. `ApiError` unlocks status/code/trace details. */
  error: unknown;
  /** Overrides the auto-selected headline (e.g. "Could not load printers"). */
  title?: string;
  /** Retry affordance. Omit when the caller has nothing sensible to re-run. */
  onRetry?: () => void;
  /** Dismiss affordance for the banner variant. */
  onDismiss?: () => void;
}

function ErrorDetails({ error }: { error: unknown }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const technical = errorTechnicalSummary(error);
  if (!technical) return null;
  return (
    <div className="state-panel-details">
      <button
        type="button"
        className="state-panel-details-toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {t('error.details')}
      </button>
      {open && <code className="state-panel-technical">{technical}</code>}
    </div>
  );
}

/**
 * Full-width failure panel replacing the page body when a load failed.
 * Shows the localized headline, the server's own message, and the technical
 * summary behind a disclosure so the operator screen stays readable.
 */
export function ErrorState({ error, title, onRetry }: ErrorViewProps) {
  const { t } = useLocale();
  const headline = useErrorHeadline(error, title);
  const detail = errorMessage(error, t('common.error'));

  return (
    <div className="state-panel state-panel--error" role="alert">
      <p className="state-panel-title">{headline}</p>
      {detail !== headline && <p className="state-panel-message">{detail}</p>}
      <ErrorDetails error={error} />
      {onRetry && (
        <div className="state-panel-actions">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('error.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Inline failure strip for a page that still has usable content — a background
 * refresh that failed, or one widget of several. Keeps the stale data visible
 * instead of blanking the screen, but stops the failure from being silent.
 */
export function ErrorBanner({ error, title, onRetry, onDismiss }: ErrorViewProps) {
  const { t } = useLocale();
  const headline = useErrorHeadline(error, title);
  const detail = errorMessage(error, t('common.error'));

  return (
    <Alert
      tone="error"
      title={headline}
      footer={<ErrorDetails error={error} />}
      onRetry={onRetry}
      retryLabel={t('error.retry')}
      onDismiss={onDismiss}
      dismissLabel={t('error.dismiss')}
    >
      {detail !== headline ? detail : undefined}
    </Alert>
  );
}

export interface FreshnessProps {
  lastSuccessAt: number | null;
  stale?: boolean;
  refreshing?: boolean;
  paused?: boolean;
  /**
   * The caller has intentionally stopped automatic updates because the subject
   * reached a terminal state. Must come from a domain decision (for Job Detail:
   * `shouldPollJobDetail`), never from elapsed time.
   */
  monitoringComplete?: boolean;
  onRefresh?: () => void;
}

/**
 * The six presentations this line has to keep apart. Two of them are new: a
 * finished job is not the same fact as a connection that stopped answering, and
 * before this existed both rendered as "Updated: 14 minutes ago".
 */
export type FreshnessState =
  | 'LIVE'
  | 'REFRESHING_LIVE'
  | 'PAUSED_HIDDEN'
  | 'STALE_ERROR'
  | 'TERMINAL_COMPLETE'
  | 'REFRESHING_TERMINAL';

export function freshnessState({
  stale = false,
  refreshing = false,
  paused = false,
  monitoringComplete = false,
}: Omit<FreshnessProps, 'lastSuccessAt' | 'onRefresh'>): FreshnessState {
  // Terminal outranks paused: nothing is waiting to resume, so "paused while
  // this window is in the background" would describe a loop that is not there.
  // It does NOT outrank refreshing — a manual check on a finished job is real
  // work and has to be visible.
  if (monitoringComplete) return refreshing ? 'REFRESHING_TERMINAL' : 'TERMINAL_COMPLETE';
  if (refreshing) return 'REFRESHING_LIVE';
  if (stale) return 'STALE_ERROR';
  if (paused) return 'PAUSED_HIDDEN';
  return 'LIVE';
}

/**
 * Freshness line for retained data.
 *
 * Keeping the previous rows on screen when a refresh fails is the right call —
 * a blank table during a two-second blip is worse than a slightly old one. But
 * retained data that still *looks* live is the exact failure this milestone is
 * closing, so wherever data is retained this line must state when it was last
 * true, and say plainly when it is no longer current.
 *
 * `monitoringComplete` covers the other half of that: on a finished job the
 * clock keeps running ("14 minutes ago") while nothing is polling any more, and
 * an operator reads a growing number as an outage, a frozen client or data they
 * should not trust. In that mode the line states that the snapshot is final and
 * that stopping was deliberate — informational, never a warning — and keeps the
 * manual Refresh button, which does not restart the loop.
 *
 * Re-renders on a timer so "12 seconds ago" does not sit frozen at the moment
 * of the last successful fetch.
 */
export function Freshness({
  lastSuccessAt,
  stale = false,
  refreshing = false,
  paused = false,
  monitoringComplete = false,
  onRefresh,
}: FreshnessProps) {
  const { t } = useLocale();
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const relative = formatRelativeTime(t, lastSuccessAt);
  const state = freshnessState({ stale, refreshing, paused, monitoringComplete });
  const terminal = state === 'TERMINAL_COMPLETE' || state === 'REFRESHING_TERMINAL';

  // A finished job is not a warning, so it never takes the stale styling. The
  // failed-refresh case is carried by its own sentence plus the page's
  // ErrorBanner instead of by colour.
  const className =
    'freshness' + (terminal ? ' freshness--complete' : stale ? ' freshness--stale' : '');

  return (
    <div className={className}>
      {/* No colon in the terminal branch: both `Final state captured` and
          `บันทึกสถานะสุดท้ายเมื่อ` already end in the preposition, so the label
          pattern used by `state.updated` would read as "captured at: 14 minutes
          ago". Thai is the default locale, so that is what most operators see. */}
      <span aria-live="polite">
        {terminal ? (
          <>{t('state.finalCaptured')} {relative}</>
        ) : (
          <>{stale ? t('state.stale') : t('state.updated')}: {relative}</>
        )}
      </span>
      {state === 'REFRESHING_TERMINAL' && (
        <span className="freshness-refreshing">{t('state.refreshingFinal')}</span>
      )}
      {state === 'REFRESHING_LIVE' && (
        <span className="freshness-refreshing">{t('state.refreshing')}</span>
      )}
      {state === 'PAUSED_HIDDEN' && <span className="freshness-paused">{t('state.paused')}</span>}
      {terminal && (
        <span className="freshness-complete-reason">{t('state.terminalUpdatesStopped')}</span>
      )}
      {/* Manual check failed on a finished job: still the final state, just not
          re-confirmed. Stated in words — the row keeps its calm colour. */}
      {terminal && stale && (
        <span className="freshness-complete-note">{t('state.finalRefreshFailed')}</span>
      )}
      {onRefresh && (
        <Button variant="ghost" size="sm" onClick={onRefresh} busy={refreshing}>
          {t('common.refresh')}
        </Button>
      )}
    </div>
  );
}
