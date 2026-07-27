import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { EmptyState, ErrorBanner, ErrorState, LoadingState } from '../components/PageState.js';
import { LocaleProvider } from '../i18n/index.js';
import { ApiError, networkApiError } from '../api/errors.js';
import { t } from '../i18n/translations.js';

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

describe('ErrorBanner', () => {
  it('is an alert that keeps the surrounding page content', () => {
    const html = render(
      <ErrorBanner error={networkApiError('/jobs', new Error('Failed to fetch'))} onDismiss={() => {}} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('state-banner--error');
    expect(html).toContain(`aria-label="${t('th', 'error.dismiss')}"`);
  });
});
