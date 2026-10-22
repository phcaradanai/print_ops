/**
 * Startup / connection-recovery screen. The caller's `error` flag is the only
 * source of truth: this component runs no probe of its own and reports no
 * readiness, progress, timestamps or printer health it cannot observe.
 */

import { useState } from 'react';
import { Button } from './ui/index.js';
import { useLocale } from '../i18n/index.js';
import { healthUrl } from '../api/client.js';
import './ServiceConnectionScreen.css';

export interface ServiceConnectionScreenProps {
  /** True when the health probe has failed; shows the recovery state. */
  error?: boolean;
  /** Existing retry callback (the app's `checkApi`). */
  onRetry?: () => void;
  /** True for the Web Control build; checks the control server, not a local service. */
  controlApp?: boolean;
}

/** Absolute form of the real health address, for display only. */
function displayHealthUrl(): string {
  const url = healthUrl();
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

export function ServiceConnectionScreen({ error = false, onRetry, controlApp = false }: ServiceConnectionScreenProps) {
  const { t } = useLocale();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const title = error ? t('serviceConnection.unableTitle') : t('serviceConnection.startingTitle');
  const subtitle = error
    ? t(controlApp ? 'serviceConnection.unableControl' : 'serviceConnection.unableLocal')
    : t(controlApp ? 'serviceConnection.checkingControl' : 'serviceConnection.checkingLocal');

  return (
    <div className="service-connection">
      <main className="service-connection-card" aria-labelledby="service-connection-title">
        <header className="service-connection-head">
          <span className={`service-connection-mark${error ? ' service-connection-mark--error' : ''}`} aria-hidden="true">
            {error ? (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3.5 2.75 20h18.5L12 3.5Z" />
                <path d="M12 10v4.5M12 17.5h.01" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="4" width="17" height="9" rx="1.5" />
                <path d="M6.5 17.5h11M8.5 13v8M15.5 13v8" />
              </svg>
            )}
          </span>
          <div className="service-connection-titles">
            <h1 id="service-connection-title" className="service-connection-title">
              {title}
            </h1>
            <p className="service-connection-subtitle">{subtitle}</p>
          </div>
        </header>

        <div className="service-connection-status" role={error ? 'alert' : 'status'}>
          {error ? (
            <span className="service-connection-outcome service-connection-outcome--error">
              {t('serviceConnection.checkFailed')}
            </span>
          ) : (
            <>
              <span className="service-connection-spinner" aria-hidden="true" />
              <span className="service-connection-outcome">{t('serviceConnection.checking')}</span>
            </>
          )}
        </div>

        <div className="service-connection-actions">
          {error ? (
            <Button variant="primary" size="lg" onClick={onRetry}>
              {t('error.retry')}
            </Button>
          ) : (
            <p className="service-connection-hint">{t('serviceConnection.checkingHint')}</p>
          )}
          <Button
            variant="secondary"
            size="md"
            aria-expanded={detailsOpen}
            aria-controls="service-connection-details"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? t('serviceConnection.hideDetails') : t('serviceConnection.showDetails')}
          </Button>
        </div>

        <section
          id="service-connection-details"
          className="service-connection-details"
          hidden={!detailsOpen}
          aria-labelledby="service-connection-details-title"
        >
          <h2 id="service-connection-details-title" className="service-connection-details-title">
            {t('serviceConnection.detailsTitle')}
          </h2>
          <dl className="service-connection-facts">
            <div className="service-connection-fact">
              <dt>{t('serviceConnection.factTarget')}</dt>
              <dd><code>{displayHealthUrl()}</code></dd>
            </div>
            <div className="service-connection-fact">
              <dt>{t('serviceConnection.factResult')}</dt>
              <dd>{error ? t('serviceConnection.resultUnreachable') : t('serviceConnection.resultChecking')}</dd>
            </div>
          </dl>
          <p className="service-connection-safety">{t('serviceConnection.safetyNote')}</p>
          <p className="service-connection-scope">{t('serviceConnection.scopeNote')}</p>
        </section>
      </main>
    </div>
  );
}
