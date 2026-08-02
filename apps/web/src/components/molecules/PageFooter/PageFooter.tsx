import type { HTMLAttributes } from 'react';
import './PageFooter.css';

export type PageFooterProps = HTMLAttributes<HTMLElement>;

/**
 * A page-local action footer.
 *
 * Use this component as a standalone footer region. When using the `footer`
 * slot on PageLayout or PageScaffold, pass the footer contents instead because
 * those components already own the semantic footer landmark.
 */
export function PageFooter({ className = '', ...props }: PageFooterProps) {
  return (
    <footer
      {...props}
      className={`ops-action-footer ui-page-footer${className ? ` ${className}` : ''}`}
    />
  );
}
