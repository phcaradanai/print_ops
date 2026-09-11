import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  EmptyState,
  ErrorBanner,
  ErrorState,
  Freshness,
  LoadingState,
  freshnessState,
} from '../components/PageState.js';
import { LocaleProvider } from '../i18n/index.js';
import { ApiError, networkApiError } from '../api/errors.js';
import { t } from '../i18n/translations.js';
import { shouldPollJobDetail } from '../lib/jobDetailPolling.js';
import { jobDetailPollingInput } from '../pages/JobDetail.js';

function render(node: ReactNode): string {
  return renderToStaticMarkup(<LocaleProvider>{node}</LocaleProvider>);
}

describe('LoadingState', () => {
  it('announces itself to assistive tech', () => {
    const html = render(<LoadingState />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe('EmptyState', () => {
  it('is not rendered as an error', () => {
    const html = render(<EmptyState title="No printers" hint="Register one first" />);
    expect(html).toContain('No printers');
    expect(html).toContain('Register one first');
    expect(html).toContain('state-panel--empty');
    expect(html).not.toContain('role="alert"');
  });
});

describe('ErrorState', () => {
  it('shows the server message alongside a localized headline', () => {
    const err = new ApiError({
      status: 500,
      path: '/printers',
      message: "Printer with id 'p1' not found",
      code: 'NOT_FOUND',
      traceId: 'tr-1',
    });
    const html = render(<ErrorState error={err} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Printer with id &#x27;p1&#x27; not found");
    expect(html).toContain(t('th', 'error.server.title'));
    // Technical summary sits behind a collapsed disclosure.
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('trace tr-1');
  });

  it('names an unreachable service instead of a generic failure', () => {
    const html = render(<ErrorState error={networkApiError('/jobs', new Error('Failed to fetch'))} />);
    expect(html).toContain(t('th', 'error.network.title'));
  });

  it('names a permission failure instead of a generic failure', () => {
    const err = new ApiError({ status: 403, path: '/printers', message: 'Missing permission: printer:control' });
    const html = render(<ErrorState error={err} />);
    expect(html).toContain(t('th', 'error.auth.title'));
  });

  it('renders a retry affordance only when the caller can retry', () => {
    const err = new ApiError({ status: 500, path: '/printers', message: 'boom' });
    expect(render(<ErrorState error={err} onRetry={() => {}} />)).toContain(t('th', 'error.retry'));
    expect(render(<ErrorState error={err} />)).not.toContain(t('th', 'error.retry'));
  });

  it('still shows something for a plain Error with no ApiError metadata', () => {
    const html = render(<ErrorState error={new Error('render crash')} />);
    expect(html).toContain('render crash');
    expect(html).toContain(t('th', 'error.load.title'));
    // No technical summary exists, so no empty disclosure is drawn.
    expect(html).not.toContain('state-panel-details-toggle');
  });
});

describe('freshnessState', () => {
  it('keeps a finished job apart from a connection that stopped answering', () => {
    expect(freshnessState({})).toBe('LIVE');
    expect(freshnessState({ refreshing: true })).toBe('REFRESHING_LIVE');
    expect(freshnessState({ paused: true })).toBe('PAUSED_HIDDEN');
    expect(freshnessState({ stale: true })).toBe('STALE_ERROR');
    expect(freshnessState({ monitoringComplete: true })).toBe('TERMINAL_COMPLETE');
    expect(freshnessState({ monitoringComplete: true, refreshing: true })).toBe('REFRESHING_TERMINAL');
  });

  it('reports a finished job as complete rather than paused or stale', () => {
    // Nothing is waiting to resume, so the background-tab notice would describe
    // a loop that is not running; and a failed manual re-check does not make the
    // captured final state a live-data problem.
    expect(freshnessState({ monitoringComplete: true, paused: true })).toBe('TERMINAL_COMPLETE');
    expect(freshnessState({ monitoringComplete: true, stale: true })).toBe('TERMINAL_COMPLETE');
  });

  it('still shows a manual re-check on a finished job', () => {
    // Terminal does not outrank refreshing: the request is real work.
    expect(freshnessState({ monitoringComplete: true, refreshing: true, stale: true }))
      .toBe('REFRESHING_TERMINAL');
  });
});

describe('Freshness', () => {
  const minuteAgo = Date.now() - 60_000;

  it('shows the normal updated wording while monitoring is live', () => {
    const html = render(<Freshness lastSuccessAt={minuteAgo} />);
    expect(html).toContain(t('th', 'state.updated'));
    expect(html).not.toContain(t('th', 'state.finalCaptured'));
    expect(html).not.toContain(t('th', 'state.terminalUpdatesStopped'));
  });

  it('leaves the paused-live notice unchanged', () => {
    const html = render(<Freshness lastSuccessAt={minuteAgo} paused />);
    expect(html).toContain(t('th', 'state.paused'));
    expect(html).toContain('freshness-paused');
    expect(html).not.toContain(t('th', 'state.finalCaptured'));
  });

  it('reports a live refresh with the live wording', () => {
    const html = render(<Freshness lastSuccessAt={minuteAgo} refreshing />);
    expect(html).toContain(t('th', 'state.refreshing'));
    expect(html).not.toContain(t('th', 'state.refreshingFinal'));
  });

  it('describes a finished job as a final snapshot, not an update', () => {
    const html = render(<Freshness lastSuccessAt={minuteAgo} monitoringComplete />);
    expect(html).toContain(t('th', 'state.finalCaptured'));
    // The growing relative time is retained — it is the timestamp of the final
    // state, which is exactly what an operator needs for an incident report.
    expect(html).toContain('freshness--complete');
    expect(html).not.toContain(t('th', 'state.updated'));
    expect(html).not.toContain(t('th', 'state.stale'));
  });

  it('states that stopping was intentional', () => {
    const html = render(<Freshness lastSuccessAt={minuteAgo} monitoringComplete />);
    expect(html).toContain(t('th', 'state.terminalUpdatesStopped'));
  });

  it('is not an error or a warning when monitoring completed', () => {
    const html = render(<Freshness lastSuccessAt={minuteAgo} monitoringComplete onRefresh={() => {}} />);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('freshness--stale');
  });

  it('keeps manual refresh available after automatic updates stopped', () => {
    const html = render(<Freshness lastSuccessAt={minuteAgo} monitoringComplete onRefresh={() => {}} />);
    expect(html).toContain(t('th', 'common.refresh'));
  });

  it('names the manual re-check of a finished job differently from a live refresh', () => {
    const html = render(<Freshness lastSuccessAt={minuteAgo} monitoringComplete refreshing onRefresh={() => {}} />);
    expect(html).toContain(t('th', 'state.refreshingFinal'));
    expect(html).not.toContain(t('th', 'state.refreshing'));
    // The button reports busy rather than inviting a second request.
    expect(html).toContain('aria-busy="true"');
  });

  it('keeps the final-snapshot wording when a manual re-check failed', () => {
    const html = render(
      <Freshness lastSuccessAt={minuteAgo} monitoringComplete stale onRefresh={() => {}} />,
    );
    expect(html).toContain(t('th', 'state.finalCaptured'));
    expect(html).toContain(t('th', 'state.finalRefreshFailed'));
    // Never presented as live data, and never as a stale live feed.
    expect(html).not.toContain(t('th', 'state.updated'));
    expect(html).not.toContain('freshness--stale');
  });

  it('renders the terminal wording in English when the locale is English', () => {
    const original = Reflect.get(globalThis, 'localStorage');
    Reflect.set(globalThis, 'localStorage', {
      getItem: (key: string) => (key === 'printops-locale' ? 'en' : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    try {
      const html = render(<Freshness lastSuccessAt={minuteAgo} monitoringComplete />);
      expect(html).toContain(t('en', 'state.finalCaptured'));
      expect(html).toContain(t('en', 'state.terminalUpdatesStopped'));
      expect(html).not.toContain(t('th', 'state.finalCaptured'));
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
      else Reflect.set(globalThis, 'localStorage', original);
    }
  });
});

/**
 * The page's own derivation, end to end: the domain decision on the left, the
 * rendered sentence on the right. `JobDetail` computes exactly
 * `job !== null && automaticPollingNeeded === false` and passes it as
 * `monitoringComplete`, so these rows are the table in the FE-01.3 brief.
 */
describe('Job Detail freshness presentation', () => {
  type Job = Parameters<typeof jobDetailPollingInput>[0];
  type Deliveries = Parameters<typeof jobDetailPollingInput>[1];

  const enabledHttp = { enabled: true, transports: ['HTTP'] };

  function presentation(job: Job, deliveries: Deliveries = []): 'live' | 'final' {
    const automaticPollingNeeded = shouldPollJobDetail(jobDetailPollingInput(job, deliveries));
    const monitoringComplete = job !== null && automaticPollingNeeded === false;
    const html = render(
      <Freshness lastSuccessAt={Date.now() - 60_000} monitoringComplete={monitoringComplete} onRefresh={() => {}} />,
    );
    const final = html.includes(t('th', 'state.finalCaptured'));
    const live = html.includes(t('th', 'state.updated'));
    // Exactly one of the two, never both and never neither.
    expect(final).toBe(!live);
    return final ? 'final' : 'live';
  }

  it('shows live while the print is not terminal', () => {
    expect(presentation({ status: 'PRINTING', metadata: { callbackIntent: enabledHttp } })).toBe('live');
  });

  it('shows live for a job that has not loaded yet', () => {
    expect(presentation(null)).toBe('live');
  });

  it('shows live while an expected delivery has not been recorded', () => {
    expect(presentation({ status: 'SUCCESS', metadata: { callbackIntent: enabledHttp } }, [])).toBe('live');
  });

  it('shows live while a delivery is pending', () => {
    expect(presentation(
      { status: 'SUCCESS', metadata: { callbackIntent: enabledHttp } },
      [{ deliveryStatus: 'PENDING' }],
    )).toBe('live');
  });

  it('shows live while a delivery is in progress', () => {
    expect(presentation(
      { status: 'SUCCESS', metadata: { callbackIntent: enabledHttp } },
      [{ deliveryStatus: 'DELIVERING' }],
    )).toBe('live');
  });

  it('shows live while a delivery retry is scheduled', () => {
    expect(presentation(
      { status: 'SUCCESS', metadata: { callbackIntent: enabledHttp } },
      [{ deliveryStatus: 'RETRY_SCHEDULED' }],
    )).toBe('live');
  });

  it('shows a final snapshot once every expected delivery is terminal', () => {
    expect(presentation(
      { status: 'SUCCESS', metadata: { callbackIntent: { enabled: true, transports: ['HTTP', 'NATS'] } } },
      [{ deliveryStatus: 'DELIVERED' }, { deliveryStatus: 'FAILED' }],
    )).toBe('final');
  });

  it('shows a final snapshot when callbacks were disabled for the job', () => {
    expect(presentation({
      status: 'FAILED',
      metadata: { callbackIntent: { enabled: false, disabledReason: 'no endpoint bound' } },
    })).toBe('final');
  });

  it('shows a final snapshot when the job carries no callback intent', () => {
    expect(presentation({ status: 'CANCELLED', metadata: {} })).toBe('final');
    expect(presentation({ status: 'TIMEOUT' })).toBe('final');
  });
});

describe('ErrorBanner', () => {
  it('is an alert that keeps the surrounding page content', () => {
    const html = render(
      <ErrorBanner error={networkApiError('/jobs', new Error('Failed to fetch'))} onDismiss={() => {}} />,
    );
    // ErrorBanner is a thin wrapper over the shared Alert primitive, so there
    // is one implementation of "something needs your attention", not two.
    expect(html).toContain('role="alert"');
    expect(html).toContain('ui-alert--error');
    expect(html).toContain(`aria-label="${t('th', 'error.dismiss')}"`);
  });
});
