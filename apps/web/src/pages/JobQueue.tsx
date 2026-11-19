import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { JOB_STATUSES, type JobStatus } from '@printerops/domain';
import { apiDownload, apiFetch } from '../api/client.js';
import { errorMessage } from '../api/errors.js';
import { useHasPermission } from '../api/session.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { formatCreatedAt } from '../lib/formatCreatedAt.js';
import { formatMessage as formatMsg } from '../lib/formatMessage.js';
import { jobNeedsAttention } from '../lib/jobQueueView.js';
import { getJobVerdict, offersReprint, verdictHeadlineKey } from '../lib/jobVerdict.js';
import {
  collectPayloadKeys,
  collectPayloadValueCounts,
  describeJobSearchMatches,
  extractJobPayload,
  filterAndGroupJobs,
  hiddenSearchMatches,
  type FilterableJob,
  type JobDatePreset,
  type JobGroupBy,
  type JobKeyFilter,
  type JobSearchMatch,
} from '../lib/jobPayload.js';
import {
  STATUS_BUCKET_LABEL_KEYS,
  countStatusBuckets,
  matchesStatusBucket,
  sortJobs,
  type JobSortMode,
  type StatusBucket,
} from '../lib/controlJobsView.js';
import {
  DEFAULT_JOB_COLUMNS,
  MAX_PAYLOAD_COLUMNS,
  isPayloadColumnId,
  jobColumnOptions,
  normalizeJobColumns,
  payloadColumnKey,
  readStoredJobColumns,
  visibleJobColumns,
  writeStoredJobColumns,
  type JobColumnId,
} from '../lib/jobColumns.js';
import {
  Alert,
  Button,
  CardDetail,
  CardDetailItem,
  Checkbox,
  Chip,
  DataTable,
  Dialog,
  EmptyState,
  ErrorBanner,
  ErrorState,
  FormField,
  Freshness,
  Grid,
  Inline,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Pagination,
  Panel,
  SearchField,
  Select,
  SelectFilter,
  Stack,
  StatusBadge,
  Text,
  Toolbar,
} from '../components/ui/index.js';

import { CinemaBoard } from '../features/cinema/CinemaBoard.js';
import { CinemaDisplayDialog } from '../features/cinema/CinemaDisplayDialog.js';
import {
  CINEMA_MAX_FIELDS,
  CINEMA_PANELS,
  describeCinemaFields,
  parseCinemaPanels,
  type CinemaPanel,
} from '../features/cinema/cinemaModel.js';
import { JobColumnsDialog } from '../features/job-list/JobColumnsDialog.js';
import { JobDetailDrawer } from '../features/job-list/JobDetailDrawer.js';
import {
  JobTable,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type JobTableColumn as JobTableView,
  type JobTableResizer,
} from '../features/job-list/JobTable.js';
import { SelectionBar } from '../features/job-list/SelectionBar.js';

/**
 * A station job, as the list endpoint returns it.
 *
 * Every field the shared list components read is on `FilterableJob`; this adds
 * the station payload the drawer and the opt-in columns use.
 */
export interface Job extends FilterableJob {
  copies: number;
  priorityLabel?: string;
  paperProfileId?: string;
  mimeType?: string;
  latency?: { totalLatencyMs?: number };
  completedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  runnerId?: string;
}

interface ReprintResult {
  originalJob: Job;
  createdJob?: Job;
  error?: string;
}

/** Queue cadence. Suspended while the window is hidden — see `lib/pollController.ts`. */
const QUEUE_POLL_MS = 1_500;
/** The feed is capped; past this the page says so instead of pretending to be complete. */
const QUEUE_FEED_LIMIT = 1_000;
/** Keep the DOM small even when the feed holds its full window. */
const QUEUE_PAGE_SIZE = 50;
const COLUMN_WIDTH_STEP = 16;

/**
 * The station is one scope, so the station column is withdrawn: every row is this
 * installation. Excluding it here (rather than only in the picker) also strips a
 * `station` value already stored by a visit to the Web Control page.
 */
const EXCLUDED_JOB_COLUMNS: readonly JobColumnId[] = ['station'];
const STATION_COLUMN_OPTIONS = jobColumnOptions(EXCLUDED_JOB_COLUMNS);

/** `?status=` values the dashboard's attention strip links here with. */
const NEEDS_ATTENTION_QUERY = 'NEEDS_ATTENTION';

const DATE_PRESETS: ReadonlyArray<{ value: JobDatePreset; key: string }> = [
  { value: 'all', key: 'control.jobs.datePresetAll' },
  { value: 'today', key: 'control.jobs.datePresetToday' },
  { value: '7d', key: 'control.jobs.datePreset7d' },
  { value: '30d', key: 'control.jobs.datePreset30d' },
];

/**
 * A single-station wall board has nothing to put in the stations panel, so the
 * board keeps the feed, the throughput and the ticker and drops that ladder.
 * `CinemaJob` still needs a device id; one synthetic id names the only station.
 */
const STATION_CINEMA_DEVICE_ID = 'local';
const CINEMA_PANEL_CHOICES: readonly CinemaPanel[] = CINEMA_PANELS.filter(
  (panel) => panel !== 'stations',
);

function readInitialStatusFilter(searchParams: URLSearchParams): JobStatus | 'ALL' {
  const requested = searchParams.get('status');
  return JOB_STATUSES.includes(requested as JobStatus) ? (requested as JobStatus) : 'ALL';
}

function readInitialStatusBucket(searchParams: URLSearchParams): StatusBucket {
  return searchParams.get('status') === NEEDS_ATTENTION_QUERY ? 'NEEDS_REVIEW' : 'ALL';
}

