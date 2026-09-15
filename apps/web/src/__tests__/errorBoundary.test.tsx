import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from '../ErrorBoundary.js';

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <div id="content">Normal Content</div>
      </ErrorBoundary>
    );
    expect(html).toContain('Normal Content');
    expect(html).not.toContain('Something went wrong');
  });

  it('updates state via getDerivedStateFromError', () => {
    const err = new Error('Test crash');
    const newState = ErrorBoundary.getDerivedStateFromError(err);
    expect(newState.hasError).toBe(true);
    expect(newState.error).toBe(err);
    expect(newState.showStack).toBe(false);
    expect(newState.copied).toBe(false);
  });

  it('renders standalone error fallback when in error state', () => {
    const boundary = new ErrorBoundary({ children: <div>Child</div> });
    boundary.state = {
      hasError: true,
      error: new Error('Render failed with test crash'),
      showStack: false,
      copied: false,
    };

    const html = renderToStaticMarkup(boundary.render());

    expect(html).toContain('เกิดข้อผิดพลาด'); // Default locale is TH
    expect(html).toContain('Render failed with test crash');
    expect(html).toContain('ลองกู้คืนหน้า');
    expect(html).toContain('เริ่มแอปใหม่');
    expect(html).toContain('คัดลอกรายละเอียดข้อผิดพลาด');
  });
});
