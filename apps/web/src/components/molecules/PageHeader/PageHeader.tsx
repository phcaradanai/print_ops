import type { HTMLAttributes, ReactNode } from 'react';
import { Heading, Text } from '../../ui/typography.js';
import './PageHeader.css';

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}

/**
 * Route identity and current-page actions.
 *
 * This molecule owns only presentation and responsive wrapping. Product pages
 * still decide the title, copy, permissions, and which actions are available.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className = '',
  ...props
}: PageHeaderProps) {
  const hasCopy = eyebrow != null || title != null || description != null;

  if (!hasCopy && actions == null) return null;

  return (
    <header
      {...props}
      className={`ops-page__header ui-page-header${className ? ` ${className}` : ''}`}
    >
      {hasCopy && (
        <div className="ops-page__heading ui-page-header__copy">
          {eyebrow != null && (
            <Text as="div" size="label" tone="muted" className="ui-page-header__eyebrow">
              {eyebrow}
            </Text>
          )}
          {title != null && (
            <Heading level={1} size="page" className="ops-page__title ui-page-header__title">
              {title}
            </Heading>
          )}
          {description != null && (
            <Text as="p" tone="muted" className="ops-page__description ui-page-header__description">
              {description}
            </Text>
          )}
        </div>
      )}

      {actions != null && (
        <div className="ops-page__actions ui-page-header__actions">
          {actions}
        </div>
      )}
    </header>
  );
}
