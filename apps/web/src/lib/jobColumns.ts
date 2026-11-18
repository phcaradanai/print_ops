/**
 * Which columns the Incoming Jobs list shows.
 *
 * The redesigned list settled on Job, Destination, Status, Received, Actions.
 * Operators still need a couple of extra facts on some sites (copies, template,
 * source, runner, error code), so those become opt-in columns behind a picker
 * instead of being forced into every row.
 *
 * Two rules keep the list from becoming unrecognisable:
 *
 *   - **Job, Status and Actions are fixed.** A row without its identity, its
 *     verdict, or a way into the drawer is not a row; the picker never offers
 *     them and the render path always includes them.
 *   - **The order is canonical, not click order.** Toggling a column must not
 *     reshuffle the table under the operator's cursor.
 *
 * The choice is a workstation preference (like the locale), stored in
 * localStorage rather than the URL: it is not a filter, and a URL must never
 * imply one. A stored value is validated on read, so a renamed or removed column
 * in a future build falls back to the shipped default instead of rendering an
 * unknown cell.
 */

export type JobColumnId =
  | 'job'
  | 'destination'
  | 'station'
  | 'status'
  | 'received'
  | 'copies'
  | 'template'
  | 'source'
  | 'runner'
  | 'error'
  | 'actions';

/** Render order, left to right. Optional columns sit between Status and Actions. */
export const JOB_COLUMN_ORDER: readonly JobColumnId[] = [
  'job',
  'destination',
  'station',
  'status',
  'received',
  'copies',
  'template',
  'source',
  'runner',
  'error',
  'actions',
];

/** Always rendered, never offered in the picker. */
export const FIXED_JOB_COLUMNS: readonly JobColumnId[] = ['job', 'status', 'actions'];

export interface JobColumnOption {
  id: Exclude<JobColumnId, 'job' | 'status' | 'actions'>;
  /** i18n key for the picker label and the table header. */
  labelKey: string;
}

export const OPTIONAL_JOB_COLUMNS: readonly JobColumnOption[] = [
  { id: 'destination', labelKey: 'control.jobs.colDestination' },
  { id: 'station', labelKey: 'control.jobs.colStation' },
  { id: 'received', labelKey: 'control.jobs.colReceived' },
  { id: 'copies', labelKey: 'control.jobs.detailCopies' },
  { id: 'template', labelKey: 'control.jobs.detailTemplate' },
  { id: 'source', labelKey: 'control.jobs.detailSource' },
  { id: 'runner', labelKey: 'control.jobs.detailRunner' },
  { id: 'error', labelKey: 'control.jobs.detailErrorCode' },
];

/** The shipped look: destination + received, matching the four-question redesign. */
export const DEFAULT_JOB_COLUMNS: readonly Exclude<JobColumnId, 'job' | 'status' | 'actions'>[] =
  ['destination', 'received'];

export const JOB_COLUMNS_STORAGE_KEY = 'printops-control-jobs-columns';

type OptionalColumnId = JobColumnOption['id'];

const OPTIONAL_IDS: ReadonlySet<string> = new Set(OPTIONAL_JOB_COLUMNS.map((option) => option.id));

/** Known ids only, deduplicated, canonical order. */
export function normalizeJobColumns(input: readonly string[]): OptionalColumnId[] {
  const wanted = new Set(input.filter((id) => OPTIONAL_IDS.has(id)));
  return OPTIONAL_JOB_COLUMNS.map((option) => option.id).filter((id) => wanted.has(id));
}

/** The full render list for a selection: fixed columns plus the chosen ones. */
export function visibleJobColumns(selected: readonly JobColumnId[]): JobColumnId[] {
  const chosen = new Set(normalizeJobColumns(selected));
  return JOB_COLUMN_ORDER.filter(
    (id) => FIXED_JOB_COLUMNS.includes(id) || chosen.has(id as OptionalColumnId),
  );
}

export function parseStoredJobColumns(raw: string | null): OptionalColumnId[] {
  if (raw === null || raw === '') return [...DEFAULT_JOB_COLUMNS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_JOB_COLUMNS];
    return normalizeJobColumns(parsed.map((entry) => String(entry)));
  } catch {
    return [...DEFAULT_JOB_COLUMNS];
  }
}

export function serializeJobColumns(columns: readonly JobColumnId[]): string {
  return JSON.stringify(normalizeJobColumns(columns));
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readStoredJobColumns(storage: ReadableStorage | null = safeLocalStorage()): OptionalColumnId[] {
  if (!storage) return [...DEFAULT_JOB_COLUMNS];
  try {
    return parseStoredJobColumns(storage.getItem(JOB_COLUMNS_STORAGE_KEY));
  } catch {
    return [...DEFAULT_JOB_COLUMNS];
  }
}

export function writeStoredJobColumns(
  columns: readonly JobColumnId[],
  storage: WritableStorage | null = safeLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(JOB_COLUMNS_STORAGE_KEY, serializeJobColumns(columns));
  } catch {
    // A full or blocked localStorage must not break the list; the choice simply
    // does not survive the reload.
  }
}
