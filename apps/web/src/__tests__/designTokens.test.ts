/**
 * Ratchet for the design-token rules in DESIGN.md and docs/design/design-system.md.
 *
 * The 2026-11 audit found ~30 literal font sizes against a 7-step scale, a
 * muted-text token that failed WCAG AA on every route, and 42 component
 * classes whose base rule lives in more than one stylesheet. The first two
 * were fixed; the third is debt being paid down. These checks stop all three
 * from regrowing. Lower a ceiling when you remove debt; never raise one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function cssFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

const sheets = cssFiles().map((path) => ({ path: relative(SRC, path), css: readFileSync(path, 'utf8') }));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function rootToken(name: string): string {
  const root = sheets.find((sheet) => sheet.path === 'styles.css')!.css;
  const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`--${name} is not a 6-digit hex in styles.css`);
  return match[1];
}

describe('design tokens', () => {
  it('keeps muted text at WCAG AA on every light surface', () => {
    const muted = rootToken('neutral-text-muted');
    for (const surface of ['neutral-surface', 'neutral-page', 'neutral-subtle', 'neutral-paper', 'state-info-surface']) {
      expect(contrast(muted, rootToken(surface)), `muted on --${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('sets sub-1rem font sizes only through the type-scale tokens', () => {
    // 1rem and up are headings, glyph-sized icons and the 16px anti-zoom input rule.
    const offScale = sheets.flatMap(({ path, css }) =>
      [...css.matchAll(/font-size:\s*(0?\.\d+rem|\d+px)/g)]
        .filter(([, value]) => !(value.endsWith('px') && parseInt(value, 10) >= 16))
        .map(([decl]) => `${path}: ${decl}`),
    );
    // Icon buttons size their glyph, not text (components/ui/ui.css).
    expect(offScale.filter((line) => !line.startsWith('components/ui/ui.css'))).toEqual([]);
  });

  it('does not add component base rules to a second stylesheet', () => {
    const owners = new Map<string, Set<string>>();
    for (const { path, css } of sheets) {
      for (const [, cls] of css.matchAll(/^(\.[a-zA-Z][\w-]*)\s*\{/gm)) {
        owners.set(cls, (owners.get(cls) ?? new Set()).add(path));
      }
    }
    const shared = [...owners].filter(([, files]) => files.size > 1).map(([cls]) => cls);
    // shortcut: ceiling, not zero — 42 classes predate this guard; lower it as they consolidate.
    expect(shared.length, `classes with base rules in >1 file:\n${shared.join('\n')}`).toBeLessThanOrEqual(42);
  });

  it('adds no new hotfix layer stylesheets', () => {
    const layers = sheets.map(({ path }) => path).filter((path) => /hotfix|closure|completion/i.test(path));
    // These four exist; DESIGN.md forbids adding another. Delete entries as they are folded in.
    expect(layers.sort()).toEqual([
      'paperProfilesClosure.css',
      'paperProfilesCompletion.css',
      'paperProfilesLayoutHotfix.css',
      'paperProfilesLibraryGeometryHotfix.css',
    ]);
  });
});
