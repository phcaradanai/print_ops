import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../../../i18n/index.js';
import { ActionIcon } from '../../ActionIcon.js';
import { Button } from '../../Button.js';
import './BackButton.css';

export interface BackButtonProps {
  /**
   * Fallback route when there is no in-app history to pop (e.g. the page was
   * opened via a deep link): JobDetail → /jobs, PrinterDetail → /printers.
   */
  to: string;
  label?: string;
}

/**
 * Back navigation for detail pages.
 *
 * Prefers an in-app history pop (navigate(-1)) so "Job #123 ← from Dashboard"
 * returns to the Dashboard, and falls back to the known parent route instead
 * of leaving the app when the page was deep-linked (history.state.idx === 0).
 */
export function BackButton({ to, label }: BackButtonProps) {
  const navigate = useNavigate();
  const { t } = useLocale();
  const text = label ?? t('common.back');

  const handleClick = useCallback(() => {
    const idx = typeof window !== 'undefined' ? (window.history.state?.idx ?? 0) : 0;
    if (idx > 0) {
      navigate(-1);
    } else {
      navigate(to);
    }
  }, [navigate, to]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="ops-back-button"
      onClick={handleClick}
      aria-label={text}
    >
      <ActionIcon name="back" />
      <span>{text}</span>
    </Button>
  );
}
