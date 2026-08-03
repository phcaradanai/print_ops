import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DESIGN.md, "Don't": never uppercase or letter-space anything that can hold
 * localized copy — table headers, field labels, legends, nav headings, badge
 * text.
 *
 * Thai has no letter case, so `text-transform: uppercase` only ever changed
 * the English half of the product: EN table headers rendered as CAPS while the
 * identical Thai header rendered normally, and the two locales stopped reading
 * as the same layout. The rule is enforced here rather than by review because
 * a single CSS line reintroduces it silently — the component-level guard in
 * uiVocabulary.test.tsx cannot see a selector that styles the element directly.
 */

const SRC = new URL('..', import.meta.url).pathname;

/** Brand wordmarks are not translated, and .ui-text--caps is the deliberate
 *  opt-in a caller asks for by name. Everything else is product copy. */
const ALLOWED_TO_UPPERCASE = new Set(['.app-nav-brand', '.app-header-brand', '.ui-text--caps']);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return full.endsWith('.css') ? [full] : [];
  });
}

/** Every selector that applies `text-transform: uppercase`, with its file. */
function uppercasingSelectors(): Array<{ selector: string; file: string }> {
  const found: Array<{ selector: string; file: string }> = [];
  for (const file of cssFiles(SRC)) {
    let selector = '';
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const open = line.match(/^\s*([^{}]+?)\s*\{/);
      if (open) selector = open[1].trim();
      // A custom-property declaration is a token definition, not an applied rule.
      if (/^\s*--/.test(line)) continue;
      if (/text-transform:\s*uppercase/.test(line)) {
        found.push({ selector, file: file.replace(SRC, '') });
      }
    }
  }
  return found;
}

describe('localized typography', () => {
  it('never uppercases a selector that carries translated copy', () => {
    const offenders = uppercasingSelectors().filter(
      ({ selector }) => !ALLOWED_TO_UPPERCASE.has(selector),
    );
    expect(
      offenders.map((o) => `${o.selector}  (${o.file})`),
      'Uppercase belongs to brand wordmarks and the explicit .ui-text--caps opt-in. ' +
        'Table headers, field labels and badge text are translated and must render ' +
        'identically in English and Thai.',
    ).toEqual([]);
  });

  it('keeps the label token free of a case transform', () => {
    const root = readFileSync(join(SRC, 'styles.css'), 'utf8');
    expect(root).toMatch(/--font-label-text-transform:\s*none/);
  });
});
