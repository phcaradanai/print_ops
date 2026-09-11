import type { HTMLAttributes, ReactNode } from 'react';
import './ResourceToolbar.css';

export interface ResourceToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  ariaLabel: string;
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * Groups search and filter molecules for a resource list.
 *
 * Pages own query state and labels. The toolbar owns only responsive layout and
 * the accessible grouping of controls and optional local actions.
 */
export function ResourceToolbar({
  ariaLabel,
  children,
  actions,
  className = '',
  ...props
}: ResourceToolbarProps) {
  return (
    <div
      {...props}
      role="group"
      aria-label={ariaLabel}
      className={`ui-resource-toolbar${className ? ` ${className}` : ''}`}
    >
      <div className="ui-resource-toolbar__controls">{children}</div>
      {actions != null && <div className="ui-resource-toolbar__actions">{actions}</div>}
    </div>
  );
}
