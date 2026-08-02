import type { ReactNode } from 'react';
import { Heading, Text } from '../../ui/typography.js';
import './SectionHeading.css';

export interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * A control that narrows what the section shows — filter tabs, a
   * "failed only" toggle — rendered on the title's own row.
   *
   * Distinct from `actions`, which sits at the far end of the row. Content
   * belongs here when it reads as part of the section's name rather than as
   * something you do to the section: "All endpoints [All | Enabled | Draft]"
   * is one phrase, and splitting it to opposite ends of a wide row breaks it.
   * Added because two sections of the Webhooks page had each hand-rolled the
   * same wrapper to get it.
   */
  scope?: ReactNode;
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
  scope,
  level = 2,
  id,
  className = '',
}: SectionHeadingProps) {
  return (
    <div className={`ui-section-heading${className ? ` ${className}` : ''}`}>
      <div className="ui-section-heading__copy">
        <div className="ui-section-heading__title-row">
          <Heading level={level} id={id}>
            {title}
          </Heading>
          {scope != null && (
            <div className="ui-section-heading__scope">{scope}</div>
          )}
        </div>
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
