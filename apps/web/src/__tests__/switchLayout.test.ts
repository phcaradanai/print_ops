import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(fileURLToPath(new URL('..', import.meta.url)), 'components/ui/inputs.css'),
  'utf8',
);

describe('Switch layout', () => {
  // The visually hidden <input> is position:absolute. If its label is not the
  // containing block it lands far down the page, and focusing it (clicking the
  // switch) scrolls the whole document so the app shell goes blank/white.
  it('contains the hidden input inside the label', () => {
    const block = /\.ui-switch \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/position:\s*relative/);
  });
});
