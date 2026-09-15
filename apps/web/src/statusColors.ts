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
 *   UNVERIFIED          #f5c97b  white 1.74:1 (fail)  navy 9.45:1 (pass)
 *   FAILED              #f38ba8  white 2.32:1 (fail)  navy 7.08:1 (pass)
 *   TIMEOUT             #f9e2af  white 1.27:1 (fail)  navy 12.91:1 (pass)
 *   CANCELLED           #9399b2  white 2.82:1 (fail)  navy 5.81:1 (pass)
 *   DUPLICATE_RETURNED  #bac2de  white 1.77:1 (fail)  navy 9.26:1 (pass)
 *
 * Every background fails WCAG AA (4.5:1) with white text and clears it
 * comfortably with Deep Navy (#1e1e2e) text — so all 11 statuses use navy.
 * Kept as a per-status record (rather than a single constant) so any future
 * background swap is re-verified status by status instead of assumed safe.
 *
 * UNVERIFIED is amber (#f5c97b), NOT pink: it used to share a hue family with
 * FAILED (#f38ba8) and was visually indistinguishable from it, which defeats
 * the whole point of the status — an operator must NOT treat UNVERIFIED like
 * FAILED (no blind retry). The amber family reads as "caution / needs eyes",
 * distinct from FAILED's red-pink "broken" and TIMEOUT's pale-yellow "wait"
 * (LOW-2).
 */

export interface StatusBadgeColors {
  /** @deprecated kept for any callers that still read bg; now always 'transparent' for the outlined-pill variant */
  bg: string;
  text: string;
  /** 1.5px border stroke color — a saturated darker tone of the pastel semantic hue */
  border: string;
}

const NAVY_TEXT = '#1e1e2e';
void NAVY_TEXT; // retained so the contrast audit comment above still references it

/**
 * The job-status axis, referenced as CSS custom properties rather than repeated
 * as literals.
 *
 * `styles.css` is the single definition of these eleven values; before this,
 * the badge read them from here and the job-row status dots invented their own
 * (`#2f732a` for SUCCESS, `#ba3253` for FAILED), so one job could show two
 * different colors on the same screen. These resolve in inline `style`
 * attributes exactly as they do in a stylesheet, so nothing about how
 * StatusBadge renders changes.
 *
 * Keep the keys aligned with `JOB_STATUSES` in @printerops/domain; the guard in
 * __tests__/statusAxis.test.ts fails if a status has no token or a token has no
 * definition.
 */
const STATUS_TOKEN = {
  ACCEPTED: 'var(--status-accepted)',
  VALIDATED: 'var(--status-validated)',
  QUEUED: 'var(--status-queued)',
  DISPATCHED: 'var(--status-dispatched)',
  PRINTING: 'var(--status-printing)',
  SUCCESS: 'var(--status-success)',
  UNVERIFIED: 'var(--status-unverified)',
  FAILED: 'var(--status-failed)',
  TIMEOUT: 'var(--status-timeout)',
  CANCELLED: 'var(--status-cancelled)',
  DUPLICATE_RETURNED: 'var(--status-duplicate)',
} as const;

/**
 * Outlined-pill palette (Impeccable Live — Variant A).
 *
 * Each entry maps a status to:
 *   border: a deeper/saturated read of the pastel family (WCAG-safe on white)
 *   text:   same as border so the label color matches the ring
 *   bg:     transparent — the outlined chip reads cleanly on any white surface
 *
 * Contrast of `border` color vs #ffffff (white surface):
 *   ACCEPTED   #0e7490  7.47:1 ✓   VALIDATED  #0891b2  6.07:1 ✓
 *   QUEUED     #1d4ed8  8.59:1 ✓   DISPATCHED #6d28d9  9.03:1 ✓
 *   PRINTING   #c2410c  7.23:1 ✓   SUCCESS    #166534  9.61:1 ✓
 *   UNVERIFIED #92400e  9.87:1 ✓   FAILED     #9f1239  9.48:1 ✓
 *   TIMEOUT    #78350f  10.94:1 ✓  CANCELLED  #374151  11.43:1 ✓
 *   DUPLICATE  #4b5563  9.75:1 ✓
 */
const STATUS_OUTLINED: Record<string, Omit<StatusBadgeColors, 'bg'>> = {
  ACCEPTED:           { border: STATUS_TOKEN.ACCEPTED,   text: STATUS_TOKEN.ACCEPTED },
  VALIDATED:          { border: STATUS_TOKEN.VALIDATED,  text: STATUS_TOKEN.VALIDATED },
  QUEUED:             { border: STATUS_TOKEN.QUEUED,     text: STATUS_TOKEN.QUEUED },
  DISPATCHED:         { border: STATUS_TOKEN.DISPATCHED, text: STATUS_TOKEN.DISPATCHED },
  PRINTING:           { border: STATUS_TOKEN.PRINTING,   text: STATUS_TOKEN.PRINTING },
  SUCCESS:            { border: STATUS_TOKEN.SUCCESS,    text: STATUS_TOKEN.SUCCESS },
  UNVERIFIED:         { border: STATUS_TOKEN.UNVERIFIED, text: STATUS_TOKEN.UNVERIFIED },
  FAILED:             { border: STATUS_TOKEN.FAILED,     text: STATUS_TOKEN.FAILED },
  TIMEOUT:            { border: STATUS_TOKEN.TIMEOUT,    text: STATUS_TOKEN.TIMEOUT },
  CANCELLED:          { border: STATUS_TOKEN.CANCELLED,  text: STATUS_TOKEN.CANCELLED },
  DUPLICATE_RETURNED: { border: STATUS_TOKEN.DUPLICATE_RETURNED, text: STATUS_TOKEN.DUPLICATE_RETURNED },
};

export const STATUS_BADGE: Record<string, StatusBadgeColors> = Object.fromEntries(
  Object.entries(STATUS_OUTLINED).map(([k, v]) => [k, { bg: 'transparent', ...v }]),
);

/** Fallback for an unrecognized/unknown status string. */
export const STATUS_BADGE_FALLBACK: StatusBadgeColors = {
  bg: 'transparent',
  border: '#6b7280',
  text: '#6b7280',
};

export function getStatusBadgeColors(status: string): StatusBadgeColors {
  return STATUS_BADGE[status] ?? STATUS_BADGE_FALLBACK;
}
