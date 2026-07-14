import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[PrintOps] React render error:', error.message);
    console.error('[PrintOps] Component stack:', info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
          background: '#f5f5f5',
          color: '#1e1e2e',
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#6b7280', marginBottom: '1rem', maxWidth: '480px', textAlign: 'center' }}>
            An unexpected error occurred while rendering the page.
            Please try restarting the application.
          </p>
          {this.state.error && (
            <pre style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '0.75rem 1rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              maxWidth: '100%',
              overflow: 'auto',
              marginBottom: '1.5rem',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: '0.7rem 1.5rem',
              border: 'none',
              borderRadius: '6px',
              background: '#1e1e2e',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            Restart App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
