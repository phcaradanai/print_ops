// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizePreviewHtml } from '../lib/previewHtml.js';

describe('sanitizePreviewHtml', () => {
  it('keeps print layout and inline barcode SVG while removing executable markup', () => {
    const result = sanitizePreviewHtml('<div style="position:absolute;color:#111">Label</div><svg viewBox="0 0 4 4"><path d="M0 0h4v4z" /></svg><script>alert(1)</script><img src="https://tracker.invalid/pixel" onerror="alert(1)">');
    expect(result).toContain('position:absolute');
    expect(result).toContain('<svg');
    expect(result).toContain('<path');
    expect(result).not.toContain('script');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('tracker.invalid');
  });

  it('removes URL-bearing CSS and unsafe link targets', () => {
    const result = sanitizePreviewHtml('<span style="background:url(javascript:alert(1))">x</span><a href="javascript:alert(1)">link</a>');
    expect(result).not.toContain('style=');
    expect(result).not.toContain('href=');
  });
});
