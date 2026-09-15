import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

export function TabList({ label, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return <div {...props} className={`ui-tabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={label} />;
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role'> {
  selected: boolean;
  panelId?: string;
  count?: number;
  children: ReactNode;
}

export function Tab({ selected, panelId, count, className = '', children, type = 'button', ...props }: TabProps) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-tab${selected ? ' is-selected' : ''}${className ? ` ${className}` : ''}`}
      role="tab"
      aria-selected={selected}
      aria-controls={panelId}
    >
      <span>{children}</span>
      {count != null && <span className="ui-tab__count" aria-label={String(count)}>{count}</span>}
    </button>
  );
}

export function TabPanel({ active, className = '', children, ...props }: HTMLAttributes<HTMLDivElement> & { active: boolean; children: ReactNode }) {
  const fallbackId = useId();
  return (
    <div {...props} id={props.id ?? fallbackId} className={`ui-tab-panel${className ? ` ${className}` : ''}`} role="tabpanel" hidden={!active}>
      {children}
    </div>
  );
}

