/**
 * The pinned batch bar for a row selection.
 *
 * It is `position: fixed`, so it does not take part in the list's flow, and the
 * actions it offers depend on what is selected: a row that still needs a human can
 * be acknowledged, a row that already carries the mark can have it taken back, and
 * every selection can be reprinted. Presenting all of that from one place is the
 * point - a selected row must never be invisible or out of reach.
 *
 * The bar measures itself and reports its height upward. Four actions wrap to four
 * lines on a phone and stay on one on a desktop, so the page cannot reserve a fixed
 * height without covering the pagination on one of those widths.
 */

import { useEffect, useRef } from 'react';
import { Button, Inline, Text } from '../../components/ui/index.js';
import { useLocale } from '../../i18n/index.js';
import { formatMessage } from '../../lib/formatMessage.js';
import './selectionBar.css';

export interface SelectionBarProps {
  selectedCount: number;
  /**
   * Selected rows that still need a human, and so can be acknowledged. Absent or
   * zero on a page with no acknowledgement (the station queue: reviewing an
   * outcome is a control-plane triage act, not a station record).
   */
  reviewableCount?: number;
  /** Selected rows that already carry the acknowledgement. */
  acknowledgedCount?: number;
  /** A batch review request is in flight. */
  busy?: boolean;
  onClear: () => void;
  onMarkReviewed?: () => void;
  onUndoReview?: () => void;
  onReprint: () => void;
  /** Reported whenever the wrapped height changes, so the page can reserve it. */
  onHeightChange: (height: number) => void;
}

export function SelectionBar({
  selectedCount,
  reviewableCount = 0,
  acknowledgedCount = 0,
  busy = false,
  onClear,
  onMarkReviewed,
  onUndoReview,
  onReprint,
  onHeightChange,
}: SelectionBarProps) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      onHeightChange(0);
      return;
    }
    const measure = () => onHeightChange(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeightChange, selectedCount, reviewableCount, acknowledgedCount]);

  return (
    <div
      ref={ref}
      className="wcj-selection-bar"
      role="region"
      aria-label={formatMessage(t('control.jobs.selectedCount'), { count: selectedCount })}
    >
      <Text weight="semibold">
        {formatMessage(t('control.jobs.selectedCount'), { count: selectedCount })}
      </Text>
      <Inline gap="sm">
        <Button size="sm" variant="secondary" onClick={onClear}>
          {t('control.jobs.clearSelection')}
        </Button>
        {reviewableCount > 0 && (
          <Button size="sm" variant="secondary" busy={busy} onClick={onMarkReviewed}>
            {formatMessage(t('control.jobs.reviewSelected'), { count: reviewableCount })}
          </Button>
        )}
        {acknowledgedCount > 0 && (
          <Button size="sm" variant="secondary" busy={busy} onClick={onUndoReview}>
            {formatMessage(t('control.jobs.unreviewSelected'), { count: acknowledgedCount })}
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={onReprint}>
          {formatMessage(t('control.jobs.reprintSelected'), { count: selectedCount })}
        </Button>
      </Inline>
    </div>
  );
}
