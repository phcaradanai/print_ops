import type { ReactNode } from 'react';
import { Heading, Text } from '../../ui/typography.js';
import './SectionHeading.css';

export interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2 | 3 | 4;
  id?: string;
  className?: string;
}

/**
 * A reusable section title, supporting copy, and local actions.
 *
 * Actions wrap below the copy on narrow widths rather than squeezing localized
 * labels. The molecule has no page, API, or domain knowledge.
 */
export function SectionHeading({
  title,
  description,
  actions,
  level = 2,
  id,
  className = '',
}: SectionHeadingProps) {
  return (
    <div className={`ui-section-heading${className ? ` ${className}` : ''}`}>
      <div className="ui-section-heading__copy">
        <Heading level={level} id={id}>
          {title}
        </Heading>
        {description != null && (
          <Text as="p" tone="muted" className="ui-section-heading__description">
            {description}
          </Text>
        )}
      </div>
      {actions != null && (
        <div className="ui-section-heading__actions">
          {actions}
        </div>
      )}
    </div>
  );
}
