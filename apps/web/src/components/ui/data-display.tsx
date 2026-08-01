import type { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  label?: string;
  responsive?: boolean;
  children: ReactNode;
}

export function DataTable({ label, responsive = false, className = '', children, ...props }: DataTableProps) {
  return (
    <div className="ui-data-table-frame" data-responsive={responsive || undefined}>
      <table {...props} className={`ui-data-table${className ? ` ${className}` : ''}`} aria-label={label} data-responsive={responsive || undefined}>
        {children}
      </table>
    </div>
  );
}

export function DataHead({ className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...props} className={`ui-data-head${className ? ` ${className}` : ''}`} scope={props.scope ?? 'col'} />;
}

export interface DataCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  label?: string;
  actions?: boolean;
}

export function DataCell({ label, actions, className = '', ...props }: DataCellProps) {
  return <td {...props} data-label={label} data-actions={actions || undefined} className={`ui-data-cell${className ? ` ${className}` : ''}`} />;
}

export function RecordList({ className = '', ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul {...props} className={`ui-record-list${className ? ` ${className}` : ''}`} />;
}

export function RecordCard({ className = '', ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li {...props} className={`ui-record-card${className ? ` ${className}` : ''}`} />;
}

export function RecordHeader({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-record-header${className ? ` ${className}` : ''}`} />;
}

export function FactList({ className = '', ...props }: HTMLAttributes<HTMLDListElement>) {
  return <dl {...props} className={`ui-fact-list${className ? ` ${className}` : ''}`} />;
}

export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="ui-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span {...props} className={`ui-badge ui-badge--${tone}${className ? ` ${className}` : ''}`} />;
}
