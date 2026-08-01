import type { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  label?: string;
  responsive?: boolean;
  children: ReactNode;
}

export function DataTable({ label, responsive = false, className = '', children, ...props }: DataTableProps) {
  return (
    <div className="ui-data-table-frame" data-responsive={responsive || undefined} tabIndex={0} role="region" aria-label={label}>
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

export interface TableEmptyProps {
  /** Must match the table's column count so the row spans the full width. */
  columns: number;
  children: ReactNode;
}

/**
 * The empty body of a table.
 *
 * Every list page spelled this the same way by hand —
 * `<tr><td colSpan={7}><EmptyState …/></td></tr>` — and got the number wrong
 * often enough to matter, which silently narrows the row. Passing `columns`
 * keeps the count next to the header it has to match, and the cell opts out of
 * the responsive per-cell label so the empty message is not prefixed with a
 * column name on mobile.
 */
export function TableEmpty({ columns, children }: TableEmptyProps) {
  return (
    <tr className="ui-table-empty">
      <td colSpan={columns} className="ui-data-cell ui-table-empty__cell">
        {children}
      </td>
    </tr>
  );
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



export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span {...props} className={`ui-badge ui-badge--${tone}${className ? ` ${className}` : ''}`} />;
}