export default function JobQueue() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const canReprint = useHasPermission('job:retry');
  const [searchParams, setSearchParams] = useSearchParams();
  const advancedPanelId = useId();
  const valueListId = useId();

  const openJobFull = (jobId: string) => {
    if (!document.startViewTransition) {
      navigate(`/jobs/${jobId}`);
      return;
    }
    document.startViewTransition(() => {
      flushSync(() => {
        navigate(`/jobs/${jobId}`);
      });
    });
  };

  const fetchJobs = useCallback(
    () => apiFetch<Job[]>(`/jobs?limit=${QUEUE_FEED_LIMIT}`),
    [],
  );
  const queue = useApiResource(fetchJobs, { intervalMs: QUEUE_POLL_MS });
  const jobs = useMemo<Job[]>(() => queue.data ?? [], [queue.data]);

  // ---- filters and grouping -------------------------------------------------
  // `?status=` is the only filter the URL carries, because the dashboard links
  // here with one. Everything else is session state.
  const [jobSearch, setJobSearch] = useState('');
  const [statusBucket, setStatusBucket] = useState<StatusBucket>(() =>
    readInitialStatusBucket(searchParams),
  );
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'ALL'>(() =>
    readInitialStatusFilter(searchParams),
  );
  const [datePreset, setDatePreset] = useState<JobDatePreset>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<JobGroupBy>('none');
  const [keyFilters, setKeyFilters] = useState<JobKeyFilter[]>([]);
  const [pendingKey, setPendingKey] = useState('');
  const [pendingValue, setPendingValue] = useState('');
  const [searchTechnical, setSearchTechnical] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [jobSort, setJobSort] = useState<JobSortMode>('attention');

  // ---- list presentation ----------------------------------------------------
  const [jobColumns, setJobColumns] = useState<string[]>(() => readStoredJobColumns());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{
    id: string;
    nextId: string | null;
    startX: number;
    startWidth: number;
    nextStartWidth: number;
  } | null>(null);

  // ---- selection, drawer and dialogs ---------------------------------------
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null);
  const [selectionBarHeight, setSelectionBarHeight] = useState(0);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [reprintResults, setReprintResults] = useState<ReprintResult[] | null>(null);

  // The reprint dialog works on fully loaded jobs, never on list rows: the list
  // payload does not carry `runnerId`/`requestId`, and the submit refuses to send
  // a request it cannot prove is a deliberate additional physical copy.
  const [reprintTargets, setReprintTargets] = useState<Job[]>([]);
  const [reprintBusy, setReprintBusy] = useState(false);
  const [reprintCopies, setReprintCopies] = useState(1);
  const [reprintReason, setReprintReason] = useState('');
  const [reprintConfirmed, setReprintConfirmed] = useState(false);

  // ---- cinema ---------------------------------------------------------------
  const cinemaOpen = searchParams.get('cinema') === '1';
  const cinemaFields = useMemo(() => {
    const raw = searchParams.get('cinemaFields');
    if (raw === null) return [] as string[];
    return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  }, [searchParams]);
  const cinemaPanels = useMemo<CinemaPanel[]>(() => {
    const parsed = parseCinemaPanels(searchParams.get('cinemaPanels')).filter(
      (panel) => panel !== 'stations',
    );
    return parsed.length > 0 ? parsed : [...CINEMA_PANEL_CHOICES];
  }, [searchParams]);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [cinemaShowReference, setCinemaShowReference] = useState(true);
  const [cinemaLabelWidth, setCinemaLabelWidth] = useState<'narrow' | 'balanced' | 'wide'>(
    'balanced',
  );

  // ---- derived scope --------------------------------------------------------
  // The station's own jobs are the whole scope; the board reads the unfiltered
  // set so its totals describe the station, not the current filter.
  const cinemaJobs = useMemo(
    () => jobs.map((job) => ({ ...job, deviceId: STATION_CINEMA_DEVICE_ID })),
    [jobs],
  );
  const cinemaStations = useMemo(
    () => [
      {
        deviceId: STATION_CINEMA_DEVICE_ID,
        name: t('page.jobQueue.cinemaScope'),
        connectionState: 'ONLINE',
        jobs: cinemaJobs,
      },
    ],
    [cinemaJobs, t],
  );

  const availablePayloadKeys = useMemo(() => collectPayloadKeys(jobs), [jobs]);

  /** The incoming keys the scope carries, with the chosen ones first. */
  const cinemaFieldChoices = useMemo(() => {
    const described = describeCinemaFields(cinemaJobs);
    const byKey = new Map(described.map((option) => [option.key, option]));
    const selected = cinemaFields.map((key) => byKey.get(key) ?? { key, count: 0, sample: '' });
    const rest = described.filter((option) => !cinemaFields.includes(option.key));
    return [...selected, ...rest];
  }, [cinemaJobs, cinemaFields]);

  const incomingColumnChoices = useMemo(() => {
    const described = describeCinemaFields(cinemaJobs);
    const chosen = jobColumns.filter((id) => isPayloadColumnId(id)).map(payloadColumnKey);
    const byKey = new Map(described.map((option) => [option.key, option]));
    const selected = chosen.map((key) => byKey.get(key) ?? { key, count: 0, sample: '' });
    const rest = described.filter((option) => !chosen.includes(option.key));
    return [...selected, ...rest];
  }, [cinemaJobs, jobColumns]);

  // ---- filter pipeline ------------------------------------------------------
  // Search, `key = value`, dates and grouping are the shared pipeline, so these
  // rows mean the same thing they mean on the control plane. The status bucket is
  // deliberately applied afterwards: counts and rows must both derive from the
  // same base set, or a chip could promise rows the list will not show.
  const baseJobs = useMemo(
    () =>
      filterAndGroupJobs(jobs, {
        status: statusFilter,
        search: jobSearch,
        datePreset,
        dateFrom,
        dateTo,
        keyFilters,
        searchTechnical,
      }).filteredJobs,
    [jobs, jobSearch, datePreset, dateFrom, dateTo, keyFilters, searchTechnical, statusFilter],
  );

  const counts = useMemo(() => countStatusBuckets(baseJobs), [baseJobs]);
  const bucketCounts = useMemo<Record<StatusBucket, number>>(
    () => ({
      ALL: counts.all,
      NEEDS_REVIEW: counts.needsReview,
      IN_PROGRESS: counts.inProgress,
      PRINTED: counts.printed,
      OTHER: counts.other,
    }),
    [counts],
  );

  // `reviewed` is a control-plane acknowledgement; a station job never carries one.
  const visibleJobs = useMemo(
    () => baseJobs.filter((job) => matchesStatusBucket(job.status, statusBucket, false)),
    [baseJobs, statusBucket],
  );

  const sortedVisibleJobs = useMemo(() => sortJobs(visibleJobs, jobSort), [visibleJobs, jobSort]);

  const totalPages = Math.max(1, Math.ceil(sortedVisibleJobs.length / QUEUE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedVisibleJobs = useMemo(
    () =>
      sortedVisibleJobs.slice((currentPage - 1) * QUEUE_PAGE_SIZE, currentPage * QUEUE_PAGE_SIZE),
    [sortedVisibleJobs, currentPage],
  );

  const groupedJobs = useMemo(
    () =>
      filterAndGroupJobs(visibleJobs, {
        status: 'ALL',
        search: '',
        datePreset: 'all',
        dateFrom: '',
        dateTo: '',
        keyFilters: [],
        groupBy,
      }).groups.map((group) => ({ ...group, jobs: sortJobs(group.jobs, jobSort) })),
    [visibleJobs, groupBy, jobSort],
  );

  // Values offered for the key currently being edited: everything except that
  // key's own filter, so chained key filters stay useful.
  const jobsForValueSuggestions = useMemo(
    () =>
      filterAndGroupJobs(jobs, {
        status: 'ALL',
        search: jobSearch,
        datePreset,
        dateFrom,
        dateTo,
        keyFilters: keyFilters.filter((filter) => filter.key !== pendingKey),
        searchTechnical,
      }).filteredJobs,
    [jobs, jobSearch, datePreset, dateFrom, dateTo, keyFilters, pendingKey, searchTechnical],
  );

  const suggestedPayloadValueCounts = useMemo(
    () => collectPayloadValueCounts(jobsForValueSuggestions, pendingKey),
    [jobsForValueSuggestions, pendingKey],
  );

  // A filter or order change starts a new result set; a shrinking feed clamps an
  // already-open page instead of leaving it blank.
  useEffect(() => {
    setPage(1);
  }, [jobSearch, statusBucket, datePreset, dateFrom, dateTo, groupBy, keyFilters, jobSort, statusFilter]);

  useEffect(() => {
    setPage((previous) => Math.min(previous, totalPages));
  }, [totalPages]);

  // Selection is limited to what is currently visible, so the batch bar can never
  // reprint a row the operator filtered away.
  const visibleJobIdSet = useMemo(() => new Set(visibleJobs.map((job) => job.id)), [visibleJobs]);
  useEffect(() => {
    setSelectedJobIds((previous) => {
      const next = previous.filter((id) => visibleJobIdSet.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [visibleJobIdSet]);

  // The deep link must stay shareable and the filter must never be invisible: the
  // URL carries `status` alone, and an exact status also shows as a chip.
  useEffect(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (statusFilter !== 'ALL') next.set('status', statusFilter);
        else if (statusBucket === 'NEEDS_REVIEW') next.set('status', NEEDS_ATTENTION_QUERY);
        else next.delete('status');
        return next;
      },
      { replace: true },
    );
  }, [statusFilter, statusBucket, setSearchParams]);

  // ---- columns and widths ---------------------------------------------------
  const visibleColumns = useMemo(
    () => visibleJobColumns(jobColumns, EXCLUDED_JOB_COLUMNS),
    [jobColumns],
  );
  const visibleColumnIdSet = useMemo(
    () => new Set<string>(visibleColumns.map((column) => column.id)),
    [visibleColumns],
  );

  /**
   * Why a visible row is in the list. The search legitimately matches fields no
   * column shows, so a row can match a term the operator cannot see; naming the
   * field is the difference between a filter people trust and one they stop using.
   */
  const searchHints = useMemo(() => {
    const hints = new Map<string, JobSearchMatch[]>();
    if (jobSearch.trim() === '') return hints;
    for (const job of sortedVisibleJobs) {
      const hidden = hiddenSearchMatches(
        describeJobSearchMatches(job, jobSearch, { includeTechnical: searchTechnical }),
        visibleColumnIdSet,
      );
      if (hidden.length > 0) hints.set(job.id, hidden);
    }
    return hints;
  }, [sortedVisibleJobs, jobSearch, visibleColumnIdSet, searchTechnical]);

  const updateJobColumns = useCallback((next: string[]) => {
    const normalized = normalizeJobColumns(next).filter(
      (id) => !EXCLUDED_JOB_COLUMNS.includes(id as JobColumnId),
    );
    setJobColumns(normalized);
    writeStoredJobColumns(normalized);
  }, []);

  const toggleJobColumn = useCallback(
    (id: string) => {
      if (jobColumns.includes(id)) {
        updateJobColumns(jobColumns.filter((entry) => entry !== id));
        return;
      }
      // The payload-column cap is enforced here as well as in the dialog, so a
      // stale checkbox state can never overfill the table.
      if (
        isPayloadColumnId(id) &&
        jobColumns.filter((entry) => isPayloadColumnId(entry)).length >= MAX_PAYLOAD_COLUMNS
      ) {
        return;
      }
      updateJobColumns([...jobColumns, id]);
    },
    [jobColumns, updateJobColumns],
  );

  const resetColumnWidth = useCallback((id: string) => {
    setColumnWidths((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }, []);

  /** Measure the header cells so a drag starts from what is actually on screen. */
  const measureColumns = useCallback(
    (table: HTMLTableElement | null): Record<string, number> => {
      const measured: Record<string, number> = {};
      const cells = Array.from(table?.querySelectorAll<HTMLElement>('thead th') ?? []);
      const offset = canReprint ? 1 : 0;
      visibleColumns.forEach((column, index) => {
        const cell = cells[offset + index];
        if (cell) measured[column.id] = Math.round(cell.getBoundingClientRect().width);
      });
      return measured;
    },
    [canReprint, visibleColumns],
  );

  /**
   * Apply a width to one column and take the difference from its right neighbour,
   * so the table keeps its total width instead of overflowing.
   */
  const applyColumnWidth = useCallback(
    (id: string, nextId: string | null, width: number, startWidth: number, startNextWidth: number) => {
      if (nextId === null) {
        setColumnWidths((previous) => ({
          ...previous,
          [id]: Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width))),
        }));
        return;
      }
      const maxWidth = Math.round(startWidth + startNextWidth - MIN_COLUMN_WIDTH);
      const clamped = Math.max(MIN_COLUMN_WIDTH, Math.min(width, maxWidth, MAX_COLUMN_WIDTH));
      const nextWidth = Math.round(startWidth + startNextWidth - clamped);
      setColumnWidths((previous) => ({ ...previous, [id]: clamped, [nextId]: nextWidth }));
    },
    [],
  );

  const beginColumnResize = (event: ReactPointerEvent<HTMLSpanElement>, index: number) => {
    const column = visibleColumns[index];
    if (!column) return;
    const seeded = measureColumns(event.currentTarget.closest('table'));
    const nextColumn = visibleColumns[index + 1] ?? null;
    resizeRef.current = {
      id: column.id,
      nextId: nextColumn?.id ?? null,
      startX: event.clientX,
      startWidth: seeded[column.id] ?? 120,
      nextStartWidth: nextColumn ? seeded[nextColumn.id] ?? 120 : 0,
    };
    setColumnWidths(seeded);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveColumnResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const state = resizeRef.current;
    if (!state) return;
    applyColumnWidth(
      state.id,
      state.nextId,
      state.startWidth + (event.clientX - state.startX),
      state.startWidth,
      state.nextStartWidth,
    );
  };

  const endColumnResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const nudgeColumn = (event: ReactKeyboardEvent<HTMLSpanElement>, index: number) => {
    const column = visibleColumns[index];
    if (!column) return;
    if (event.key === 'Home' || event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      resetColumnWidth(column.id);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const seeded = measureColumns(event.currentTarget.closest('table'));
    const current = seeded[column.id] ?? 120;
    const nextColumn = visibleColumns[index + 1] ?? null;
    const nextCurrent = nextColumn ? seeded[nextColumn.id] ?? 120 : 0;
    setColumnWidths(seeded);
    applyColumnWidth(
      column.id,
      nextColumn?.id ?? null,
      current + (event.key === 'ArrowLeft' ? -COLUMN_WIDTH_STEP : COLUMN_WIDTH_STEP),
      current,
      nextCurrent,
    );
  };

  // ---- filter controls ------------------------------------------------------
  const selectStatusBucket = useCallback((bucket: StatusBucket) => {
    setStatusBucket((previous) => (previous === bucket ? 'ALL' : bucket));
  }, []);

  const handleDatePreset = (next: JobDatePreset) => {
    setDatePreset(next);
    setDateFrom('');
    setDateTo('');
  };

  const handleAddKeyFilter = () => {
    const key = pendingKey.trim();
    const value = pendingValue.trim();
    if (!key || !value) return;
    setKeyFilters((previous) => [
      ...previous.filter((filter) => filter.key !== key),
      { key, value, exact: false },
    ]);
    setPendingValue('');
  };

  const handlePickPayloadValue = (value: string) => {
    if (!pendingKey || !value) return;
    setKeyFilters((previous) => [
      ...previous.filter((filter) => filter.key !== pendingKey),
      { key: pendingKey, value, exact: true },
    ]);
    setPendingValue('');
  };

  const clearAllFilters = useCallback(() => {
    setJobSearch('');
    setStatusBucket('ALL');
    setDatePreset('all');
    setDateFrom('');
    setDateTo('');
    setGroupBy('none');
    setKeyFilters([]);
    setPendingKey('');
    setPendingValue('');
    setSearchTechnical(true);
    setStatusFilter('ALL');
    setSelectedJobIds([]);
  }, []);

  // ---- selection ------------------------------------------------------------
  const canSelectRows = canReprint;
  const toggleJobSelection = useCallback((jobId: string) => {
    setSelectedJobIds((previous) =>
      previous.includes(jobId)
        ? previous.filter((id) => id !== jobId)
        : [...previous, jobId],
    );
  }, []);
  const toggleSelectionFor = useCallback((rows: readonly Job[]) => {
    setSelectedJobIds((previous) => {
      const allSelected = rows.length > 0 && rows.every((row) => previous.includes(row.id));
      if (allSelected) return previous.filter((id) => !rows.some((row) => row.id === id));
      const next = [...previous];
      for (const row of rows) if (!next.includes(row.id)) next.push(row.id);
      return next;
    });
  }, []);

  const selectedJobs = useMemo(
    () => jobs.filter((job) => selectedJobIds.includes(job.id)),
    [jobs, selectedJobIds],
  );
  const handleSelectionBarHeight = useCallback((height: number) => {
    setSelectionBarHeight(height);
  }, []);

  // ---- reprint --------------------------------------------------------------
  /**
   * Load the full job before opening the dialog. This is a safety step, not a
   * convenience: the list payload carries neither `runnerId` nor `requestId`.
   */
  const openReprintDialog = async (rows: Job[]) => {
    const eligible = rows.filter((job) => offersReprint(getJobVerdict(job.status)));
    if (eligible.length === 0) return;
    const loaded: Job[] = [];
    const failures: string[] = [];
    for (const row of eligible) {
      try {
        loaded.push(await apiFetch<Job>(`/jobs/${row.id}`));
      } catch (error) {
        failures.push(`${row.id.slice(0, 8)}: ${errorMessage(error)}`);
      }
    }
    if (failures.length > 0) {
      setMessage({ tone: 'error', text: `${t('page.jobQueue.reprintLoadFailed')} ${failures.join(' · ')}` });
    }
    if (loaded.length === 0) return;
    setReprintCopies(loaded[0]?.copies || 1);
    setReprintReason('');
    setReprintConfirmed(false);
    setReprintTargets(loaded);
  };

  const blockedTargets = useMemo(
    () => reprintTargets.filter((job) => !job.runnerId || !job.requestId),
    [reprintTargets],
  );
  const cautionTargets = useMemo(
    () =>
      reprintTargets.filter(
        (job) => offersReprint(getJobVerdict(job.status)) && getJobVerdict(job.status).reprint === 'caution',
      ),
    [reprintTargets],
  );

  const handleSubmitReprint = async () => {
    if (reprintTargets.length === 0) return;
    setReprintBusy(true);
    const results: ReprintResult[] = [];
    for (const job of reprintTargets) {
      if (!job.runnerId || !job.requestId) {
        results.push({ originalJob: job, error: t('page.jobQueue.batchReprintUnavailable') });
        continue;
      }
      try {
        const createdJob = await apiFetch<Job>(`/jobs/${job.id}/reprint`, {
          method: 'POST',
          body: JSON.stringify({
            printerId: job.printerId,
            copies: reprintCopies,
            reason: reprintReason,
            confirmedDuplicateRisk: reprintConfirmed,
          }),
        });
        results.push({ originalJob: job, createdJob });
      } catch (error) {
        results.push({ originalJob: job, error: errorMessage(error) });
      }
    }
    setReprintBusy(false);
    setReprintTargets([]);
    setReprintCopies(1);
    setReprintReason('');
    setReprintConfirmed(false);
    queue.refresh();
    if (results.length === 1) {
      const [only] = results;
      if (only?.createdJob) {
        setMessage({
          tone: 'ok',
          text: t('page.jobQueue.reprintSubmitted').replace('{id}', only.createdJob.id.slice(0, 8)),
        });
      } else {
        setMessage({
          tone: 'error',
          text: `${t('page.jobQueue.reprintFailed')} ${only?.error ?? ''}`.trim(),
        });
      }
      return;
    }
    setReprintResults(results);
  };

  // ---- cinema actions -------------------------------------------------------
  const setCinemaOpen = useCallback(
    (open: boolean) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (open) next.set('cinema', '1');
          else next.delete('cinema');
          return next;
        },
        { replace: !open },
      );
    },
    [setSearchParams],
  );
  const openCinema = useCallback(() => setCinemaOpen(true), [setCinemaOpen]);
  const closeCinema = useCallback(() => setCinemaOpen(false), [setCinemaOpen]);

  /** The toggle reads the URL inside the updater: two clicks in one tick must not each start from the old list. */
  const toggleCinemaField = useCallback(
    (key: string) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          const current = (params.get('cinemaFields') ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
          const next = current.includes(key)
            ? current.filter((entry) => entry !== key)
            : current.length < CINEMA_MAX_FIELDS
              ? [...current, key]
              : current;
          if (next.length > 0) params.set('cinemaFields', next.join(','));
          else params.delete('cinemaFields');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** The last remaining panel cannot be removed: an empty list reads as "the default board". */
  const toggleCinemaPanel = useCallback(
    (panel: CinemaPanel) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          const current = parseCinemaPanels(params.get('cinemaPanels')).filter(
            (entry) => entry !== 'stations',
          );
          const active = current.length > 0 ? current : [...CINEMA_PANEL_CHOICES];
          if (active.includes(panel) && active.length === 1) return params;
          const next = active.includes(panel)
            ? active.filter((entry) => entry !== panel)
            : CINEMA_PANEL_CHOICES.filter((entry) => entry === panel || active.includes(entry));
          if (next.length < CINEMA_PANEL_CHOICES.length) params.set('cinemaPanels', next.join(','));
          else params.delete('cinemaPanels');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setCinemaFields = useCallback(
    (next: string[]) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next.length > 0) params.set('cinemaFields', next.join(','));
          else params.delete('cinemaFields');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ---- render helpers -------------------------------------------------------
  const groupOptions = useMemo<Array<{ value: JobGroupBy; label: string }>>(() => {
    const options: Array<{ value: JobGroupBy; label: string }> = [
      { value: 'none', label: t('control.jobs.groupNone') },
      { value: 'date', label: t('control.jobs.groupDate') },
      { value: 'status', label: t('control.jobs.groupStatus') },
      { value: 'template', label: t('control.jobs.groupTemplate') },
      { value: 'printer', label: t('control.jobs.groupPrinter') },
      { value: 'source', label: t('control.jobs.groupSource') },
    ];
    for (const key of availablePayloadKeys) {
      options.push({
        value: `key:${key}`,
        label: formatMsg(t('control.jobs.groupKeyPrefix'), { key }),
      });
    }
    return options;
  }, [availablePayloadKeys, t]);

  const groupByLabel = groupOptions.find((option) => option.value === groupBy)?.label ?? '';
  const hasCustomDate = dateFrom !== '' || dateTo !== '';
  const hasDateCondition = hasCustomDate || datePreset !== 'all';
  const presetLabel = t(
    DATE_PRESETS.find((preset) => preset.value === datePreset)?.key ?? 'control.jobs.datePresetAll',
  );
  const dateConditionValue = hasCustomDate
    ? formatMsg(t('control.jobs.filterDateRange'), {
        from: dateFrom || t('control.jobs.datePresetAll'),
        to: dateTo || t('control.jobs.datePresetAll'),
      })
    : presetLabel;
  const advancedConditionCount =
    (hasCustomDate ? 1 : 0) +
    (groupBy !== 'none' ? 1 : 0) +
    (statusFilter !== 'ALL' ? 1 : 0) +
    (searchTechnical ? 0 : 1) +
    keyFilters.length;
  const advancedToggleLabel = advancedOpen
    ? t('control.jobs.hideAdvancedFilters')
    : advancedConditionCount > 0
      ? formatMsg(t('control.jobs.advancedFiltersWithCount'), { count: advancedConditionCount })
      : t('control.jobs.advancedFilters');

  const searchCondition = jobSearch.trim()
    ? formatMsg(t('control.jobs.filterSearch'), { value: jobSearch.trim() })
    : '';
  const bucketCondition =
    statusBucket === 'ALL'
      ? ''
      : formatMsg(t('control.jobs.filterStatus'), { value: t(STATUS_BUCKET_LABEL_KEYS[statusBucket]) });
  const dateCondition = hasDateCondition
    ? formatMsg(t('control.jobs.filterDate'), { value: dateConditionValue })
    : '';
  const groupCondition = groupBy !== 'none' ? formatMsg(t('control.jobs.filterGroup'), { value: groupByLabel }) : '';
  const statusFilterCondition =
    statusFilter !== 'ALL'
      ? formatMsg(t('control.jobs.filterExactStatus'), { value: statusFilter })
      : '';
  const technicalCondition = searchTechnical ? '' : t('control.jobs.filterNoTechnical');
  const keyConditions = keyFilters.map((filter) => ({
    key: filter.key,
    value: filter.value,
    label: formatMsg(t('control.jobs.filterKey'), { key: filter.key, value: filter.value }),
  }));
  const hasActiveConditions = Boolean(
    searchCondition ||
      bucketCondition ||
      dateCondition ||
      groupCondition ||
      statusFilterCondition ||
      technicalCondition ||
      keyConditions.length > 0,
  );
  const removeLabel = (condition: string) => formatMsg(t('control.jobs.removeFilter'), { filter: condition });

  const drawerJob = useMemo(() => jobs.find((job) => job.id === drawerJobId) ?? null, [jobs, drawerJobId]);
  const selectedCount = selectedJobIds.length;

  const jobColumnLabel = (id: JobColumnId): string => {
    switch (id) {
      case 'job':
        return t('control.jobs.colJob');
      case 'destination':
        return t('control.jobs.colDestination');
      case 'station':
        // Withdrawn on this page; kept so the switch stays exhaustive.
        return t('control.jobs.colStation');
      case 'status':
        return t('control.jobs.colStatus');
      case 'received':
        return t('control.jobs.colReceived');
      case 'copies':
        return t('control.jobs.detailCopies');
      case 'template':
        return t('control.jobs.detailTemplate');
      case 'source':
        return t('control.jobs.detailSource');
      case 'runner':
        return t('control.jobs.detailRunner');
      case 'error':
        return t('control.jobs.detailErrorCode');
      case 'actions':
        return t('control.jobs.colActions');
    }
  };

  const emptyCell = (
    <Text size="label" tone="muted">
      —
    </Text>
  );

  /** A matched value, short enough for a row: enough to recognise, not a dump. */
  const shorten = (value: string, max = 48): string =>
    value.length <= max ? value : `${value.slice(0, max - 1)}…`;

  /** How one hidden search hit is named, e.g. "Template · PATIENT_LABEL". */
  const formatSearchMatch = (match: JobSearchMatch): string => {
    const value = shorten(match.value);
    switch (match.field) {
      case 'incoming-key':
        return `${t('control.jobs.detailIncomingData')} · ${match.key ?? ''}`;
      case 'incoming-value':
        return `${t('control.jobs.detailIncomingData')} · ${match.key ?? ''} = ${value}`;
      case 'technical':
        return t('control.jobs.detailTechnical');
      case 'reference':
        return `${t('control.jobs.colJob')} · ${value}`;
      case 'status':
        return `${t('control.jobs.colStatus')} · ${value}`;
      case 'destination':
        return `${t('control.jobs.colDestination')} · ${value}`;
      case 'template':
        return `${t('control.jobs.detailTemplate')} · ${value}`;
      case 'source':
        return `${t('control.jobs.detailSource')} · ${value}`;
      case 'runner':
        return `${t('control.jobs.detailRunner')} · ${value}`;
      case 'error':
        return `${t('control.jobs.detailErrorCode')} · ${value}`;
      case 'station':
        return `${t('control.jobs.colStation')} · ${value}`;
    }
  };

  /** The per-row explanation. Two hits is the useful maximum. */
  const renderRowHint = (job: Job): ReactNode => {
    const matches = searchHints.get(job.id);
    if (!matches || matches.length === 0) return null;
    return (
      <Text size="label" tone="muted" wrap className="wcj-search-match">
        {formatMsg(t('control.jobs.searchMatchLabel'), {
          detail: matches.slice(0, 2).map(formatSearchMatch).join(' · '),
        })}
      </Text>
    );
  };

  /** The hint rides with the reference when it is on screen, else the first column. */
  const hintColumnId = visibleColumnIdSet.has('job') ? 'job' : visibleColumns[0]?.id;

  /**
   * One cell per visible column. The optional columns are the only place a job
   * value can be blank; they render an em dash rather than an empty cell so a
   * column never looks broken.
   */
  const renderJobCell = (job: Job, column: JobTableView): ReactNode => {
    if (column.kind === 'payload') {
      const payload = extractJobPayload(job);
      const lower = column.key.toLocaleLowerCase();
      const value =
        payload[column.key] ??
        Object.entries(payload).find(([key]) => key.toLocaleLowerCase() === lower)?.[1];
      return value ? (
        <Mono size="label" wrap className="wcj-payload-cell" title={value}>
          {value}
        </Mono>
      ) : (
        emptyCell
      );
    }
    switch (column.id) {
      case 'job':
        return (
          <Mono size="label" weight="semibold" wrap title={job.requestId || job.id}>
            {job.requestId || job.id}
          </Mono>
        );
      case 'destination':
        return (
          <Mono size="label" wrap>
            {job.printerCode || job.printerId}
          </Mono>
        );
      case 'station':
        return emptyCell;
      case 'status': {
        const verdict = getJobVerdict(job.status);
        return (
          <Stack gap="xs">
            <StatusBadge status={job.status} size="sm" />
            {jobNeedsAttention(job.status) && (
              <Text size="label" tone="muted" wrap>
                {t(verdictHeadlineKey(verdict))}
              </Text>
            )}
          </Stack>
        );
      }
      case 'received':
        return (
          <Text size="label" tone="muted" title={job.createdAt}>
            {formatCreatedAt(job.createdAt)}
          </Text>
        );
      case 'copies':
        return <Text size="label">{job.copies}</Text>;
      case 'template': {
        const template = job.resolvedTemplateCode || job.templateCode;
        return template ? (
          <Mono size="label" wrap>
            {template}
          </Mono>
        ) : (
          emptyCell
        );
      }
      case 'source':
        return job.sourceSystem ? (
          <Mono size="label" wrap>
            {job.sourceSystem}
          </Mono>
        ) : (
          emptyCell
        );
      case 'runner':
        return job.runnerId ? (
          <Mono size="label" wrap>
            {job.runnerId}
          </Mono>
        ) : (
          emptyCell
        );
      case 'error':
        return job.errorCode ? (
          <Text size="label" tone="danger" title={job.errorMessage}>
            {job.errorCode}
          </Text>
        ) : (
          emptyCell
        );
      case 'actions':
        return (
          <Button size="sm" variant="secondary" onClick={() => setDrawerJobId(job.id)}>
            {t('control.jobs.viewJob')}
          </Button>
        );
    }
  };

  const hasCustomWidths = Object.keys(columnWidths).length > 0;
  const tableClassName = `wcj-jobs-table${hasCustomWidths ? ' wcj-jobs-table--fixed' : ''}`;

  // `t` is a dependency because every label is localized: without it a locale
  // switch would keep the previous language in the table head.
  const columnViews = useMemo<JobTableView[]>(
    () =>
      visibleColumns.map((column) =>
        column.kind === 'payload'
          ? { id: column.id, kind: 'payload' as const, key: column.key, label: column.key }
          : { id: column.id, kind: 'builtin' as const, label: jobColumnLabel(column.id) },
      ),
    [visibleColumns, t],
  );

  const resizer: JobTableResizer = {
    onStart: beginColumnResize,
    onMove: moveColumnResize,
    onEnd: endColumnResize,
    onReset: resetColumnWidth,
    onNudge: nudgeColumn,
  };

  const renderTable = (rows: readonly Job[], groupLabel: string) => (
    <Panel padding="none">
      <DataTable label={groupLabel} className={tableClassName} responsive>
        <JobTable
          groupLabel={groupLabel}
          columns={columnViews}
          rows={rows}
          columnWidths={columnWidths}
          selectable={canSelectRows}
          selectedIds={selectedJobIds}
          onToggleRow={toggleJobSelection}
          onToggleAll={toggleSelectionFor}
          renderCell={renderJobCell}
          renderRowHint={renderRowHint}
          hintColumnId={hintColumnId}
          resizer={resizer}
        />
      </DataTable>
    </Panel>
  );

  return (
    <PageLayout
      density="compact"
      width="full"
      title={t('page.jobQueue.title')}
      description={t('page.jobQueue.subtitle')}
    >
      <Stack gap="lg">
        {/* The one thing an operator must read before reprinting. */}
        <Alert tone="warning">{t('page.jobQueue.physicalOutputWarning')}</Alert>

        {jobs.length >= QUEUE_FEED_LIMIT && (
          <Alert tone="warning" dismissLabel={t('error.dismiss')}>
            <Text weight="semibold">{t('page.jobQueue.truncatedTitle')}</Text>{' '}
            {t('page.jobQueue.truncatedDetail')}
          </Alert>
        )}

        {message && (
          <Alert
            tone={message.tone === 'ok' ? 'success' : 'error'}
            onDismiss={() => setMessage(null)}
            dismissLabel={t('error.dismiss')}
          >
            {message.text}
          </Alert>
        )}

        {/* Refresh failed but rows are still on screen: they are a snapshot. */}
        {queue.stale && queue.error != null && (
          <ErrorBanner error={queue.error} title={t('error.refresh.title')} onRetry={queue.refresh} />
        )}

        {queue.loading && queue.data == null ? (
          <LoadingState />
        ) : queue.error != null && queue.data == null ? (
          <ErrorState error={queue.error} title={t('page.jobQueue.loadFailed')} onRetry={queue.refresh} />
        ) : (
          <>
            {/* Scope bar: the page's only action row. No station selector: this is
                one station, and the description already says so. */}
            <Panel padding="md" aria-label={t('page.jobQueue.scopeBarLabel')}>
              <Inline gap="md">
                <Text size="label" tone="muted" nowrap>
                  {formatMsg(t('page.jobQueue.scopeCount'), { count: jobs.length })}
                </Text>
                <Freshness
                  lastSuccessAt={queue.lastSuccessAt}
                  stale={queue.stale}
                  refreshing={queue.refreshing}
                  paused={queue.paused}
                  onRefresh={queue.refresh}
                />
                <Button variant="secondary" onClick={() => apiDownload('/exports/jobs.csv', 'jobs.csv')}>
                  {t('page.jobQueue.exportCsv')}
                </Button>
                <Button variant="secondary" onClick={() => setColumnsOpen(true)}>
                  {t('control.jobs.columnsButton')}
                </Button>
                {/* Cinema controls configure the wall board, not this list. */}
                <div className="wcj-cinema-group" role="group" aria-label={t('control.cinema.groupLabel')}>
                  <Button variant="secondary" onClick={() => setFieldsOpen(true)}>
                    {t('control.cinema.fieldsButton')}
                  </Button>
                  <Button variant="secondary" onClick={openCinema}>
                    {t('control.cinema.enter')}
                  </Button>
                </div>
              </Inline>
            </Panel>

            {/* Status counts: the bucket is applied after the counts. */}
            <Toolbar label={t('control.jobs.countsLabel')}>
              {(['ALL', 'NEEDS_REVIEW', 'IN_PROGRESS', 'PRINTED'] as StatusBucket[]).map((bucket) => (
                <Chip
                  key={bucket}
                  selected={statusBucket === bucket}
                  onClick={() => selectStatusBucket(bucket)}
                >
                  {t(STATUS_BUCKET_LABEL_KEYS[bucket])} ({bucketCounts[bucket]})
                </Chip>
              ))}
              {bucketCounts.OTHER > 0 && (
                <Chip selected={statusBucket === 'OTHER'} onClick={() => selectStatusBucket('OTHER')}>
                  {t(STATUS_BUCKET_LABEL_KEYS.OTHER)} ({bucketCounts.OTHER})
                </Chip>
              )}
              {counts.needsReview > 0 && groupBy === 'none' && statusBucket === 'ALL' && jobSort === 'attention' && (
                <Text size="label" tone="muted">
                  {t('control.jobs.needsReviewFirstHint')}
                </Text>
              )}
            </Toolbar>

            {/* Sort, search and common dates. */}
            <Inline gap="sm">
              <SelectFilter
                hideLabel
                label={t('control.jobs.sortLabel')}
                value={jobSort}
                onValueChange={(value) => setJobSort(value as JobSortMode)}
              >
                <option value="attention">{t('control.jobs.sortAttention')}</option>
                <option value="newest">{t('control.jobs.sortNewest')}</option>
                <option value="oldest">{t('control.jobs.sortOldest')}</option>
              </SelectFilter>
              <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
                <SearchField
                  label={t('control.jobs.searchLabel')}
                  placeholder={t('control.jobs.searchPlaceholder')}
                  value={jobSearch}
                  onValueChange={setJobSearch}
                />
              </div>
              {DATE_PRESETS.map((preset) => (
                <Chip
                  key={preset.value}
                  selected={
                    !hasCustomDate && (preset.value === 'all' ? datePreset === 'all' : datePreset === preset.value)
                  }
                  onClick={() => handleDatePreset(preset.value)}
                >
                  {t(preset.key)}
                </Chip>
              ))}
              <Button
                variant="secondary"
                aria-expanded={advancedOpen}
                aria-controls={advancedPanelId}
                onClick={() => setAdvancedOpen((previous) => !previous)}
              >
                {advancedToggleLabel}
              </Button>
              {hasCustomWidths && (
                <Button variant="ghost" onClick={() => setColumnWidths({})}>
                  {t('control.jobs.widthsReset')}
                </Button>
              )}
            </Inline>

            {/* A search can match data the table is not showing. Saying so once,
                above the rows, keeps every such row from looking like a bug. */}
            {searchHints.size > 0 && (
              <Text size="label" tone="muted">
                {formatMsg(t('control.jobs.searchHiddenHint'), { count: searchHints.size })}
              </Text>
            )}

            {/* Advanced panel: custom dates, grouping and payload filters live only here. */}
            {advancedOpen && (
              <Panel
                id={advancedPanelId}
                tone="subtle"
                padding="md"
                title={t('control.jobs.advancedTitle')}
                description={t('control.jobs.advancedHint')}
              >
                <Stack gap="md">
                  <Grid columns={3} gap="md">
                    <FormField label={t('control.jobs.exactStatusLabel')}>
                      {(control) => (
                        <Select
                          {...control}
                          value={statusFilter}
                          onChange={(event) => setStatusFilter(event.target.value as JobStatus | 'ALL')}
                        >
                          <option value="ALL">{t('control.jobs.exactStatusAll')}</option>
                          {JOB_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                    <FormField label={t('control.jobs.dateFromLabel')}>
                      {(control) => (
                        <Input
                          {...control}
                          type="date"
                          value={dateFrom}
                          onChange={(event) => {
                            setDateFrom(event.target.value);
                            if (event.target.value) setDatePreset('all');
                          }}
                        />
                      )}
                    </FormField>
                    <FormField label={t('control.jobs.dateToLabel')}>
                      {(control) => (
                        <Input
                          {...control}
                          type="date"
                          value={dateTo}
                          onChange={(event) => {
                            setDateTo(event.target.value);
                            if (event.target.value) setDatePreset('all');
                          }}
                        />
                      )}
                    </FormField>
                    <FormField label={t('control.jobs.groupByLabel')}>
                      {(control) => (
                        <Select
                          {...control}
                          value={groupBy}
                          onChange={(event) => setGroupBy(event.target.value as JobGroupBy)}
                        >
                          {groupOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                  </Grid>

                  {/* The technical fields are worth searching for support, but they
                      are also what makes a short word match unrelated rows, so the
                      operator decides. */}
                  <Checkbox
                    label={t('control.jobs.searchTechnicalLabel')}
                    description={t('control.jobs.searchTechnicalHint')}
                    checked={searchTechnical}
                    onChange={(event) => setSearchTechnical(event.target.checked)}
                  />

                  {availablePayloadKeys.length > 0 && (
                    <>
                      <Grid columns={3} gap="md">
                        <FormField label={t('control.jobs.keyFilterKeyLabel')}>
                          {(control) => (
                            <Select
                              {...control}
                              value={pendingKey}
                              onChange={(event) => {
                                setPendingKey(event.target.value);
                                setPendingValue('');
                              }}
                            >
                              <option value="">{t('control.jobs.keyFilterKeyPlaceholder')}</option>
                              {availablePayloadKeys.map((key) => (
                                <option key={key} value={key}>
                                  {key}
                                </option>
                              ))}
                            </Select>
                          )}
                        </FormField>
                        <FormField label={t('control.jobs.keyFilterValueLabel')}>
                          {(control) => (
                            <Select
                              {...control}
                              value=""
                              disabled={!pendingKey || suggestedPayloadValueCounts.length === 0}
                              onChange={(event) => handlePickPayloadValue(event.target.value)}
                            >
                              <option value="">
                                {formatMsg(t('control.jobs.keyFilterPickValuePlaceholder'), {
                                  count: suggestedPayloadValueCounts.length,
                                })}
                              </option>
                              {suggestedPayloadValueCounts.map((entry) => (
                                <option key={entry.value} value={entry.value}>
                                  {entry.value} ({entry.count})
                                </option>
                              ))}
                            </Select>
                          )}
                        </FormField>
                        <FormField label={t('control.jobs.keyFilterValueLabel')}>
                          {(control) => (
                            <>
                              <Input
                                {...control}
                                list={valueListId}
                                placeholder={t('control.jobs.keyFilterValuePlaceholder')}
                                value={pendingValue}
                                disabled={!pendingKey}
                                onChange={(event) => setPendingValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    handleAddKeyFilter();
                                  }
                                }}
                              />
                              <datalist id={valueListId}>
                                {suggestedPayloadValueCounts.map((entry) => (
                                  <option key={entry.value} value={entry.value} />
                                ))}
                              </datalist>
                            </>
                          )}
                        </FormField>
                      </Grid>
                      <Inline gap="sm">
                        <Button
                          variant="secondary"
                          disabled={!pendingKey || !pendingValue.trim()}
                          onClick={handleAddKeyFilter}
                        >
                          {t('control.jobs.addKeyFilter')}
                        </Button>
                      </Inline>
                    </>
                  )}
                </Stack>
              </Panel>
            )}

            {/* Every active condition is visible and removable on its own. */}
            {hasActiveConditions && (
              <Toolbar label={t('control.jobs.activeFiltersLabel')}>
                <Text size="label" tone="muted">
                  {t('control.jobs.activeFiltersLabel')}
                </Text>
                {searchCondition && (
                  <Chip aria-label={removeLabel(searchCondition)} onClick={() => setJobSearch('')}>
                    {searchCondition}
                    <span aria-hidden="true">{' ×'}</span>
                  </Chip>
                )}
                {bucketCondition && (
                  <Chip aria-label={removeLabel(bucketCondition)} onClick={() => setStatusBucket('ALL')}>
                    {bucketCondition}
                    <span aria-hidden="true">{' ×'}</span>
                  </Chip>
                )}
                {statusFilterCondition && (
                  <Chip aria-label={removeLabel(statusFilterCondition)} onClick={() => setStatusFilter('ALL')}>
                    {statusFilterCondition}
                    <span aria-hidden="true">{' ×'}</span>
                  </Chip>
                )}
                {dateCondition && (
                  <Chip
                    aria-label={removeLabel(dateCondition)}
                    onClick={() => {
                      setDatePreset('all');
                      setDateFrom('');
                      setDateTo('');
                    }}
                  >
                    {dateCondition}
                    <span aria-hidden="true">{' ×'}</span>
                  </Chip>
                )}
                {groupCondition && (
                  <Chip aria-label={removeLabel(groupCondition)} onClick={() => setGroupBy('none')}>
                    {groupCondition}
                    <span aria-hidden="true">{' ×'}</span>
                  </Chip>
                )}
                {technicalCondition && (
                  <Chip aria-label={removeLabel(technicalCondition)} onClick={() => setSearchTechnical(true)}>
                    {technicalCondition}
                    <span aria-hidden="true">{' ×'}</span>
                  </Chip>
                )}
                {keyConditions.map((condition) => (
                  <Chip
                    key={`key:${condition.key}`}
                    aria-label={removeLabel(condition.label)}
                    onClick={() =>
                      setKeyFilters((previous) =>
                        previous.filter(
                          (filter) => !(filter.key === condition.key && filter.value === condition.value),
                        ),
                      )
                    }
                  >
                    {condition.label}
                    <span aria-hidden="true">{' ×'}</span>
                  </Chip>
                ))}
                <Button size="sm" variant="ghost" onClick={clearAllFilters}>
                  {t('control.jobs.clearAllFilters')}
                </Button>
              </Toolbar>
            )}

            {/* Batch bar: pinned to the viewport bottom so a selection is never
                invisible, and never offered without `job:retry`. */}
            {canSelectRows && selectedCount > 0 && (
              <SelectionBar
                selectedCount={selectedCount}
                onClear={() => setSelectedJobIds([])}
                onReprint={() => void openReprintDialog(selectedJobs)}
                onHeightChange={handleSelectionBarHeight}
              />
            )}

            {sortedVisibleJobs.length === 0 ? (
              jobs.length === 0 ? (
                <EmptyState
                  title={t('control.jobs.emptyNoJobsTitle')}
                  hint={t('page.jobQueue.emptyNoJobsHint')}
                />
              ) : (
                <EmptyState
                  title={t('control.jobs.emptyNoMatchTitle')}
                  hint={t('control.jobs.emptyNoMatchHint')}
                  action={
                    <Button variant="secondary" onClick={clearAllFilters}>
                      {t('control.jobs.clearAllFilters')}
                    </Button>
                  }
                />
              )
            ) : groupBy === 'none' ? (
              <Stack gap="sm">
                {renderTable(pagedVisibleJobs, t('page.jobQueue.tableLabel'))}
                {totalPages > 1 && (
                  <Pagination
                    ariaLabel={t('page.jobQueue.pagination')}
                    page={currentPage}
                    totalPages={totalPages}
                    previousLabel={t('page.jobQueue.previous')}
                    nextLabel={t('page.jobQueue.next')}
                    status={formatMsg(t('page.jobQueue.pageOf'), {
                      page: currentPage,
                      total: totalPages,
                    })}
                    onPrevious={() => setPage(Math.max(1, currentPage - 1))}
                    onNext={() => setPage(Math.min(totalPages, currentPage + 1))}
                  />
                )}
              </Stack>
            ) : (
              <Stack gap="lg">
                {groupedJobs.map((group) => (
                  <Stack key={group.groupKey} gap="xs">
                    <Inline gap="sm">
                      <Text weight="semibold" wrap>
                        {group.groupLabel}
                      </Text>
                      <Text size="label" tone="muted">
                        {formatMsg(t('control.jobs.groupSummary'), { total: group.totalCount })}
                      </Text>
                    </Inline>
                    {renderTable(group.jobs, group.groupLabel)}
                  </Stack>
                ))}
              </Stack>
            )}
          </>
        )}

        {canSelectRows && selectedCount > 0 && (
          <div
            className="wcj-selection-spacer"
            aria-hidden="true"
            // Measured, not tokenised: the bar's height is a runtime fact (how many
            // actions wrapped), and this is the space it must not cover.
            style={selectionBarHeight > 0 ? { height: `${Math.ceil(selectionBarHeight + 8)}px` } : undefined}
          />
        )}
      </Stack>

      {/* Job summary drawer: short answer first, evidence collapsed. Reviewing an
          outcome is a control-plane act, so `canReview` stays off here. */}
      <JobDetailDrawer<Job>
        job={drawerJob}
        canReprint={canReprint}
        canReview={false}
        onClose={() => setDrawerJobId(null)}
        onReprint={(job) => {
          setDrawerJobId(null);
          void openReprintDialog([job]);
        }}
        onOpenFullDetail={() => {
          const job = drawerJob;
          setDrawerJobId(null);
          if (job) openJobFull(job.id);
        }}
      />

      {/* Reprint confirmation: never one click, and never on a job the list could
          not prove is safe to re-send. */}
      <Dialog
        open={reprintTargets.length > 0}
        onClose={() => setReprintTargets([])}
        title={
          reprintTargets.length === 1
            ? t('page.jobQueue.reprintTitle')
            : formatMsg(t('page.jobQueue.batchReprintTitle'), { count: reprintTargets.length })
        }
        closeLabel={t('common.close')}
        warning={t('page.jobQueue.reprintWarning')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReprintTargets([])}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              busy={reprintBusy}
              busyLabel={t('page.jobQueue.reprintSubmitting')}
              disabled={
                !reprintConfirmed ||
                !reprintReason.trim() ||
                blockedTargets.length > 0 ||
                reprintTargets.length === 0
              }
              onClick={() => void handleSubmitReprint()}
            >
              {t('page.jobQueue.reprintConfirm')}
            </Button>
          </>
        }
      >
        <Stack gap="md">
          {/* One job needs no preamble: the fields below already say what is about
              to happen. A batch does, because one click would re-send all of them. */}
          {reprintTargets.length > 1 && (
            <Text as="p">
              {formatMsg(t('page.jobQueue.batchReprintIntro'), { count: reprintTargets.length })}
            </Text>
          )}

          {/* Caution jobs may already be on paper. They stay in their own labelled
              region so a bulk acknowledgement is never given to them by accident. */}
          {cautionTargets.length > 0 && (
            <Alert tone="warning" title={t('page.jobQueue.batchCautionTitle')}>
              <Stack gap="sm">
                <Text>{t('page.jobQueue.batchCautionDetail')}</Text>
                <ul className="batch-reprint-jobs">
                  {cautionTargets.map((job) => (
                    <li key={job.id}>
                      <StatusBadge status={job.status} size="sm" />
                      <Text>{job.printerCode ?? job.printerId}</Text>
                      <Text tone="muted">
                        {formatMsg(t('page.jobQueue.batchCopies'), { count: job.copies })}
                      </Text>
                    </li>
                  ))}
                </ul>
              </Stack>
            </Alert>
          )}

          {/* Both ids are required to prove this is a deliberate second physical
              copy. A row that cannot supply them blocks the submit. */}
          <CardDetail>
            {reprintTargets.map((job) => (
              <CardDetailItem key={job.id} label={t('page.jobQueue.reprintOriginalJobId')}>
                <Stack gap="xs">
                  <Inline gap="sm">
                    <Mono>{job.id.slice(0, 8)}</Mono>
                    <StatusBadge status={job.status} size="sm" />
                    <Text tone="muted">{job.printerCode ?? job.printerId}</Text>
                  </Inline>
                  <Text size="label" tone="muted" wrap>
                    {t('page.jobQueue.reprintOriginalRequestId')}:{' '}
                    {job.requestId ?? t('page.jobQueue.reprintBlockedMissing')} ·{' '}
                    {t('page.jobQueue.reprintRunner')}:{' '}
                    {job.runnerId ?? t('page.jobQueue.reprintBlockedUnknown')}
                  </Text>
                </Stack>
              </CardDetailItem>
            ))}
          </CardDetail>

          {blockedTargets.length > 0 && (
            <Alert tone="error">
              <Text size="label" wrap>
                {formatMsg(t('page.jobQueue.reprintBlockedHint'), {
                  count: blockedTargets.length,
                })}
              </Text>
            </Alert>
          )}

          {/* A reprint creates a new job; it never replays the original's callback,
              so the integration that sent it will not hear about this copy. */}
          <Text size="label" tone="muted" wrap>
            {t('page.jobQueue.reprintCallbackNote')}
          </Text>

          <FormField label={t('page.jobQueue.reprintCopies')}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={20}
                value={reprintCopies}
                onChange={(event) => setReprintCopies(Number(event.target.value) || 1)}
              />
            )}
          </FormField>

          <FormField label={t('page.jobQueue.reprintReason')} required requiredLabel={t('common.required')}>
            {(control) => (
              <Input
                {...control}
                value={reprintReason}
                placeholder={t('page.jobQueue.batchReasonPlaceholder')}
                onChange={(event) => setReprintReason(event.target.value)}
              />
            )}
          </FormField>

          <Checkbox
            label={
              reprintTargets.length === 1
                ? t('page.jobQueue.reprintAcknowledge')
                : formatMsg(t('page.jobQueue.batchAcknowledge'), { count: reprintTargets.length })
            }
            checked={reprintConfirmed}
            onChange={(event) => setReprintConfirmed(event.target.checked)}
          />
        </Stack>
      </Dialog>

      {reprintResults && (
        <Alert
          tone={reprintResults.every((result) => result.createdJob) ? 'success' : 'error'}
          onDismiss={() => setReprintResults(null)}
          dismissLabel={t('error.dismiss')}
        >
          <Text as="p" weight="semibold">
            {t('page.jobQueue.batchResultsTitle')}
          </Text>
          <ul className="batch-result-list">
            {reprintResults.map((result) => (
              <li key={result.originalJob.id}>
                <Mono>{result.originalJob.id.slice(0, 8)}</Mono>{' '}
                {result.createdJob ? (
                  <Text>{formatMsg(t('page.jobQueue.batchResultCreated'), { id: result.createdJob.id.slice(0, 8) })}</Text>
                ) : (
                  <Text tone="danger">
                    {formatMsg(t('page.jobQueue.batchResultFailed'), {
                      error: result.error ?? t('common.error'),
                    })}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <JobColumnsDialog
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        columns={jobColumns}
        options={STATION_COLUMN_OPTIONS}
        incomingChoices={incomingColumnChoices}
        onToggle={toggleJobColumn}
        onReset={() => updateJobColumns([...DEFAULT_JOB_COLUMNS])}
      />

      <CinemaDisplayDialog
        open={fieldsOpen}
        onClose={() => setFieldsOpen(false)}
        fields={cinemaFields}
        fieldChoices={cinemaFieldChoices}
        showReference={cinemaShowReference}
        onShowReferenceChange={setCinemaShowReference}
        labelWidth={cinemaLabelWidth}
        onLabelWidthChange={setCinemaLabelWidth}
        panels={cinemaPanels}
        panelChoices={CINEMA_PANEL_CHOICES}
        onToggleField={toggleCinemaField}
        onClearFields={() => setCinemaFields([])}
        onTogglePanel={toggleCinemaPanel}
        maxFields={CINEMA_MAX_FIELDS}
      />

      {cinemaOpen && (
        <CinemaBoard
          stations={cinemaStations}
          jobs={cinemaJobs}
          displayFields={cinemaFields}
          showReference={cinemaShowReference}
          labelWidth={cinemaLabelWidth}
          scopeLabel={t('page.jobQueue.cinemaScope')}
          lastSuccessAt={queue.lastSuccessAt}
          panels={cinemaPanels}
          loading={queue.loading && queue.data == null}
          refreshing={queue.refreshing}
          stale={queue.stale}
          failed={queue.error != null}
          onExit={closeCinema}
        />
      )}
    </PageLayout>
  );
}
