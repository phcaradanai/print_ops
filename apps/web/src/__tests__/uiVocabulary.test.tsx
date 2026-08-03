/**
 * Semantic contracts for the atoms and molecules added when the 19 dashboard
 * pages were migrated onto one vocabulary. These assert behaviour the pages
 * previously got wrong by hand — not class names.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Checkbox,
  Chip,
  MetricTile,
  StatusIndicator,
  TableEmpty,
  Text,
  statusTone,
} from '../components/ui/index.js';

describe('Chip', () => {
  it('exposes pressed state, so selection is never carried by colour alone', () => {
    expect(renderToStaticMarkup(<Chip selected>NATS</Chip>)).toContain('aria-pressed="true"');
    expect(renderToStaticMarkup(<Chip>NATS</Chip>)).toContain('aria-pressed="false"');
  });

  it('defaults to type=button so a chip inside a form cannot submit it', () => {
    expect(renderToStaticMarkup(<Chip>HTTP</Chip>)).toContain('type="button"');
  });
});

describe('StatusIndicator', () => {
  it('always renders the condition as text beside the dot', () => {
    const html = renderToStaticMarkup(<StatusIndicator condition="offline" />);
    expect(html).toContain('offline');
    expect(html).toContain('aria-hidden="true"'); // the dot itself carries no meaning
  });

  it('never paints an uninterpretable condition as healthy', () => {
    expect(statusTone('idle')).toBe('ok');
    expect(statusTone('offline')).toBe('down');
    expect(statusTone('something-new')).toBe('unknown');
    expect(statusTone(undefined)).toBe('unknown');
    expect(statusTone(null)).toBe('unknown');
  });
});

describe('MetricTile', () => {
  it('renders the value and its label together', () => {
    const html = renderToStaticMarkup(<MetricTile label="Failed jobs" value={3} tone="critical" />);
    expect(html).toContain('Failed jobs');
    expect(html).toContain('3');
  });
});

describe('TableEmpty', () => {
  it('spans the column count it is given', () => {
    const html = renderToStaticMarkup(
      <table><tbody><TableEmpty columns={7}>Nothing here</TableEmpty></tbody></table>,
    );
    // HTML attribute names are case-insensitive; assert the span, not the casing.
    expect(html).toMatch(/colspan="7"/i);
    expect(html).toContain('Nothing here');
  });
});

describe('Checkbox', () => {
  it('keeps a per-row label in the accessibility tree when it is visually hidden', () => {
    const html = renderToStaticMarkup(<Checkbox hideLabel label="Select job a1b2c3" />);
    expect(html).toContain('Select job a1b2c3');
    expect(html).toContain('ui-visually-hidden');
  });
});

describe('Text', () => {
  it('does not transform localized copy unless caps is explicitly requested', () => {
    // Thai glyph clusters must never be uppercased or letter-spaced.
    const thai = renderToStaticMarkup(<Text size="label">สถานะ</Text>);
    expect(thai).not.toContain('ui-text--caps');
    expect(renderToStaticMarkup(<Text caps>Status</Text>)).toContain('ui-text--caps');
  });

  it('renders as the requested element so paragraphs stay paragraphs', () => {
    expect(renderToStaticMarkup(<Text as="p">Copy</Text>)).toContain('<p');
  });
});
