/**
 * Single rendering of a print-job status (FE-01.1).
 *
 * Four pages drew this badge independently — `Dashboard`, `JobQueue` and
 * `Printers` from `statusColors.ts`, while `JobDetail` carried its OWN
 * `STATUS_COLORS` map (saturated backgrounds with white text: `#d20f39`,
 * `#40a02b`, …). That second map contradicted the contrast audit documented at
 * the top of `statusColors.ts`, which measured every candidate and concluded
 * that white text fails WCAG AA on all of them. Same job, same status, two
 * different colours depending on the page.
 *
 * There is now one implementation and one palette. Status semantics are
 * unchanged: this renders the server's status string, it never maps or groups
 * statuses.
 */

import { getStatusBadgeColors } from '../statusColors.js';
import './StatusBadge.css';

export type StatusBadgeSize = 'sm' | 'md' | 'lg';

export function StatusBadge({
  status,
  size = 'md',
  title,
}: {
  /** Raw status string from the API. Unknown values get the neutral fallback. */
  status: string;
  size?: StatusBadgeSize;
  title?: string;
}) {
  const colors = getStatusBadgeColors(status);
  return (
    <span
      className={`status-badge status-badge--${size}`}
      style={{
        background: 'transparent',
        color: colors.text,
        border: `1.5px solid ${colors.border}`,
      }}
      title={title}
    >
      {status}
    </span>
  );
}
