/**
 * At-a-glance count tiles (FE-02).
 *
 * `Dashboard` carried a page-local `StatCard` that took a raw hex string for
 * its accent (`'#40a02b'`, `'#f5c97b'`, `'#f38ba8'`) and pushed it through an
 * inline CSS custom property. Those greens and ambers are not in the palette,
 * so the dashboard was the one surface disagreeing with every status colour
 * elsewhere in the product.
 *
 * Tone is now a named operational meaning, resolved to tokens in `ui.css`.
 * `attention` is the one that matters: it is how UNVERIFIED and FAILED counts
 * announce that an operator has something to do, and it only fires when the
 * count is actually non-zero.
 */

import type { ReactNode } from 'react';
import { Text } from './typography.js';

export type MetricTone = 'neutral' | 'accent' | 'ok' | 'attention' | 'critical';

export interface MetricTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Supporting line under the value — a unit, a qualifier, a comparison. */
  detail?: ReactNode;
  tone?: MetricTone;
}

export function MetricTile({ label, value, detail, tone = 'neutral' }: MetricTileProps) {
  return (
    <div className={`ui-metric ui-metric--${tone}`}>
      <Text as="span" size="stat" className="ui-metric__value">
        {value}
      </Text>
      <span className="ui-metric__label">
        {tone !== 'neutral' && <span className="ui-metric__dot" aria-hidden="true" />}
        <Text as="span" size="label" tone="muted">
          {label}
        </Text>
      </span>
      {detail != null && (
        <Text as="span" size="label" tone="muted" className="ui-metric__detail">
          {detail}
        </Text>
      )}
    </div>
  );
}

export interface MetricGridProps {
  children: ReactNode;
  /** `primary` is the larger lead row; `secondary` is the supporting row. */
  emphasis?: 'primary' | 'secondary';
  label?: string;
}

export function MetricGrid({ children, emphasis = 'primary', label }: MetricGridProps) {
  return (
    <div className={`ui-metric-grid ui-metric-grid--${emphasis}`} role="group" aria-label={label}>
      {children}
    </div>
  );
}
