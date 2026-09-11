import { useId, type FieldsetHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

export type SurfaceTone = 'default' | 'subtle';
export type SurfacePadding = 'none' | 'md' | 'lg' | 'xl';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  tone?: SurfaceTone;
  padding?: SurfacePadding;
  children: ReactNode;
}

export function Panel({
  title,
  description,
  actions,
  footer,
  tone = 'default',
  padding = 'xl',
  className = '',
  children,
  ...props
}: PanelProps) {
  const generatedId = useId();
  const headingId = title != null ? generatedId : undefined;
  return (
    <section
      {...props}
      className={`ui-panel ui-panel--${tone} ui-panel--pad-${padding}${className ? ` ${className}` : ''}`}
      aria-labelledby={props['aria-labelledby'] ?? headingId}
    >
      {(title != null || description != null || actions != null) && (
        <header className="ui-panel__header">
          <div className="ui-panel__heading">
            {title != null && <h2 id={headingId} className="ui-panel__title">{title}</h2>}
            {description != null && <p className="ui-panel__description">{description}</p>}
          </div>
          {actions != null && <div className="ui-panel__actions">{actions}</div>}
        </header>
      )}
      <div className="ui-panel__body">{children}</div>
      {footer != null && <footer className="ui-panel__footer">{footer}</footer>}
    </section>
  );
}

export interface FieldsetProps extends FieldsetHTMLAttributes<HTMLFieldSetElement> {
  legend: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

export function Fieldset({ legend, description, className = '', children, ...props }: FieldsetProps) {
  return (
    <fieldset {...props} className={`ui-fieldset${className ? ` ${className}` : ''}`}>
      <legend className="ui-fieldset__legend">{legend}</legend>
      {description != null && <p className="ui-fieldset__description">{description}</p>}
      <div className="ui-fieldset__body">{children}</div>
    </fieldset>
  );
}

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  children: ReactNode;
  align?: 'start' | 'between' | 'end';
}

export function Toolbar({ label, align = 'start', className = '', children, ...props }: ToolbarProps) {
  return (
    <div {...props} className={`ui-toolbar ui-toolbar--${align}${className ? ` ${className}` : ''}`} role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}
