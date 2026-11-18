/**
 * Which columns the Incoming Jobs list shows.
 *
 * The redesigned list settled on Job, Destination, Status, Received, Actions.
 * Operators still need extra facts on some sites: job fields (copies, template,
 * source, runner, error code) and, above all, the values that arrived in the
 * incoming payload (`hn`, `patient_name`, ...). Both become opt-in columns
 * behind one picker instead of being forced into every row.
 *
 * Rules that keep the list recognisable:
 *
 *   - **Status and Actions are fixed.** A row without its verdict or a way into
 *     the drawer is not a row. The job reference is optional: operators who do
 *     not need it can drop the column and read the incoming values instead.
 *   - **Job fields keep a canonical order**, never click order, so toggling a
 *     built-in column cannot reshuffle the table.
 *   - **Incoming-value columns keep the order they were added**, sit after the
 *     job fields and before Actions, and are capped at three: a table is not a
 *     payload browser, and the drawer already shows every key.
 *   - **The selection is a workstation preference** (like the locale), stored in
 *     localStorage rather than the URL: it is presentation, not a filter. Stored
 *     values are validated on read, and a payload key that disappears from the
 *     feed stays selected (rendering em dashes) until the operator removes it.
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

export const PAYLOAD_COLUMN_PREFIX = 'payload:';
/** A dynamic column backed by one incoming payload key. */
export type PayloadColumnId = `${typeof PAYLOAD_COLUMN_PREFIX}${string}`;
export type JobColumnSelection = JobColumnId | PayloadColumnId;

/** Render order of the built-in columns. */
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
export const FIXED_JOB_COLUMNS: readonly JobColumnId[] = ['status', 'actions'];

export interface JobColumnOption {
  id: Exclude<JobColumnId, 'status' | 'actions'>;
  /** i18n key for the picker label and the table header. */
  labelKey: string;
}

export const OPTIONAL_JOB_COLUMNS: readonly JobColumnOption[] = [
  { id: 'job', labelKey: 'control.jobs.colJob' },
  { id: 'destination', labelKey: 'control.jobs.colDestination' },
  { id: 'station', labelKey: 'control.jobs.colStation' },
  { id: 'received', labelKey: 'control.jobs.colReceived' },
  { id: 'copies', labelKey: 'control.jobs.detailCopies' },
  { id: 'template', labelKey: 'control.jobs.detailTemplate' },
  { id: 'source', labelKey: 'control.jobs.detailSource' },
  { id: 'runner', labelKey: 'control.jobs.detailRunner' },
  { id: 'error', labelKey: 'control.jobs.detailErrorCode' },
];

/** The shipped look: reference + destination + received, matching the redesign. */
export const DEFAULT_JOB_COLUMNS: readonly Exclude<JobColumnId, 'status' | 'actions'>[] = [
  'job',
  'destination',
  'received',
];

/**
 * How many incoming-value columns a selection may hold.
 *
 * This used to be three, on the theory that a table is not a payload browser. In
 * practice a wide screen sat half empty while the operator could not add the
 * fourth value they needed, so the ceiling is now generous: it exists to stop an
 * accidental "select everything", not to ration space the page already has.
 * Nothing is persisted beyond this list either, so a large selection costs one
 * localStorage string, not a schema change.
 */
export const MAX_PAYLOAD_COLUMNS = 8;

export const JOB_COLUMNS_STORAGE_KEY = 'printops-control-jobs-columns';

type OptionalColumnId = JobColumnOption['id'];

const OPTIONAL_IDS: ReadonlySet<string> = new Set(OPTIONAL_JOB_COLUMNS.map((option) => option.id));

/** One rendered column: a built-in field or an incoming payload key. */
export type JobTableColumn =
  | { kind: 'builtin'; id: JobColumnId }
  | { kind: 'payload'; id: PayloadColumnId; key: string };

export function payloadColumnId(key: string): PayloadColumnId {
  return `${PAYLOAD_COLUMN_PREFIX}${key}`;
}

export function isPayloadColumnId(id: string): id is PayloadColumnId {
  return id.startsWith(PAYLOAD_COLUMN_PREFIX) && id.length > PAYLOAD_COLUMN_PREFIX.length;
}

export function payloadColumnKey(id: string): string {
  return isPayloadColumnId(id) ? id.slice(PAYLOAD_COLUMN_PREFIX.length) : id;
}

/**
 * Known built-in ids only (deduplicated, canonical order), followed by the
 * payload columns in the order they were chosen. Fixed ids are never part of a
 * selection: they are rendered unconditionally.
 */
export function normalizeJobColumns(input: readonly string[]): JobColumnSelection[] {
  const wanted = new Set<string>();
  const payloads: PayloadColumnId[] = [];

  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    if (isPayloadColumnId(raw)) {
      if (!wanted.has(raw)) {
        wanted.add(raw);
        payloads.push(raw);
      }
      continue;
    }
    if (OPTIONAL_IDS.has(raw)) wanted.add(raw);
  }

  const builtins = OPTIONAL_JOB_COLUMNS.map((option) => option.id).filter((id) =>
    wanted.has(id),
  );
  return [...builtins, ...payloads];
}

/** The full render list for a selection: fixed columns, chosen fields, payload, actions. */
export function visibleJobColumns(selected: readonly string[]): JobTableColumn[] {
  const normalized = normalizeJobColumns(selected);
  const chosen = new Set(normalized.filter((id) => !isPayloadColumnId(id)));

  const builtins: JobTableColumn[] = JOB_COLUMN_ORDER.filter(
    (id) => FIXED_JOB_COLUMNS.includes(id) || chosen.has(id as OptionalColumnId),
  ).map((id) => ({ kind: 'builtin', id }));

  const payloads: JobTableColumn[] = normalized
    .filter(isPayloadColumnId)
    .slice(0, MAX_PAYLOAD_COLUMNS)
    .map((id) => ({ kind: 'payload', id, key: payloadColumnKey(id) }));

  const actionsIndex = builtins.findIndex((column) => column.id === 'actions');
  if (actionsIndex < 0) return [...builtins, ...payloads];
  return [...builtins.slice(0, actionsIndex), ...payloads, ...builtins.slice(actionsIndex)];
}

export function parseStoredJobColumns(raw: string | null): JobColumnSelection[] {
  if (raw === null || raw === '') return [...DEFAULT_JOB_COLUMNS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_JOB_COLUMNS];
    return normalizeJobColumns(parsed.map((entry) => String(entry)));
  } catch {
    return [...DEFAULT_JOB_COLUMNS];
  }
}

export function serializeJobColumns(columns: readonly string[]): string {
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

export function readStoredJobColumns(
  storage: ReadableStorage | null = safeLocalStorage(),
): JobColumnSelection[] {
  if (!storage) return [...DEFAULT_JOB_COLUMNS];
  try {
    return parseStoredJobColumns(storage.getItem(JOB_COLUMNS_STORAGE_KEY));
  } catch {
    return [...DEFAULT_JOB_COLUMNS];
  }
}

export function writeStoredJobColumns(
  columns: readonly string[],
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
