import type { HTMLAttributes } from 'react';
import './PageSection.css';

export type PageSectionProps = HTMLAttributes<HTMLElement>;

/**
 * A bounded content section inside a page composition.
 *
 * The section owns only its surface spacing and semantic section landmark.
 * Pages remain responsible for headings, data, and interaction behavior.
 */
export function PageSection({ className = '', ...props }: PageSectionProps) {
  return (
    <section
      {...props}
      className={`ops-surface ui-page-section${className ? ` ${className}` : ''}`}
    />
  );
}
