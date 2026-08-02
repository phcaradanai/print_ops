import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '../../Button.js';
import './Pagination.css';

export interface PaginationProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'aria-label'> {
  ariaLabel: string;
  page: number;
  totalPages: number;
  previousLabel: ReactNode;
  nextLabel: ReactNode;
  status: ReactNode;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * Previous/next navigation for a paged resource view.
 *
 * The caller owns page calculation and clamping. This component owns only the
 * navigation landmark, native button semantics, boundary disabling, and the
 * polite announcement of the localized page status.
 */
export function Pagination({
  ariaLabel,
  page,
  totalPages,
  previousLabel,
  nextLabel,
  status,
  onPrevious,
  onNext,
  className = '',
  ...props
}: PaginationProps) {
  return (
    <nav
      {...props}
      aria-label={ariaLabel}
      className={`ui-pagination${className ? ` ${className}` : ''}`}
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={onPrevious}
      >
        {previousLabel}
      </Button>
      <span className="ui-pagination__status" aria-live="polite" aria-atomic="true">
        {status}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={onNext}
      >
        {nextLabel}
      </Button>
    </nav>
  );
}
