import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JOB_STATUSES } from '@printerops/domain';
import { STATUS_BADGE, getStatusBadgeColors } from '../statusColors.js';

/**
 * PrintOps draws three separate color axes and DESIGN.md requires they stay
 * separate: job status, device condition, and feedback state. The failure this
 * guards is not cosmetic — an operator who reads a FAILED job as a down printer
 * (or the reverse) troubleshoots the wrong thing.
 *
 * The concrete bug it prevents: DESIGN.md declared eleven `status-*` values but
 * CSS defined none of them, so every surface needing one invented a literal.
 * The job-row dot drew SUCCESS as #2f732a while the badge for the same job drew
 * #166534 — one status, two colors on one screen.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const styles = readFileSync(join(SRC, 'styles.css'), 'utf8');

function tokenValue(name: string): string | undefined {
  return styles.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`))?.[1]?.toLowerCase();
}

describe('status color axes', () => {
  it('defines a CSS token for every job status the domain can emit', () => {
    const missing = JOB_STATUSES.filter((status) => {
      const token = getStatusBadgeColors(status).border.match(/var\((--[a-z-]+)\)/)?.[1];
      return !token || !tokenValue(token.replace('--', ''));
    });
    expect(missing, 'every JOB_STATUSES member needs a --status-* token defined in styles.css').toEqual([]);
  });

  it('resolves badge colors through tokens rather than repeating literals', () => {
    for (const [status, colors] of Object.entries(STATUS_BADGE)) {
      expect(colors.border, `${status} border must reference a token`).toMatch(/^var\(--status-/);
      expect(colors.text, `${status} text must reference a token`).toMatch(/^var\(--status-/);
    }
  });

  it('keeps the job-status and device axes on different tokens', () => {
    // Values may coincide; the tokens must not. A device surface reaching for a
    // --status-* token is the axis crossing DESIGN.md names outright.
    const deviceRules = styles.match(/\.status-indicator--[^{]*\{[^}]*\}/g) ?? [];
    expect(deviceRules.length).toBeGreaterThan(0);
    const crossings = deviceRules.filter((rule) => /var\(--status-/.test(rule));
    expect(crossings, 'device-condition rules must use --device-*, never --status-*').toEqual([]);
  });

  it('draws job-row status dots from the same axis as the badge', () => {
    const dots = styles.match(/\.job-row\.[a-z]+\s+\.status-dot\s*\{[^}]*\}/g) ?? [];
    expect(dots.length).toBeGreaterThan(0);
    const literals = dots.filter((rule) => /background:\s*#[0-9a-fA-F]{3,}/.test(rule));
    expect(literals, 'a status dot must reference a token, not its own literal').toEqual([]);
  });

  it('UNVERIFIED stays outside the FAILED hue family', () => {
    // An operator must not read "could not confirm" as "did not print"; a page
    // may already exist, so the two must never look like siblings.
    expect(tokenValue('status-unverified')).not.toBe(tokenValue('status-failed'));
    expect(tokenValue('status-unverified')).toBe('#92400e');
  });
});
