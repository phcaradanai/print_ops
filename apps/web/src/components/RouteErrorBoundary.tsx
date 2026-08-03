/**
 * Route-level render error boundary (FE-01).
 *
 * Two boundaries exist on purpose and the nesting matters:
 *
 *   main.tsx : <ErrorBoundary>            ← last resort, OUTSIDE LocaleProvider,
 *                <BrowserRouter>            so it must not use useLocale(); it is
 *                  <App>                    the only thing that can catch a throw
 *                    <LocaleProvider>       from the provider itself.
 *                      <RouteErrorBoundary> ← this file: inside the provider,
 *                        <Routes/>            localized, and RESET on navigation.
 *
 * The version this replaces (inline in App.tsx) had no `componentDidCatch`, so
 * a crashing page logged nothing, and no reset key, so once a page threw the
 * only way out was a full reload — navigating away kept showing the fallback.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { logError } from '../lib/logError.js';
import { useLocale } from '../i18n/index.js';

function RouteErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useLocale();
  return (
    <div className="error-fallback" role="alert">
      <h2>{t('error.title')}</h2>
      <p>{error.message}</p>
      <div className="state-panel-actions">
        <button type="button" className="btn-secondary" onClick={onRetry}>
          {t('error.retry')}
        </button>
        <button type="button" onClick={() => window.location.reload()} className="error-reload-btn">
          {t('error.reload')}
        </button>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
  /** Changing this value clears the caught error (we pass the pathname). */
  resetKey: string;
}

interface State {
  error: Error | null;
  resetKey: string;
}

class RouteErrorBoundaryInner extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError('render', error);
    if (info.componentStack) console.error(info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <RouteErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

/** Wraps the routed content and resets itself whenever the route changes. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <RouteErrorBoundaryInner resetKey={location.pathname}>{children}</RouteErrorBoundaryInner>;
}
