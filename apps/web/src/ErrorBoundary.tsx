import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from './i18n/translations.js';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showStack: boolean;
  copied: boolean;
}

// The standalone ErrorBoundary cannot use useLocale() because it's a class component.
// It uses a simple locale detection matching the LocaleProvider default.
function detectLocale(): 'en' | 'th' {
  try {
    const stored = localStorage.getItem('printops-locale');
    if (stored === 'th' || stored === 'en') return stored;
  } catch {
    // ignore
  }
  return 'th';
}

function te(key: string): string {
  return t(detectLocale(), key);
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, showStack: false, copied: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, showStack: false, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[PrintOps] React render error:', error.message);
    console.error('[PrintOps] Component stack:', info.componentStack);
  }

  private handleCopy = async () => {
    const err = this.state.error;
    if (!err) return;
    const text = `[PrintOps Error Report]\nMessage: ${err.message}\nStack: ${err.stack ?? 'N/A'}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 3000);
    } catch {
      // Fallback ignore
    }
  };

  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const stack = err?.stack;

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem 1rem',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#f5f5f5',
          color: '#1e1e2e',
          boxSizing: 'border-box',
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            padding: '2rem',
            maxWidth: '560px',
            width: '100%',
            boxSizing: 'border-box',
            textAlign: 'center',
          }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e1e2e', marginTop: 0, marginBottom: '0.5rem' }}>
              {te('error.standalone.title')}
            </h1>
            <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              {te('error.standalone.message')}
            </p>

            {err && (
              <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
                <pre style={{
                  background: '#fee2e2',
                  color: '#991b1b',
                  padding: '0.75rem 1rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  lineHeight: 1.4,
                  maxWidth: '100%',
                  overflowX: 'auto',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  margin: '0 0 0.5rem 0',
                }}>
                  {err.message}
                </pre>

                {stack && (
                  <div>
                    <button
                      type="button"
                      onClick={() => this.setState((prev) => ({ showStack: !prev.showStack }))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#1e66f5',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      {this.state.showStack ? te('error.standalone.hideStack') : te('error.standalone.showStack')}
                    </button>

                    {this.state.showStack && (
                      <pre style={{
                        background: '#111827',
                        color: '#cdd6f4',
                        padding: '0.75rem 1rem',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        maxHeight: '200px',
                        overflow: 'auto',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        marginTop: '0.5rem',
                      }}>
                        {stack}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null, showStack: false, copied: false })}
                style={{
                  padding: '0.65rem 1.25rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  background: '#ffffff',
                  color: '#1e1e2e',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                }}
              >
                {te('error.standalone.tryRecover')}
              </button>

              {err && (
                <button
                  type="button"
                  onClick={this.handleCopy}
                  style={{
                    padding: '0.65rem 1.25rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    background: '#ffffff',
                    color: '#1e1e2e',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                  }}
                >
                  {this.state.copied ? te('error.standalone.copied') : te('error.standalone.copy')}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                style={{
                  padding: '0.65rem 1.25rem',
                  border: 'none',
                  borderRadius: '6px',
                  background: '#1e1e2e',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                }}
              >
                {te('error.standalone.restart')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
