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

import { useState, type ReactNode } from 'react';
import { ApiError, errorMessage, errorTechnicalSummary } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';

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
          <button type="button" className="btn-secondary" onClick={onRetry}>
            {t('error.retry')}
          </button>
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
    <div className="state-banner state-banner--error" role="alert">
      <div className="state-banner-body">
        <span className="state-banner-title">{headline}</span>
        {detail !== headline && <span className="state-banner-message">{detail}</span>}
        <ErrorDetails error={error} />
      </div>
      <div className="state-banner-actions">
        {onRetry && (
          <button type="button" className="btn-secondary" onClick={onRetry}>
            {t('error.retry')}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="state-banner-dismiss"
            aria-label={t('error.dismiss')}
            onClick={onDismiss}
          >
            {'✕'}
          </button>
        )}
      </div>
    </div>
  );
}
