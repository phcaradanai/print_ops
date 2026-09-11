import { useMemo, useState, type ReactNode } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { DataCell, DataHead, DataTable, TableEmpty } from '../../ui/data-display.js';
import './DataGrid.css';

/**
 * The shared table.
 *
 * TanStack Table supplies row modelling and sort state; PrintOps supplies every
 * pixel. Rendering goes through the existing `DataTable` / `DataHead` /
 * `DataCell` primitives, so a page migrated onto this looks identical to the
 * hand-written table it replaces — the point is to stop each route
 * re-implementing sorting and empty handling, not to restyle anything.
 *
 * Pages import this, never `@tanstack/react-table`. That boundary is what keeps
 * the library replaceable and stops table behavior from drifting per route.
 */

export interface DataGridColumn<Row> {
  /** Stable key. Also the sort key when `sortable` is set. */
  id: string;
  /** Header text. Already localized by the caller — this component never
   *  translates, so it cannot disagree with the page's own labels. */
  header: string;
  /** Cell body. Returning a node keeps formatting decisions with the page. */
  cell: (row: Row) => ReactNode;
  /** Comparable value for sorting. Omit to make the column unsortable. */
  sortValue?: (row: Row) => string | number | null | undefined;
  align?: 'start' | 'end';
}

export interface DataGridProps<Row> {
  /** Accessible table name. */
  label: string;
  columns: Array<DataGridColumn<Row>>;
  rows: Row[];
  /** Stable row identity — required, so React keys never fall back to index. */
  rowId: (row: Row) => string;
  /** Shown in place of the body when there are no rows. */
  empty: ReactNode;
  /** Card-per-row layout on narrow screens, as `DataTable` already implements. */
  responsive?: boolean;
  /** Initial sort, e.g. `{ id: 'time', desc: true }`. */
  initialSort?: { id: string; desc: boolean };
  /** Per-row class, for state accents a page already owns (e.g. `job-row failed`). */
  rowClassName?: (row: Row) => string | undefined;
  /** Sort control labels. Localized by the caller. */
  sortLabel?: (columnHeader: string) => string;
}

export function DataGrid<Row>({
  label,
  columns,
  rows,
  rowId,
  empty,
  responsive = false,
  initialSort,
  rowClassName,
  sortLabel,
}: DataGridProps<Row>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [initialSort] : []);

  const tanstackColumns = useMemo(() => {
    const helper = createColumnHelper<Row>();
    return columns.map((column) =>
      helper.display({
        id: column.id,
        header: column.header,
        cell: (context) => column.cell(context.row.original),
        enableSorting: column.sortValue != null,
        // A display column has no accessor, so sorting needs an explicit
        // comparator. Nullish values sort last in either direction rather than
        // being coerced to 0/"" and landing in the middle of real data.
        sortingFn: (a, b) => {
          const left = column.sortValue?.(a.original);
          const right = column.sortValue?.(b.original);
          if (left == null && right == null) return 0;
          if (left == null) return 1;
          if (right == null) return -1;
          if (typeof left === 'number' && typeof right === 'number') return left - right;
          return String(left).localeCompare(String(right));
        },
      }),
    );
  }, [columns]);

  const table = useReactTable({
    data: rows,
    columns: tanstackColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => rowId(row),
    // Nullish values are compared by our own sortingFn above; letting TanStack
    // reorder them first would fight it.
    sortDescFirst: false,
  });

  const columnById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );

  return (
    <DataTable label={label} responsive={responsive}>
      <thead>
        <tr>
          {table.getHeaderGroups()[0]?.headers.map((header) => {
            const column = columnById.get(header.column.id);
            const sortable = header.column.getCanSort();
            const direction = header.column.getIsSorted();
            return (
              <DataHead
                key={header.id}
                {...(column?.align === 'end' ? { align: 'right' as const } : {})}
                {...(sortable
                  ? { 'aria-sort': direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none' }
                  : {})}
              >
                {sortable ? (
                  <button
                    type="button"
                    className="ui-data-sort"
                    onClick={header.column.getToggleSortingHandler()}
                    aria-label={sortLabel?.(String(header.column.columnDef.header ?? header.id))}
                  >
                    <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                    {/* Direction is carried by aria-sort for assistive tech and by
                        a glyph for sighted users, never by color alone. */}
                    <span aria-hidden="true" className="ui-data-sort__mark" data-direction={direction || 'none'}>
                      {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}
                    </span>
                  </button>
                ) : (
                  flexRender(header.column.columnDef.header, header.getContext())
                )}
              </DataHead>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} {...(rowClassName?.(row.original) ? { className: rowClassName(row.original) } : {})}>
            {row.getVisibleCells().map((cell) => {
              const column = columnById.get(cell.column.id);
              return (
                <DataCell
                  key={cell.id}
                  label={column?.header ?? ''}
                  {...(column?.align === 'end' ? { align: 'right' as const } : {})}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </DataCell>
              );
            })}
          </tr>
        ))}
        {rows.length === 0 && <TableEmpty columns={columns.length}>{empty}</TableEmpty>}
      </tbody>
    </DataTable>
  );
}
