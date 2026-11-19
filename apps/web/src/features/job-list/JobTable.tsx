/**
 * The Incoming Jobs table contents: header, group select-all, body rows, column
 * widths and the resize handles.
 *
 * It is a fragment of `colgroup` + `thead` + `tbody`, not a `<table>`: the page keeps
 * the `<DataTable>` wrapper, which is what turns the table into record cards below
 * 768px. Cell *meaning* stays with the page (`renderCell`), because that is where
 * the verdict vocabulary, station names and column labels already live; a second
 * copy here would be a second definition of the same cell.
 *
 * Widths are applied through the `colgroup` only once an operator has resized
 * something, and the page only switches the table to `table-layout: fixed` at that
 * point, so the default rendering keeps the browser's own column sizing.
 */

import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Checkbox, DataCell, DataHead, Mono } from '../../components/ui/index.js';
import { useLocale } from '../../i18n/index.js';
import { formatMessage } from '../../lib/formatMessage.js';
import './jobTable.css';

/** Widths an operator can drag into; also the handle's announced min and max. */
export const MIN_COLUMN_WIDTH = 72;
export const MAX_COLUMN_WIDTH = 720;

/** One column as the table draws it: identity, family, and its localized label. */
export type JobTableColumn =
  | { id: string; kind: 'builtin'; label: string }
  | { id: string; kind: 'payload'; label: string; key: string };

export interface JobTableResizer {
  onStart: (event: PointerEvent<HTMLSpanElement>, index: number) => void;
  onMove: (event: PointerEvent<HTMLSpanElement>) => void;
  onEnd: (event: PointerEvent<HTMLSpanElement>) => void;
  onReset: (columnId: string) => void;
  onNudge: (event: KeyboardEvent<HTMLSpanElement>, index: number) => void;
}

export interface JobTableRow {
  id: string;
  /** Used in the row checkbox's accessible name when present. */
  requestId?: string;
}

export interface JobTableProps<T extends JobTableRow> {
  /** Name used in the select-all checkbox. */
  groupLabel: string;
  columns: readonly JobTableColumn[];
  rows: readonly T[];
  /** Pixel widths by column id; an absent entry means "let the browser decide". */
  columnWidths: Record<string, number>;
  selectable: boolean;
  selectedIds: readonly string[];
  onToggleRow: (id: string) => void;
  onToggleAll: (rows: readonly T[]) => void;
  /** Cell contents for one column, decided by the page. */
  renderCell: (row: T, column: JobTableColumn) => ReactNode;
  /**
   * An optional second line under one cell, used to explain why a row is here at
   * all (a search that matched data no column shows). It goes in `hintColumnId`
   * rather than its own row so the table keeps one row per job, and it lands in
   * the same place on the record cards a phone renders.
   */
  renderRowHint?: (row: T) => ReactNode;
  /** Column that carries the hint; the first column when unset. */
  hintColumnId?: string;
  resizer: JobTableResizer;
}

export function JobTable<T extends JobTableRow>({
  groupLabel,
  columns,
  rows,
  columnWidths,
  selectable,
  selectedIds,
  onToggleRow,
  onToggleAll,
  renderCell,
  renderRowHint,
  hintColumnId,
  resizer,
}: JobTableProps<T>) {
  const { t } = useLocale();
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  return (
    <>
      <colgroup>
        {selectable && <col style={{ width: '2.5rem' }} />}
        {columns.map((column) => (
          <col
            key={column.id}
            style={
              columnWidths[column.id] !== undefined
                ? { width: `${columnWidths[column.id]}px` }
                : undefined
            }
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          {selectable && (
            <DataHead>
              <Checkbox
                hideLabel
                label={formatMessage(t('control.jobs.selectAllGroup'), { group: groupLabel })}
                checked={allSelected}
                onChange={() => onToggleAll(rows)}
              />
            </DataHead>
          )}
          {columns.map((column, index) => (
            <DataHead key={column.id}>
              {column.kind === 'payload' ? <Mono size="label">{column.label}</Mono> : column.label}
              {index < columns.length - 1 && (
                <span
                  className="wcj-col-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={formatMessage(t('control.jobs.resizeColumn'), {
                    column: column.label,
                  })}
                  aria-valuemin={MIN_COLUMN_WIDTH}
                  aria-valuemax={MAX_COLUMN_WIDTH}
                  {...(columnWidths[column.id] !== undefined
                    ? { 'aria-valuenow': Math.round(columnWidths[column.id]) }
                    : {})}
                  title={t('control.jobs.resizeColumnHint')}
                  tabIndex={0}
                  onPointerDown={(event) => resizer.onStart(event, index)}
                  onPointerMove={resizer.onMove}
                  onPointerUp={resizer.onEnd}
                  onPointerCancel={resizer.onEnd}
                  onDoubleClick={() => resizer.onReset(column.id)}
                  onKeyDown={(event) => resizer.onNudge(event, index)}
                />
              )}
            </DataHead>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isSelected = selectedIds.includes(row.id);
          return (
            <tr key={row.id} className={isSelected ? 'is-selected' : undefined}>
              {selectable && (
                <DataCell label={t('control.jobs.colSelect')}>
                  <Checkbox
                    hideLabel
                    label={formatMessage(t('control.jobs.selectJobRow'), {
                      id: row.requestId ?? row.id,
                    })}
                    checked={isSelected}
                    onChange={() => onToggleRow(row.id)}
                  />
                </DataCell>
              )}
              {columns.map((column) => (
                <DataCell
                  key={column.id}
                  label={column.label}
                  actions={column.kind === 'builtin' && column.id === 'actions'}
                >
                  {renderCell(row, column)}
                  {/* The hint rides in one named cell: a cell of its own would
                      break the one-row-per-job structure and the card layout. */}
                  {renderRowHint && column.id === (hintColumnId ?? columns[0]?.id)
                    ? renderRowHint(row)
                    : null}
                </DataCell>
              ))}
            </tr>
          );
        })}
      </tbody>
    </>
  );
}
