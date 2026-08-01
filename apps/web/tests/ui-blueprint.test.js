import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const blueprintUrl = new URL('../public/ui-blueprint/blueprint.js', import.meta.url);
const htmlUrl = new URL('../public/ui-blueprint/index.html', import.meta.url);
const blueprint = readFileSync(blueprintUrl, 'utf8');
const html = readFileSync(htmlUrl, 'utf8');

const expectedPages = [
  'dashboard',
  'printers',
  'printer-detail',
  'job-queue',
  'job-detail',
  'runners',
  'templates',
  'paper-profiles',
  'discovered-printers',
  'diagnostics',
  'template-sandbox',
  'webhooks',
  'route-policies',
  'printer-bindings',
  'print-flow',
  'audit-logs',
  'export',
  'users',
  'settings',
];

describe('static UI blueprint', () => {
  it('is valid JavaScript', () => {
    expect(() => new Function(blueprint)).not.toThrow();
  });

  it('covers every PRODUCT.md page exactly once in the navigation manifest', () => {
    const manifestIds = [...blueprint.matchAll(/\{ id: '([^']+)', group:/g)].map((match) => match[1]);
    expect(manifestIds).toHaveLength(19);
    expect(new Set(manifestIds)).toEqual(new Set(expectedPages));
  });

  it('provides a renderer for every page', () => {
    for (const pageId of expectedPages) {
      expect(blueprint).toMatch(new RegExp(`(?:^|\\n)\\s*['\"]?${pageId.replaceAll('-', '\\-')}['\"]?:\\s*render`));
    }
  });

  it('loads the blueprint stylesheet and module without external dependencies', () => {
    expect(html).toContain('href="./blueprint.css"');
    expect(html).toContain('src="./blueprint.js"');
    expect(html).not.toMatch(/https?:\/\//);
  });
});
