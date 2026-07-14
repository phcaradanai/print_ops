/**
 * Shared status-badge color map for job statuses.
 *
 * Background hexes are DESIGN.md's existing per-status semantic palette —
 * unchanged here. Text colors were computed from WCAG 2.1 relative-luminance
 * contrast (see DESIGN.md §5 "Status Badges", which calls for white text —
 * that guidance is superseded here because none of the 10 backgrounds clear
 * 4.5:1 against white; see the audit and math below).
 *
 * Contrast ratios (background vs #ffffff white / vs #1e1e2e Deep Navy):
 *   ACCEPTED            #74c7ec  white 1.89:1 (fail)  navy 8.69:1 (pass)
 *   VALIDATED           #89dceb  white 1.56:1 (fail)  navy 10.54:1 (pass)
 *   QUEUED              #89b4fa  white 2.11:1 (fail)  navy 7.79:1 (pass)
 *   DISPATCHED          #cba6f7  white 2.03:1 (fail)  navy 8.07:1 (pass)
 *   PRINTING            #fab387  white 1.77:1 (fail)  navy 9.27:1 (pass)
 *   SUCCESS             #a6e3a1  white 1.49:1 (fail)  navy 11.03:1 (pass)
 *   FAILED              #f38ba8  white 2.32:1 (fail)  navy 7.08:1 (pass)
 *   TIMEOUT             #f9e2af  white 1.27:1 (fail)  navy 12.91:1 (pass)
 *   CANCELLED           #9399b2  white 2.82:1 (fail)  navy 5.81:1 (pass)
 *   DUPLICATE_RETURNED  #bac2de  white 1.77:1 (fail)  navy 9.26:1 (pass)
 *
 * Every background fails WCAG AA (4.5:1) with white text and clears it
 * comfortably with Deep Navy (#1e1e2e) text — so all 10 statuses use navy.
 * Kept as a per-status record (rather than a single constant) so any future
 * background swap is re-verified status by status instead of assumed safe.
 */

export interface StatusBadgeColors {
  bg: string;
  text: string;
}

export const STATUS_BADGE: Record<string, StatusBadgeColors> = {
  ACCEPTED: { bg: '#74c7ec', text: '#1e1e2e' },
  VALIDATED: { bg: '#89dceb', text: '#1e1e2e' },
  QUEUED: { bg: '#89b4fa', text: '#1e1e2e' },
  DISPATCHED: { bg: '#cba6f7', text: '#1e1e2e' },
  PRINTING: { bg: '#fab387', text: '#1e1e2e' },
  SUCCESS: { bg: '#a6e3a1', text: '#1e1e2e' },
  FAILED: { bg: '#f38ba8', text: '#1e1e2e' },
  TIMEOUT: { bg: '#f9e2af', text: '#1e1e2e' },
  CANCELLED: { bg: '#9399b2', text: '#1e1e2e' },
  DUPLICATE_RETURNED: { bg: '#bac2de', text: '#1e1e2e' },
};

/** Fallback for an unrecognized/unknown status string. */
export const STATUS_BADGE_FALLBACK: StatusBadgeColors = { bg: '#cccccc', text: '#1e1e2e' };

export function getStatusBadgeColors(status: string): StatusBadgeColors {
  return STATUS_BADGE[status] ?? STATUS_BADGE_FALLBACK;
}
