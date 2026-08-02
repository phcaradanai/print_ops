import type { HTMLAttributes, ReactNode } from 'react';
import { PageHeader } from './molecules/PageHeader/index.js';
import {
  PageScaffold,
  type PageDensity,
  type PageWidth,
} from './organisms/PageScaffold/index.js';

export { PageFooter, type PageFooterProps } from './molecules/PageFooter/index.js';
export { PageSection, type PageSectionProps } from './molecules/PageSection/index.js';
export type { PageDensity, PageWidth } from './organisms/PageScaffold/index.js';

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
 * Backward-compatible page composition facade.
 *
 * Existing routes keep the same API while the implementation is composed from
 * a reusable header molecule and scaffold organism. New page-level behavior
 * belongs in those bounded components instead of accumulating here.
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
  const headerRegion = !hasHeader
    ? undefined
    : header != null
      ? <header className="ops-page__header ui-page-header">{header}</header>
      : <PageHeader title={title} description={description} actions={actions} />;

  return (
    <PageScaffold
      {...rest}
      header={headerRegion}
      detail={detail}
      footer={footer}
      width={width}
      density={density}
      className={className}
    >
      {children}
    </PageScaffold>
  );
}
