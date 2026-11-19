// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizePreviewHtml } from '../lib/previewHtml.js';
import { PRINT_FONT_NAME } from '@printerops/shared';

describe('sanitizePreviewHtml', () => {
  it('preserves renderer SVG image barcodes and the trusted embedded print font', () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h4v4z"/></svg>');
    const result = sanitizePreviewHtml(`<style>body{color:red}</style><div style='font-family:"${PRINT_FONT_NAME}"'><img src="data:image/svg+xml;base64,${svg}"></div>`);
    expect(result).toContain(`src="data:image/svg+xml;base64,${svg}"`);
    expect(result).toContain('data-printops-font');
    expect(result).toContain('@font-face');
    expect(result).not.toContain('body{color:red}');
  });

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
