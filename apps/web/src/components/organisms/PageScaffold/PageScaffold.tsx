import type { HTMLAttributes, ReactNode } from 'react';
import './PageScaffold.css';

export type PageWidth = 'standard' | 'wide' | 'full';
export type PageDensity = 'comfortable' | 'compact';

export interface PageScaffoldProps extends HTMLAttributes<HTMLElement> {
  header?: ReactNode;
  detail?: ReactNode;
  footer?: ReactNode;
  width?: PageWidth;
  density?: PageDensity;
  children: ReactNode;
}

/**
 * Canonical route anatomy: header, primary task, supporting evidence, actions.
 *
 * Slots are deliberately generic. Pages own data fetching and business rules;
 * this organism owns document order, width, density, region placement, and
 * responsive spacing. The header slot is wrapped only for grid placement so a
 * semantic PageHeader (or a compatibility header) remains the landmark owner.
 */
export function PageScaffold({
  header,
  detail,
  footer,
  width = 'wide',
  density = 'comfortable',
  className = '',
  children,
  ...props
}: PageScaffoldProps) {
  return (
    <article
      {...props}
      className={`ops-page ops-page--${width} ops-page--${density} ui-page-scaffold ui-page-scaffold--${width} ui-page-scaffold--${density}${className ? ` ${className}` : ''}`}
    >
      {header != null && (
        <div className="ui-page-scaffold__header">{header}</div>
      )}
      <div className="ops-page__body ui-page-scaffold__body">{children}</div>
      {detail != null && (
        <aside className="ops-page__detail ui-page-scaffold__detail">{detail}</aside>
      )}
      {footer != null && (
        <footer className="ops-page__footer ui-page-scaffold__footer">{footer}</footer>
      )}
    </article>
  );
}
