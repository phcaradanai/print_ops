/**
 * Device and connection state atoms (FE-02).
 *
 * Distinct from `StatusBadge`, which renders a print *job* status and must show
 * the server's literal string. These render a *device or service* condition
 * (idle / busy / offline / error / unknown, runner online/offline), which pages
 * previously drew with a hand-placed `<span className="status-dot">` plus a
 * page-local hex map — `Printers`, `DiscoveredPrinters` and `LocalDiagnostics`
 * each carried their own copy of that map, and they disagreed.
 *
 * The dot is never the only channel: `StatusIndicator` always renders the
 * condition as text beside it, per the "color not sole communicator" rule.
 */

import type { HTMLAttributes, ReactNode } from 'react';

export type StatusTone = 'ok' | 'busy' | 'down' | 'unknown';

/**
 * Device conditions the API reports, mapped to the four tones the palette has.
 * An unrecognised condition falls through to `unknown` rather than guessing —
 * a state we cannot interpret must not be painted as healthy.
 */
const CONDITION_TONE: Record<string, StatusTone> = {
  idle: 'ok',
  online: 'ok',
  ready: 'ok',
  active: 'ok',
  busy: 'busy',
  printing: 'busy',
  warming: 'busy',
  offline: 'down',
  error: 'down',
  fault: 'down',
  unreachable: 'down',
  unknown: 'unknown',
};

export function statusTone(condition: string | undefined | null): StatusTone {
  if (!condition) return 'unknown';
  return CONDITION_TONE[condition.toLowerCase()] ?? 'unknown';
}

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
}

export function StatusDot({ tone, className = '', ...props }: StatusDotProps) {
  return (
    <span
      {...props}
      className={`ui-status-dot ui-status-dot--${tone}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    />
  );
}

export interface StatusIndicatorProps {
  /** Raw condition string from the API; also the visible label unless `children` overrides it. */
  condition: string | undefined | null;
  children?: ReactNode;
  tone?: StatusTone;
}

export function StatusIndicator({ condition, children, tone }: StatusIndicatorProps) {
  const resolved = tone ?? statusTone(condition);
  return (
    <span className={`ui-status-indicator ui-status-indicator--${resolved}`}>
      <StatusDot tone={resolved} />
      <span className="ui-status-indicator__text">{children ?? condition}</span>
    </span>
  );
}
