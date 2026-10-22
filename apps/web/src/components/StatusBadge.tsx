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
import { getJobVerdict, type VerdictTone } from '../lib/jobVerdict.js';
import './StatusBadge.css';

export type StatusBadgeSize = 'sm' | 'md' | 'lg';

const STATUS_ICON_PATHS: Record<VerdictTone, string> = {
  confirmed: 'm5 12 4 4L19 6',
  progress: 'M20 8V3l-3 3a8 8 0 1 0 2 12M20 3h-5',
  pending: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  caution: 'M12 3 2 21h20L12 3Zm0 5v6m0 3h.01',
  negative: 'm6 6 12 12M6 18 18 6',
  neutral: 'M5 12h14',
};

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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={STATUS_ICON_PATHS[getJobVerdict(status).tone]} />
      </svg>
      <span>{status}</span>
    </span>
  );
}
