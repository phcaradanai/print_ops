import type { HTMLAttributes, ReactNode } from 'react';

export type PageWidth = 'standard' | 'wide' | 'full';
export type PageDensity = 'comfortable' | 'compact';

export interface PageLayoutProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  header?: ReactNode;
  detail?: ReactNode;
  footer?: ReactNode;
  width?: PageWidth;
  density?: PageDensity;
  children: ReactNode;
}

/**
 * Canonical route anatomy for PrintOps.
 *
 * Header carries identity and current actions, Body carries the primary task,
 * Detail holds supporting evidence, and Footer is reserved for completion or
 * lifecycle controls. Detail and Footer are optional because an empty landmark
 * is worse for assistive technology than an absent one.
 */
export function PageLayout({
  title,
  description,
  actions,
  header,
  detail,
  footer,
  width = 'wide',
  density = 'comfortable',
  className = '',
  children,
  ...rest
}: PageLayoutProps) {
  const hasHeader = header != null || title != null || description != null || actions != null;

  return (
    <article
      {...rest}
      className={`ops-page ops-page--${width} ops-page--${density}${className ? ` ${className}` : ''}`}
    >
      {hasHeader && (
        <header className="ops-page__header">
          {header ?? (
            <>
              <div className="ops-page__heading">
                {title != null && <h1 className="ops-page__title">{title}</h1>}
                {description != null && <p className="ops-page__description">{description}</p>}
              </div>
              {actions != null && <div className="ops-page__actions">{actions}</div>}
            </>
          )}
        </header>
      )}

      <div className="ops-page__body">{children}</div>

      {detail != null && (
        <aside className="ops-page__detail">{detail}</aside>
      )}

      {footer != null && (
        <footer className="ops-page__footer">{footer}</footer>
      )}
    </article>
  );
}

export function PageSection({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`ops-surface${className ? ` ${className}` : ''}`} />;
}

export function PageFooter({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <footer {...props} className={`ops-action-footer${className ? ` ${className}` : ''}`} />;
}
