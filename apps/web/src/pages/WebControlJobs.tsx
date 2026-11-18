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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useHasPermission } from '../api/session.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { formatCreatedAt } from '../lib/formatCreatedAt.js';
import { formatMessage } from '../lib/formatMessage.js';
import { jobNeedsAttention } from '../lib/jobQueueView.js';
import {
  getJobVerdict,
  offersReprint,
  REPORTED_COMPLETE_COPY,
  reprintButtonVariant,
  verdictDetailKey,
  verdictHeadlineKey,
} from '../lib/jobVerdict.js';
import {
  collectPayloadKeys,
  collectPayloadValueCounts,
  extractJobPayload,
  filterAndGroupJobs,
  type FilterableJob,
  type JobDatePreset,
  type JobGroupBy,
  type JobKeyFilter,
} from '../lib/jobPayload.js';
import {
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
  normalizeJobColumns,
  payloadColumnKey,
  readStoredJobColumns,
  visibleJobColumns,
  writeStoredJobColumns,
  type JobColumnId,
  type JobTableColumn,
} from '../lib/jobColumns.js';
import {
  Alert,
  Button,
  CardDetail,
  CardDetailItem,
  Checkbox,
  Chip,
  CodeBlock,
  CollapsibleSection,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  Drawer,
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
  StatusIndicator,
  Text,
  Toolbar,
  type StatusTone,
} from '../components/ui/index.js';

import './WebControlJobs.css';
import { CinemaBoard } from '../features/control-jobs/CinemaBoard.js';
import { CinemaDisplayDialog } from '../features/control-jobs/CinemaDisplayDialog.js';
import { JobColumnsDialog } from '../features/control-jobs/JobColumnsDialog.js';
import {
  CINEMA_PANELS,
  describeCinemaFields,
  parseCinemaPanels,
  type CinemaPanel,
} from '../features/control-jobs/cinemaModel.js';

export interface ControlSyncedJobItem extends FilterableJob {
  deviceId: string;
  paperProfileId?: string;
  copies: number;
  priorityLabel?: string;
  runnerId?: string;
  completedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  latencyMs?: number;
  reprintOfJobId?: string;
  reprintOfRequestId?: string;
  reprintReason?: string;
  /** Control-plane acknowledgement: checked by an operator, status unchanged. */
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface ControlStationErrorBreakdown {
  deviceId: string;
  deviceName: string;
  errorCode: string;
  errorMessage?: string;
  count: number;
  latestAt: string;
}

export interface ControlStationStats {
  totalJobs: number;
  queuedJobs: number;
  successJobs: number;
  attentionJobs: number;
  failedJobs: number;
  lastJobAt: string | null;
  latestError: {
    jobId: string;
    status: string;
    errorCode?: string;
    errorMessage?: string;
    occurredAt: string;
  } | null;
}

export interface ControlStationItem {
  deviceId: string;
  installationId: string;
  siteId: string;
  displayName?: string;
  hostname: string;
  platform: string;
  /** Installed PrintOps application semver, straight from `DeviceRecord.appVersion`. */
  appVersion: string;
  /** Release the control plane recommends for this device; `null` when none. */
  latestCompatibleVersion?: string | null;
  hasUpdateAvailable?: boolean;
  connectionState: string;
  lastSeenAt: string;
  ipAddresses?: string[];
  stats: ControlStationStats;
  payloadKeys: string[];
  jobs: ControlSyncedJobItem[];
}

export interface ControlJobsFleetResponse {
  syncedAt: string;
  summary: {
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    totalJobs: number;
    queuedJobs: number;
    successJobs: number;
    attentionJobs: number;
    failedJobs: number;
    errorBreakdown: ControlStationErrorBreakdown[];
  };
  devices: ControlStationItem[];
}

type NoticeTone = 'success' | 'error' | 'warning';

const DATE_PRESETS: ReadonlyArray<{ value: JobDatePreset; key: string }> = [
  { value: 'all', key: 'control.jobs.datePresetAll' },
  { value: 'today', key: 'control.jobs.datePresetToday' },
  { value: '7d', key: 'control.jobs.datePreset7d' },
  { value: '30d', key: 'control.jobs.datePreset30d' },
];

/** Keep the DOM small even when a station mirrors its full 1,000-job window. */
const JOB_PAGE_SIZE = 50;

/** Cinema rows stay readable on a wall display: three values is the ceiling. */
const CINEMA_MAX_FIELDS = 3;

/** Column resizing: the table keeps its total width, so a column can only grow
 *  by taking space from its right neighbour. Session-only by design - the
 *  operator arranges the table and sees the result immediately. */
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 720;
const COLUMN_WIDTH_STEP = 16;

function formatMsg(template: string, vars: Record<string, string | number>): string {
  return formatMessage(template, vars);
}

function stationTitle(device: { displayName?: string; hostname: string; deviceId: string }): string {
  return device.displayName?.trim() || device.hostname || device.deviceId;
}

function statusBucketLabel(t: (key: string) => string, bucket: StatusBucket): string {
  switch (bucket) {
    case 'NEEDS_REVIEW':
      return t('control.jobs.countNeedsReview');
    case 'IN_PROGRESS':
      return t('control.jobs.countInProgress');
    case 'PRINTED':
      return t('control.jobs.countPrinted');
    case 'OTHER':
      return t('control.jobs.countOther');
    case 'ALL':
    default:
      return t('control.jobs.countAll');
  }
}

/**
 * `navigator.clipboard` with the textarea fallback the rest of the app uses.
 * Resolves `false` instead of throwing so a copy can never break the drawer.
 */
async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy path: the API can exist but be denied.
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

interface CopyValueButtonProps {
  value: string;
  /** Human field name, used verbatim in the accessible name. */
  label: string;
  copied: boolean;
  onCopy: (value: string) => void;
}

/** Copy affordance for one field. The confirmation is announced by the page. */
function CopyValueButton({ value, label, copied, onCopy }: CopyValueButtonProps) {
  const { t } = useLocale();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={formatMsg(t('control.jobs.detailCopyField'), { field: label })}
      onClick={() => onCopy(value)}
    >
      {copied ? t('control.jobs.detailCopied') : t('control.jobs.detailCopy')}
    </Button>
  );
}

export default function WebControlJobs() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const canReprint = useHasPermission('job:retry');
  const [searchParams, setSearchParams] = useSearchParams();
  const valueListId = useId();
  const advancedPanelId = useId();

  const selectedDeviceId = searchParams.get('deviceId') || '';
  const isAllStations = selectedDeviceId === '';
  /**
   * Cinema mode lives in the URL so a wall display can be opened once and left
   * running (`/control/jobs?deviceId=…&cinema=1`); the station scope it shows is
   * the same `deviceId` the page uses. It is a presentation flag, not a filter.
   */
  const cinemaOpen = searchParams.get('cinema') === '1';
  /**
   * Which incoming values the cinema rows show instead of the raw job
   * reference. Kept in the URL like the mode itself, so a wall display can be
   * opened with `/control/jobs?cinema=1&cinemaFields=hn,patient_name` and the
   * picker survives a reload.
   */
  const cinemaFields = useMemo(
    () =>
      (searchParams.get('cinemaFields') ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean)
        .slice(0, CINEMA_MAX_FIELDS),
    [searchParams],
  );

  /**
   * Which panels the board carries. In the URL for the same reason as the field
   * list: a wall display is opened from a saved link, and the person who set it
   * up is not standing at that screen.
   */
  const cinemaPanels = useMemo(
    () => parseCinemaPanels(searchParams.get('cinemaPanels')),
    [searchParams],
  );

  const fetchFleet = useCallback(
    () => apiFetch<ControlJobsFleetResponse>('/v1/control/jobs'),
    [],
  );
  const fleetResource = useApiResource(fetchFleet, { intervalMs: 5_000 });
  const fleet = fleetResource.data;
  const devices = useMemo(() => fleet?.devices ?? [], [fleet]);

  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Job filters and grouping. Only the station lives in the URL.
  const [jobSearch, setJobSearch] = useState('');
  const [statusBucket, setStatusBucket] = useState<StatusBucket>('ALL');
  const [datePreset, setDatePreset] = useState<JobDatePreset>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<JobGroupBy>('none');
  const [keyFilters, setKeyFilters] = useState<JobKeyFilter[]>([]);
  const [pendingKey, setPendingKey] = useState('');
  const [pendingValue, setPendingValue] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Selection, drawer and dialogs.
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  /** Cinema row layout: session state, arranged live and not remembered. */
  const [cinemaShowReference, setCinemaShowReference] = useState(true);
  const [cinemaLabelWidth, setCinemaLabelWidth] = useState<'narrow' | 'balanced' | 'wide'>(
    'balanced',
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  /**
   * Which list columns to show. A workstation preference (like the locale), so
   * it lives in localStorage, not the URL - it is presentation, not a filter.
   */
  const [jobColumns, setJobColumns] = useState<string[]>(() => readStoredJobColumns());
  /**
   * Per-column pixel widths, keyed by column id. Deliberately not persisted:
   * widths are a live arrangement, not a saved preference.
   */
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  /** Triage order by default; the operator can switch to pure received time. */
  const [jobSort, setJobSort] = useState<JobSortMode>('attention');
  /**
   * Show only the outcomes somebody already acknowledged. Without it a reviewed
   * job is indistinguishable from the rest of "Other" once its chip is gone,
   * so the operator could not audit their own triage.
   */
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [bulkReviewBusy, setBulkReviewBusy] = useState(false);
  const resizeRef = useRef<{
    id: string;
    nextId: string | null;
    startX: number;
    startWidth: number;
    nextStartWidth: number;
  } | null>(null);
  const [reprintTargets, setReprintTargets] = useState<ControlSyncedJobItem[]>([]);
  const [reviewBusyJobId, setReviewBusyJobId] = useState<string | null>(null);
  const [reprintCopies, setReprintCopies] = useState(1);
  const [reprintReason, setReprintReason] = useState('');
  const [reprintConfirmed, setReprintConfirmed] = useState(false);
  const [reprintBusy, setReprintBusy] = useState(false);

  // Copy feedback: one field at a time, cleared after two seconds.
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const selectedDevice = useMemo(
    () => (selectedDeviceId ? devices.find((device) => device.deviceId === selectedDeviceId) : undefined),
    [devices, selectedDeviceId],
  );

  const stationNameByDeviceId = useMemo(() => {
    const names = new Map<string, string>();
    for (const device of devices) names.set(device.deviceId, stationTitle(device));
    return names;
  }, [devices]);

  const stationNameFor = useCallback(
    (deviceId: string) => stationNameByDeviceId.get(deviceId) ?? deviceId,
    [stationNameByDeviceId],
  );

  /**
   * All stations merges every device's feed and keeps each job's station in
   * `deviceId`; one station is simply that device's slice. The merged rows are
   * the only source for counts, filters and the drawer.
   */
  const scopeJobs = useMemo<ControlSyncedJobItem[]>(() => {
    if (!isAllStations) return selectedDevice?.jobs ?? [];
    return devices.flatMap((device) =>
      device.jobs.map((job) =>
        job.deviceId === device.deviceId ? job : { ...job, deviceId: device.deviceId },
      ),
    );
  }, [devices, isAllStations, selectedDevice]);

  const availablePayloadKeys = useMemo(() => collectPayloadKeys(scopeJobs), [scopeJobs]);

  /**
   * The cinema board lists stations by display name, same rule as the selector,
   * and stays inside the current scope: a one-station board must not show a
   * fleet ladder next to that station's job totals, or the numbers read as one
   * mixed scope.
   */
  const cinemaStations = useMemo(
    () =>
      devices
        .filter((device) => isAllStations || device.deviceId === selectedDeviceId)
        .map((device) => ({
          deviceId: device.deviceId,
          name: stationTitle(device),
          connectionState: device.connectionState,
          jobs: device.jobs,
        })),
    [devices, isAllStations, selectedDeviceId],
  );

  /**
   * The display-field picker offers the incoming keys the current scope actually
   * carries, with the selected ones first so a key that disappeared with a scope
   * change can still be removed.
   */
  const cinemaFieldChoices = useMemo(() => {
    const described = describeCinemaFields(scopeJobs);
    const byKey = new Map(described.map((option) => [option.key, option]));
    const selected = cinemaFields.map(
      (key) => byKey.get(key) ?? { key, count: 0, sample: '' },
    );
    const rest = described.filter((option) => !cinemaFields.includes(option.key));
    return [...selected, ...rest];
  }, [scopeJobs, cinemaFields]);

  /**
   * Incoming payload keys offered as table columns. Selected keys stay first (and
   * stay listed even when the current scope no longer carries them) so they can
   * always be removed.
   */
  const incomingColumnChoices = useMemo(() => {
    const described = describeCinemaFields(scopeJobs);
    const chosen = jobColumns.filter((id) => isPayloadColumnId(id)).map(payloadColumnKey);
    const byKey = new Map(described.map((option) => [option.key, option]));
    const selected = chosen.map(
      (key) => byKey.get(key) ?? { key, count: 0, sample: '' },
    );
    const rest = described.filter((option) => !chosen.includes(option.key));
    return [...selected, ...rest];
  }, [scopeJobs, jobColumns]);

  /**
   * Base set: station, search, dates and payload filters, with the status
   * bucket deliberately not applied. Counts and rows both derive from it, so a
   * chip can never promise rows the list will not show.
   */
  const baseJobs = useMemo(
    () =>
      filterAndGroupJobs(scopeJobs, {
        status: 'ALL',
        search: jobSearch,
        datePreset,
        dateFrom,
        dateTo,
        keyFilters,
      }).filteredJobs,
    [scopeJobs, jobSearch, datePreset, dateFrom, dateTo, keyFilters],
  );

  /**
   * A job needs a human when its status says so AND nobody has acknowledged it.
   * The acknowledgement never rewrites the station's status or payload, it only
   * clears the triage bucket.
   */
  const needsReview = useCallback(
    (job: ControlSyncedJobItem) => jobNeedsAttention(job.status) && !job.reviewedAt,
    [],
  );

  const counts = useMemo(
    () => countStatusBuckets(baseJobs, { isAttention: needsReview }),
    [baseJobs, needsReview],
  );

  /** How many rows in scope carry an acknowledgement, for the toggle's count. */
  const reviewedCount = useMemo(
    () => baseJobs.reduce((total, job) => (job.reviewedAt ? total + 1 : total), 0),
    [baseJobs],
  );

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

  const visibleJobs = useMemo(
    () =>
      baseJobs
        .filter((job) => matchesStatusBucket(job.status, statusBucket, Boolean(job.reviewedAt)))
        .filter((job) => !reviewedOnly || Boolean(job.reviewedAt)),
    [baseJobs, statusBucket, reviewedOnly],
  );

  const visibleJobIdSet = useMemo(
    () => new Set(visibleJobs.map((job) => job.id)),
    [visibleJobs],
  );

  const toggleReviewedOnly = useCallback(() => {
    setReviewedOnly((previous) => {
      const next = !previous;
      // "Needs review" and "reviewed" are disjoint by definition, so that pair can
      // only ever produce an empty list. Turning the reviewed view on drops the
      // triage filter instead of promising rows it cannot show.
      if (next) setStatusBucket((bucket) => (bucket === 'NEEDS_REVIEW' ? 'ALL' : bucket));
      return next;
    });
  }, []);

  /** The other half of the same rule: picking Needs review leaves the reviewed view. */
  const selectStatusBucket = useCallback((bucket: StatusBucket) => {
    setStatusBucket((previous) => {
      const next = previous === bucket ? 'ALL' : bucket;
      if (next === 'NEEDS_REVIEW') setReviewedOnly(false);
      return next;
    });
  }, []);

  /**
   * The reviewed-only view cannot outlive the acknowledgements it filters on:
   * undo the last one and the toggle would be hidden (its chip is gone) while
   * still filtering, leaving an empty list with no visible cause.
   */
  useEffect(() => {
    if (reviewedOnly && reviewedCount === 0) setReviewedOnly(false);
  }, [reviewedOnly, reviewedCount]);

  const sortedVisibleJobs = useMemo(
    () => sortJobs(visibleJobs, jobSort, { isAttention: needsReview }),
    [visibleJobs, jobSort, needsReview],
  );

  const totalPages = Math.max(1, Math.ceil(sortedVisibleJobs.length / JOB_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedVisibleJobs = useMemo(
    () =>
      sortedVisibleJobs.slice(
        (currentPage - 1) * JOB_PAGE_SIZE,
        currentPage * JOB_PAGE_SIZE,
      ),
    [sortedVisibleJobs, currentPage],
  );

  // A filter or order change starts a new result set; a shrinking feed clamps an
  // already-open page instead of leaving it on a blank page.
  useEffect(() => {
    setPage(1);
  }, [
    jobSearch,
    statusBucket,
    datePreset,
    dateFrom,
    dateTo,
    groupBy,
    keyFilters,
    selectedDeviceId,
    jobSort,
    reviewedOnly,
  ]);

  useEffect(() => {
    setPage((previous) => Math.min(previous, totalPages));
  }, [totalPages]);

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
      }).groups.map((group) => ({
        ...group,
        jobs: sortJobs(group.jobs, jobSort, { isAttention: needsReview }),
      })),
    [visibleJobs, groupBy, jobSort, needsReview],
  );

  // Jobs used to suggest payload values: everything except the filter on the
  // key currently being edited, so chained key filters stay useful.
  const jobsForValueSuggestions = useMemo(
    () =>
      filterAndGroupJobs(scopeJobs, {
        status: 'ALL',
        search: jobSearch,
        datePreset,
        dateFrom,
        dateTo,
        keyFilters: keyFilters.filter((filter) => filter.key !== pendingKey),
      }).filteredJobs,
    [scopeJobs, jobSearch, datePreset, dateFrom, dateTo, keyFilters, pendingKey],
  );

  const suggestedPayloadValueCounts = useMemo(
    () => collectPayloadValueCounts(jobsForValueSuggestions, pendingKey),
    [jobsForValueSuggestions, pendingKey],
  );

  // Selection is limited to what is currently visible.
  useEffect(() => {
    setSelectedJobIds((previous) => {
      const next = previous.filter((id) => visibleJobIdSet.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [visibleJobIdSet]);

  const resetLocalState = useCallback(() => {
    setJobSearch('');
    setStatusBucket('ALL');
    setDatePreset('all');
    setDateFrom('');
    setDateTo('');
    setGroupBy('none');
    setKeyFilters([]);
    setPendingKey('');
    setPendingValue('');
    setSelectedJobIds([]);
    setDrawerJobId(null);
    setReprintTargets([]);
    setReprintConfirmed(false);
    setCopiedField(null);
  }, []);

  /** Station changes rebuild the URL, but the cinema display fields are config, not a filter. */
  const retainedParams = useCallback(
    (deviceId: string): Record<string, string> => {
      const next: Record<string, string> = deviceId ? { deviceId } : {};
      if (cinemaFields.length > 0) next.cinemaFields = cinemaFields.join(',');
      if (cinemaPanels.length < CINEMA_PANELS.length) next.cinemaPanels = cinemaPanels.join(',');
      return next;
    },
    [cinemaFields, cinemaPanels],
  );

  const openStation = useCallback(
    (deviceId: string) => {
      resetLocalState();
      setSearchParams(retainedParams(deviceId));
    },
    [resetLocalState, retainedParams, setSearchParams],
  );

  const goOverview = useCallback(() => {
    resetLocalState();
    setSearchParams(retainedParams(''));
  }, [resetLocalState, retainedParams, setSearchParams]);

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

  /**
   * The toggle reads the URL inside the updater rather than the render closure:
   * two checkbox clicks in the same tick must not each start from the old list.
   */
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

  /**
   * Turn one optional panel on or off. The last remaining panel cannot be
   * removed: an empty list reads as "the default board" (see
   * `parseCinemaPanels`), so unchecking it would silently re-check itself.
   */
  const toggleCinemaPanel = useCallback(
    (panel: CinemaPanel) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          const current = parseCinemaPanels(params.get('cinemaPanels'));
          if (current.includes(panel) && current.length === 1) return params;
          const next = current.includes(panel)
            ? current.filter((entry) => entry !== panel)
            : CINEMA_PANELS.filter((entry) => entry === panel || current.includes(entry));
          if (next.length < CINEMA_PANELS.length) params.set('cinemaPanels', next.join(','));
          else params.delete('cinemaPanels');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const visibleColumns = useMemo(() => visibleJobColumns(jobColumns), [jobColumns]);
  /**
   * Batch reprint needs `job:retry`, in any scope. A job carries its own
   * device, so an All-stations batch simply posts to several stations.
   */
  const canSelectRows = canReprint;
  /** All stations shows the station under the printer unless it has its own column. */
  const showStationInDestination = isAllStations && !jobColumns.includes('station');

  const updateJobColumns = useCallback((next: string[]) => {
    const normalized = normalizeJobColumns(next);
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
      const offset = canSelectRows ? 1 : 0;
      visibleColumns.forEach((column, index) => {
        const cell = cells[offset + index];
        if (cell) measured[column.id] = Math.round(cell.getBoundingClientRect().width);
      });
      return measured;
    },
    [canSelectRows, visibleColumns],
  );

  /**
   * Apply a width to one column and take the difference from its right
   * neighbour, so the table keeps its total width instead of overflowing.
   */
  const applyColumnWidth = useCallback(
    (
      id: string,
      nextId: string | null,
      width: number,
      startWidth: number,
      startNextWidth: number,
    ) => {
      if (nextId === null) {
        setColumnWidths((previous) => ({
          ...previous,
          [id]: Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width))),
        }));
        return;
      }
      const maxWidth = Math.round(startWidth + startNextWidth - MIN_COLUMN_WIDTH);
      const clamped = Math.max(
        MIN_COLUMN_WIDTH,
        Math.min(width, maxWidth, MAX_COLUMN_WIDTH),
      );
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

  // `deviceId` is the only URL state, so reaching another station through the
  // browser's back/forward buttons has to reset the local filters too — a URL
  // must never imply a hidden filter.
  const previousDeviceIdRef = useRef(selectedDeviceId);
  useEffect(() => {
    if (previousDeviceIdRef.current === selectedDeviceId) return;
    previousDeviceIdRef.current = selectedDeviceId;
    resetLocalState();
  }, [selectedDeviceId, resetLocalState]);

  const handleSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      await apiFetch('/v1/control/jobs/sync', { method: 'POST' });
      fleetResource.refresh();
      setNotice({ tone: 'success', message: t('control.jobs.syncSuccess') });
    } catch (err) {
      setNotice({
        tone: 'error',
        message: formatMsg(t('control.jobs.syncFailed'), { message: errorMessage(err) }),
      });
    } finally {
      setSyncing(false);
    }
  };

  const syncLabel = isAllStations ? t('control.jobs.syncAll') : t('control.jobs.syncStation');

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
    const key = pendingKey.trim();
    if (!key || !value) return;
    setKeyFilters((previous) => [
      ...previous.filter((filter) => filter.key !== key),
      { key, value, exact: true },
    ]);
    setPendingValue('');
  };

  const clearAllFilters = useCallback(() => {
    setJobSearch('');
    setStatusBucket('ALL');
    setReviewedOnly(false);
    setDatePreset('all');
    setDateFrom('');
    setDateTo('');
    setGroupBy('none');
    setKeyFilters([]);
    setPendingKey('');
    setPendingValue('');
  }, []);

  const toggleJobSelection = (jobId: string) => {
    setSelectedJobIds((previous) =>
      previous.includes(jobId) ? previous.filter((id) => id !== jobId) : [...previous, jobId],
    );
  };

  /** Header checkbox: selects (or clears) exactly the rows passed in. */
  const toggleSelectionFor = (jobs: ControlSyncedJobItem[]) => {
    const ids = jobs.map((job) => job.id);
    if (ids.length === 0) return;
    setSelectedJobIds((previous) => {
      const allSelected = ids.every((id) => previous.includes(id));
      if (allSelected) return previous.filter((id) => !ids.includes(id));
      return Array.from(new Set([...previous, ...ids]));
    });
  };

  const handleCopy = useCallback(async (value: string, field: string) => {
    const copied = await copyTextToClipboard(value);
    if (!copied) return;
    setCopiedField(field);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedField(null), 2_000);
  }, []);

  const openReprintDialog = (jobs: ControlSyncedJobItem[]) => {
    if (!canReprint || jobs.length === 0) return;
    setReprintTargets(jobs);
    setReprintCopies(jobs.length === 1 ? Math.max(1, jobs[0]?.copies ?? 1) : 1);
    setReprintReason(t('control.jobs.reprintReasonDefault'));
    setReprintConfirmed(false);
    setNotice(null);
  };

  const handleToggleReview = async (job: ControlSyncedJobItem) => {
    const reviewed = !job.reviewedAt;
    setReviewBusyJobId(job.id);
    try {
      await apiFetch(
        `/v1/control/devices/${encodeURIComponent(job.deviceId)}/jobs/${encodeURIComponent(job.id)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewed }),
        },
      );
      fleetResource.refresh();
      setNotice({
        tone: 'success',
        message: reviewed
          ? t('control.jobs.reviewedNotice')
          : t('control.jobs.reviewUndoneNotice'),
      });
    } catch (err) {
      setNotice({
        tone: 'error',
        message: formatMsg(t('control.jobs.reviewFailed'), { message: errorMessage(err) }),
      });
    } finally {
      setReviewBusyJobId(null);
    }
  };

  /**
   * Set the acknowledgement on every selected row that needs it, one request
   * each - the API acknowledges a single mirrored job. Sequential on purpose: an
   * operator clearing a batch is never in a hurry so much that racing a refresh
   * is worth it.
   *
   * The same path marks and unmarks, so a mis-clicked batch can be undone from
   * the same bar instead of opening every row's drawer.
   */
  const handleBulkReview = async (jobs: ControlSyncedJobItem[], reviewed: boolean) => {
    if (jobs.length === 0) return;
    setBulkReviewBusy(true);
    let changed = 0;
    let failure: string | null = null;
    try {
      for (const job of jobs) {
        try {
          await apiFetch(
            `/v1/control/devices/${encodeURIComponent(job.deviceId)}/jobs/${encodeURIComponent(job.id)}/review`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reviewed }),
            },
          );
          changed += 1;
        } catch (err) {
          failure = errorMessage(err);
          break;
        }
      }
      fleetResource.refresh();
      if (failure === null) {
        setSelectedJobIds([]);
        setNotice({
          tone: 'success',
          message: formatMsg(
            t(reviewed ? 'control.jobs.reviewSelectedNotice' : 'control.jobs.unreviewSelectedNotice'),
            { count: changed },
          ),
        });
      } else {
        setNotice({
          tone: 'error',
          message: formatMsg(t('control.jobs.reviewFailed'), { message: failure }),
        });
      }
    } finally {
      setBulkReviewBusy(false);
    }
  };

  const hasUnknownOutcomeTarget = useMemo(
    () => reprintTargets.some((job) => getJobVerdict(job.status).outcomeUnknown),
    [reprintTargets],
  );

  const hasPrintedTarget = useMemo(
    () => reprintTargets.some((job) => job.status === 'SUCCESS'),
    [reprintTargets],
  );

  const reprintStationIds = useMemo(
    () => Array.from(new Set(reprintTargets.map((job) => job.deviceId))),
    [reprintTargets],
  );

  const reprintStationNames = useMemo(
    () => reprintStationIds.map((deviceId) => stationNameFor(deviceId)),
    [reprintStationIds, stationNameFor],
  );

  const reprintDestinations = useMemo(() => {
    const seen = new Set<string>();
    const destinations: string[] = [];
    for (const job of reprintTargets) {
      const destination = formatMsg(t('control.jobs.destinationOnStation'), {
        printer: job.printerCode || job.printerId,
        station: stationNameFor(job.deviceId),
      });
      if (!seen.has(destination)) {
        seen.add(destination);
        destinations.push(destination);
      }
    }
    return destinations;
  }, [reprintTargets, stationNameFor, t]);

  const handleSubmitReprint = async () => {
    const reason = reprintReason.trim();
    if (reprintTargets.length === 0 || !reprintConfirmed || !reason) return;
    const copies = Math.min(20, Math.max(1, Math.round(Number(reprintCopies) || 1)));

    setReprintBusy(true);
    try {
      for (const job of reprintTargets) {
        // The station comes from the job, not the current route: a batch in All
        // stations can target several devices at once.
        await apiFetch(
          `/v1/control/devices/${encodeURIComponent(job.deviceId)}/jobs/${encodeURIComponent(job.id)}/reprint`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              printerId: job.printerId,
              copies,
              reason,
              confirmedDuplicateRisk: true,
            }),
          },
        );
      }
      const stations = reprintStationNames.join(', ');
      setNotice({
        tone: 'success',
        message:
          reprintTargets.length === 1
            ? formatMsg(t('control.jobs.reprintSuccessSingle'), {
                id: reprintTargets[0]?.id.slice(0, 12) ?? '',
                station: stations,
              })
            : formatMsg(t('control.jobs.reprintSuccessBatch'), {
                count: reprintTargets.length,
                station: stations,
              }),
      });
      setReprintTargets([]);
      setSelectedJobIds([]);
      fleetResource.refresh();
    } catch (err) {
      setNotice({
        tone: 'error',
        message: formatMsg(t('control.jobs.reprintFailed'), { message: errorMessage(err) }),
      });
    } finally {
      setReprintBusy(false);
    }
  };

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
  const presetLabel = t(DATE_PRESETS.find((preset) => preset.value === datePreset)?.key ?? 'control.jobs.datePresetAll');
  const dateConditionValue = hasCustomDate
    ? formatMsg(t('control.jobs.filterDateRange'), {
        from: dateFrom || '…',
        to: dateTo || '…',
      })
    : presetLabel;

  const advancedConditionCount =
    (hasCustomDate ? 1 : 0) + (groupBy !== 'none' ? 1 : 0) + keyFilters.length;

  const advancedToggleLabel = advancedOpen
    ? t('control.jobs.hideAdvancedFilters')
    : advancedConditionCount > 0
      ? formatMsg(t('control.jobs.advancedFiltersWithCount'), { count: advancedConditionCount })
      : t('control.jobs.advancedFilters');

  const searchCondition = jobSearch.trim()
    ? formatMsg(t('control.jobs.filterSearch'), { value: jobSearch.trim() })
    : '';
  const statusCondition =
    statusBucket !== 'ALL'
      ? formatMsg(t('control.jobs.filterStatus'), { value: statusBucketLabel(t, statusBucket) })
      : '';
  const dateCondition = hasDateCondition
    ? formatMsg(t('control.jobs.filterDate'), { value: dateConditionValue })
    : '';
  const groupCondition =
    groupBy !== 'none' ? formatMsg(t('control.jobs.filterGroup'), { value: groupByLabel }) : '';
  const keyConditions = keyFilters.map((filter) => ({
    key: filter.key,
    value: filter.value,
    label: formatMsg(t('control.jobs.filterKey'), { key: filter.key, value: filter.value }),
  }));
  const hasActiveConditions = Boolean(
    searchCondition || statusCondition || dateCondition || groupCondition || keyConditions.length > 0,
  );
  const removeLabel = (condition: string) =>
    formatMsg(t('control.jobs.removeFilter'), { filter: condition });

  const selectedCount = selectedJobIds.length;
  const selectedJobs = useMemo(
    () => visibleJobs.filter((job) => selectedJobIds.includes(job.id)),
    [visibleJobs, selectedJobIds],
  );
  /**
   * Only the selected rows that still need a human. Selecting a printed row and
   * acknowledging it would be a no-op that still wrote an audit record, so the
   * bulk action counts what it can actually clear.
   */
  const reviewableSelectedJobs = useMemo(
    () => selectedJobs.filter(needsReview),
    [selectedJobs, needsReview],
  );
  /**
   * The other half of the same bar: rows that carry an acknowledgement and can
   * have it taken back. Selecting a batch and clearing it is the mistake this
   * exists to make cheap to undo.
   */
  const acknowledgedSelectedJobs = useMemo(
    () => selectedJobs.filter((job) => Boolean(job.reviewedAt)),
    [selectedJobs],
  );

  /**
   * The selection bar is fixed, so the list has to reserve exactly the room the
   * bar takes. With four actions the bar wraps to four lines on a phone and stays
   * on one on a desktop, so the height is measured instead of guessed per
   * breakpoint: the spacer used to be a flat 4.5rem and covered the pagination as
   * soon as the bar wrapped.
   */
  const selectionBarRef = useRef<HTMLDivElement | null>(null);
  const [selectionBarHeight, setSelectionBarHeight] = useState(0);
  useEffect(() => {
    const node = selectionBarRef.current;
    if (!node) {
      setSelectionBarHeight(0);
      return;
    }
    const measure = () => setSelectionBarHeight(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [selectedCount]);

  const drawerJob = useMemo(
    () => (drawerJobId ? scopeJobs.find((job) => job.id === drawerJobId) ?? null : null),
    [drawerJobId, scopeJobs],
  );
  const drawerPayload = useMemo(
    () => (drawerJob ? extractJobPayload(drawerJob) : {}),
    [drawerJob],
  );
  const drawerPayloadEntries = useMemo(() => Object.entries(drawerPayload), [drawerPayload]);
  const drawerPayloadJson = useMemo(
    () => JSON.stringify(drawerPayload, null, 2),
    [drawerPayload],
  );
  const drawerLogText = useMemo(() => {
    if (!drawerJob) return '';
    return [drawerJob.errorCode, drawerJob.errorMessage]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join('\n');
  }, [drawerJob]);

  const onlineDeviceCount = devices.filter((device) => device.connectionState === 'ONLINE').length;
  const allStationsTone: StatusTone =
    devices.length === 0
      ? 'unknown'
      : onlineDeviceCount === devices.length
        ? 'ok'
        : onlineDeviceCount === 0
          ? 'down'
          : 'busy';

  const totalJobCount = devices.reduce((total, device) => total + device.jobs.length, 0);

  const pageDescription = selectedDevice
    ? formatMsg(t('control.jobs.stationSubtitle'), { name: stationTitle(selectedDevice) })
    : t('control.jobs.description');

  const jobColumnLabel = (id: JobColumnId): string => {
    switch (id) {
      case 'job':
        return t('control.jobs.colJob');
      case 'destination':
        return t('control.jobs.colDestination');
      case 'station':
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

  /**
   * One cell per visible column. The optional columns are the only place a job
   * value can be blank; they render an em dash rather than an empty cell so a
   * column never looks broken.
   */
  const renderJobCell = (job: ControlSyncedJobItem, column: JobTableColumn): ReactNode => {
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
          <Stack gap="xs">
            <Mono size="label" wrap>
              {job.printerCode || job.printerId}
            </Mono>
            {showStationInDestination && (
              <Text size="label" tone="muted" wrap>
                {stationNameFor(job.deviceId)}
              </Text>
            )}
          </Stack>
        );
      case 'station':
        return (
          <Text size="label" wrap>
            {stationNameFor(job.deviceId)}
          </Text>
        );
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
            {job.reviewedAt && (
              <Text size="label" tone="muted" wrap>
                {t('control.jobs.reviewedLabel')}
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

  const renderColgroup = (): ReactNode => (
    <colgroup>
      {canSelectRows && <col style={{ width: '2.5rem' }} />}
      {visibleColumns.map((column) => (
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
  );

  const renderJobRow = (job: ControlSyncedJobItem): ReactNode => {
    const isSelected = selectedJobIds.includes(job.id);
    const reference = job.requestId || job.id;
    return (
      <tr key={job.id} className={isSelected ? 'is-selected' : undefined}>
        {canSelectRows && (
          <DataCell label={t('control.jobs.colSelect')}>
            <Checkbox
              hideLabel
              label={formatMsg(t('control.jobs.selectJobRow'), { id: reference })}
              checked={isSelected}
              onChange={() => toggleJobSelection(job.id)}
            />
          </DataCell>
        )}
        {visibleColumns.map((column) => (
          <DataCell
            key={column.id}
            label={column.kind === 'payload' ? column.key : jobColumnLabel(column.id)}
            actions={column.kind === 'builtin' && column.id === 'actions'}
          >
            {renderJobCell(job, column)}
          </DataCell>
        ))}
      </tr>
    );
  };

  const renderTableHead = (groupLabel: string, jobs: ControlSyncedJobItem[]): ReactNode => {
    const allSelected = jobs.length > 0 && jobs.every((job) => selectedJobIds.includes(job.id));
    return (
      <thead>
        <tr>
          {canSelectRows && (
            <DataHead>
              <Checkbox
                hideLabel
                label={formatMsg(t('control.jobs.selectAllGroup'), { group: groupLabel })}
                checked={allSelected}
                onChange={() => toggleSelectionFor(jobs)}
              />
            </DataHead>
          )}
          {visibleColumns.map((column, index) => {
            const label =
              column.kind === 'payload' ? column.key : jobColumnLabel(column.id);
            return (
              <DataHead key={column.id}>
                {column.kind === 'payload' ? <Mono size="label">{column.key}</Mono> : label}
                {index < visibleColumns.length - 1 && (
                  <span
                    className="wcj-col-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={formatMsg(t('control.jobs.resizeColumn'), { column: label })}
                    aria-valuemin={MIN_COLUMN_WIDTH}
                    aria-valuemax={MAX_COLUMN_WIDTH}
                    {...(columnWidths[column.id] !== undefined
                      ? { 'aria-valuenow': Math.round(columnWidths[column.id]) }
                      : {})}
                    title={t('control.jobs.resizeColumnHint')}
                    tabIndex={0}
                    onPointerDown={(event) => beginColumnResize(event, index)}
                    onPointerMove={moveColumnResize}
                    onPointerUp={endColumnResize}
                    onPointerCancel={endColumnResize}
                    onDoubleClick={() => resetColumnWidth(column.id)}
                    onKeyDown={(event) => nudgeColumn(event, index)}
                  />
                )}
              </DataHead>
            );
          })}
        </tr>
      </thead>
    );
  };

  const renderTechnicalField = (
    fieldKey: string,
    label: string,
    value: string | undefined | null,
    copyable = false,
  ): ReactNode => {
    if (value == null || value === '') return null;
    return (
      <Stack key={fieldKey} gap="xs">
        <Text size="label" weight="semibold" tone="muted">
          {label}
        </Text>
        <Inline gap="sm">
          <Mono size="label" wrap style={{ flex: '1 1 14rem', minWidth: 0 }}>
            {value}
          </Mono>
          {copyable && (
            <CopyValueButton
              value={value}
              label={label}
              copied={copiedField === fieldKey}
              onCopy={(next) => void handleCopy(next, fieldKey)}
            />
          )}
        </Inline>
      </Stack>
    );
  };

  const drawerVerdict = drawerJob ? getJobVerdict(drawerJob.status) : null;
  const drawerHeadlineKey =
    drawerJob?.status === 'SUCCESS'
      ? REPORTED_COMPLETE_COPY.headline
      : drawerVerdict
        ? verdictHeadlineKey(drawerVerdict)
        : '';
  const drawerDetailKey =
    drawerJob?.status === 'SUCCESS'
      ? REPORTED_COMPLETE_COPY.detail
      : drawerVerdict
        ? verdictDetailKey(drawerVerdict)
        : '';
  const drawerHasTechnical = drawerJob
    ? Boolean(
        drawerJob.id ||
          drawerJob.requestId ||
          drawerJob.sourceSystem ||
          drawerJob.templateCode ||
          drawerJob.resolvedTemplateCode ||
          drawerJob.paperProfileId ||
          drawerJob.printerId ||
          drawerJob.runnerId ||
          drawerJob.errorCode ||
          drawerJob.errorMessage ||
          drawerJob.createdAt ||
          drawerJob.finishedAt ||
          drawerJob.completedAt ||
          drawerJob.updatedAt,
      )
    : false;

  return (
    <PageLayout
      density="compact"
      width="full"
      title={t('control.jobs.title')}
      description={pageDescription}
    >
      <Stack gap="lg">
        {notice && (
          <Alert tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={t('common.close')}>
            {notice.message}
          </Alert>
        )}

        {fleetResource.error != null && fleet != null && (
          <ErrorBanner error={fleetResource.error} onRetry={fleetResource.refresh} />
        )}

        {fleetResource.loading && !fleet ? (
          <LoadingState />
        ) : fleetResource.error != null && !fleet ? (
          <ErrorState
            error={fleetResource.error}
            title={t('control.jobs.loadFailed')}
            onRetry={fleetResource.refresh}
          />
        ) : selectedDeviceId && !selectedDevice ? (
          <EmptyState
            title={formatMsg(t('control.jobs.stationNotFound'), { id: selectedDeviceId })}
            action={
              <Button variant="primary" onClick={goOverview}>
                {t('control.jobs.backToOverview')}
              </Button>
            }
          />
        ) : (
          <>
            {/* Station bar: the page's only action row. */}
            <Panel padding="md" aria-label={t('control.jobs.stationBarLabel')}>
              <Inline gap="md">
                <SelectFilter
                  label={t('control.jobs.stationBarLabel')}
                  value={selectedDeviceId}
                  onValueChange={openStation}
                >
                  <option value="">
                    {formatMsg(t('control.jobs.allStationsWithCount'), { count: totalJobCount })}
                  </option>
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {formatMsg(t('control.jobs.stationOption'), {
                        name: stationTitle(device),
                        count: device.jobs.length,
                      })}
                    </option>
                  ))}
                </SelectFilter>

                {selectedDevice ? (
                  <>
                    <StatusIndicator
                      condition={selectedDevice.connectionState}
                      tone={selectedDevice.connectionState === 'ONLINE' ? 'ok' : 'down'}
                    >
                      {selectedDevice.connectionState === 'ONLINE'
                        ? t('control.jobs.connectionOnline')
                        : t('control.jobs.connectionOffline')}
                    </StatusIndicator>
                    {selectedDevice.appVersion && (
                      <Mono size="label" tone="muted" wrap>
                        v{selectedDevice.appVersion}
                      </Mono>
                    )}
                  </>
                ) : (
                  <StatusIndicator condition="all-stations" tone={allStationsTone}>
                    {formatMsg(t('control.jobs.stationSummary'), {
                      online: onlineDeviceCount,
                      total: devices.length,
                    })}
                  </StatusIndicator>
                )}

                <Freshness
                  lastSuccessAt={fleetResource.lastSuccessAt}
                  stale={fleetResource.stale}
                  refreshing={fleetResource.refreshing}
                  paused={fleetResource.paused}
                  onRefresh={fleetResource.refresh}
                />

                <Button variant="primary" busy={syncing} onClick={handleSync}>
                  {syncLabel}
                </Button>
                <Button variant="secondary" onClick={() => navigate('/control/devices')}>
                  {t('control.jobs.manageDevices')}
                </Button>
                <Button variant="secondary" onClick={() => setColumnsOpen(true)}>
                  {t('control.jobs.columnsButton')}
                </Button>
                {/*
                  Cinema controls are one group: they configure the wall board
                  and never change this page's own list, so they sit inside a
                  hairline frame instead of reading as two more page actions.
                */}
                <div
                  className="wcj-cinema-group"
                  role="group"
                  aria-label={t('control.cinema.groupLabel')}
                >
                  <Button variant="secondary" onClick={() => setFieldsOpen(true)}>
                    {t('control.cinema.fieldsButton')}
                  </Button>
                  <Button variant="secondary" onClick={openCinema}>
                    {t('control.cinema.enter')}
                  </Button>
                </div>
              </Inline>
            </Panel>

            {devices.length === 0 ? (
              <EmptyState
                title={t('control.jobs.noStations')}
                hint={t('control.jobs.noStationsHint')}
                action={
                  <Button variant="primary" busy={syncing} onClick={handleSync}>
                    {t('control.jobs.syncAll')}
                  </Button>
                }
              />
            ) : (
              <>
                {/* Status counts: the bucket is applied after the counts. */}
                <Toolbar label={t('control.jobs.countsLabel')}>
                  {(['ALL', 'NEEDS_REVIEW', 'IN_PROGRESS', 'PRINTED'] as StatusBucket[]).map(
                    (bucket) => (
                      <Chip
                        key={bucket}
                        selected={statusBucket === bucket}
                        onClick={() => selectStatusBucket(bucket)}
                      >
                        {statusBucketLabel(t, bucket)} ({bucketCounts[bucket]})
                      </Chip>
                    ),
                  )}
                  {bucketCounts.OTHER > 0 && (
                    <Chip
                      selected={statusBucket === 'OTHER'}
                      onClick={() => selectStatusBucket('OTHER')}
                    >
                      {t('control.jobs.countOther')} ({bucketCounts.OTHER})
                    </Chip>
                  )}
                  {counts.needsReview > 0 &&
                    groupBy === 'none' &&
                    statusBucket === 'ALL' &&
                    jobSort === 'attention' && (
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
                        !hasCustomDate &&
                        (preset.value === 'all' ? datePreset === 'all' : datePreset === preset.value)
                      }
                      onClick={() => handleDatePreset(preset.value)}
                    >
                      {t(preset.key)}
                    </Chip>
                  ))}
                  {/* Acknowledged outcomes cut across the status buckets, so this
                      toggle lives with the filters, not in the "filter by status"
                      toolbar where it would read as a fifth bucket. It only
                      exists while the scope carries acknowledgements. */}
                  {reviewedCount > 0 && (
                    <Chip selected={reviewedOnly} onClick={toggleReviewedOnly}>
                      {formatMsg(t('control.jobs.reviewedOnly'), { count: reviewedCount })}
                    </Chip>
                  )}
                  <Button
                    variant="secondary"
                    aria-expanded={advancedOpen}
                    aria-controls={advancedPanelId}
                    onClick={() => setAdvancedOpen((previous) => !previous)}
                  >
                    {advancedToggleLabel}
                  </Button>
                  {/* Widths are per-visit, so the only way back from a mangled
                      table is this button or a reload. It appears once the
                      operator has actually resized something. */}
                  {hasCustomWidths && (
                    <Button variant="ghost" onClick={() => setColumnWidths({})}>
                      {t('control.jobs.widthsReset')}
                    </Button>
                  )}
                </Inline>

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

                      {availablePayloadKeys.length > 0 && (
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
                      )}

                      {availablePayloadKeys.length > 0 && (
                        <Inline gap="sm">
                          <Button
                            variant="secondary"
                            disabled={!pendingKey || !pendingValue.trim()}
                            onClick={handleAddKeyFilter}
                          >
                            {t('control.jobs.addKeyFilter')}
                          </Button>
                        </Inline>
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
                    {statusCondition && (
                      <Chip
                        aria-label={removeLabel(statusCondition)}
                        onClick={() => setStatusBucket('ALL')}
                      >
                        {statusCondition}
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
                    {keyConditions.map((condition) => (
                      <Chip
                        key={`key:${condition.key}`}
                        aria-label={removeLabel(condition.label)}
                        onClick={() =>
                          setKeyFilters((previous) =>
                            previous.filter(
                              (filter) =>
                                !(
                                  filter.key === condition.key &&
                                  filter.value === condition.value
                                ),
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

                {/*
                  Batch bar: job:retry and a non-empty selection, in any scope.
                  It is fixed to the viewport bottom so the reprint action is
                  visible the moment a row is checked, even after scrolling.
                */}
                {canSelectRows && selectedCount > 0 && (
                  <div
                    ref={selectionBarRef}
                    className="wcj-selection-bar"
                    role="region"
                    aria-label={formatMsg(t('control.jobs.selectedCount'), {
                      count: selectedCount,
                    })}
                  >
                    <Text weight="semibold">
                      {formatMsg(t('control.jobs.selectedCount'), { count: selectedCount })}
                    </Text>
                    <Inline gap="sm">
                      <Button size="sm" variant="secondary" onClick={() => setSelectedJobIds([])}>
                        {t('control.jobs.clearSelection')}
                      </Button>
                      {reviewableSelectedJobs.length > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          busy={bulkReviewBusy}
                          onClick={() => void handleBulkReview(reviewableSelectedJobs, true)}
                        >
                          {formatMsg(t('control.jobs.reviewSelected'), {
                            count: reviewableSelectedJobs.length,
                          })}
                        </Button>
                      )}
                      {acknowledgedSelectedJobs.length > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          busy={bulkReviewBusy}
                          onClick={() => void handleBulkReview(acknowledgedSelectedJobs, false)}
                        >
                          {formatMsg(t('control.jobs.unreviewSelected'), {
                            count: acknowledgedSelectedJobs.length,
                          })}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => openReprintDialog(selectedJobs)}
                      >
                        {formatMsg(t('control.jobs.reprintSelected'), { count: selectedCount })}
                      </Button>
                    </Inline>
                  </div>
                )}

                {visibleJobs.length === 0 ? (
                  scopeJobs.length === 0 ? (
                    <EmptyState
                      title={t('control.jobs.emptyNoJobsTitle')}
                      hint={t('control.jobs.emptyNoJobsHint')}
                      action={
                        <Button variant="primary" busy={syncing} onClick={handleSync}>
                          {syncLabel}
                        </Button>
                      }
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
                    <Panel padding="none">
                      <DataTable
                        label={t('control.jobs.tableLabel')}
                        className={tableClassName}
                        responsive
                      >
                        {renderColgroup()}
                        {renderTableHead(t('control.jobs.tableLabel'), pagedVisibleJobs)}
                        <tbody>{pagedVisibleJobs.map(renderJobRow)}</tbody>
                      </DataTable>
                    </Panel>
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
                        <Panel padding="none">
                          <DataTable
                            label={group.groupLabel}
                            className={tableClassName}
                            responsive
                          >
                            {renderColgroup()}
                            {renderTableHead(group.groupLabel, group.jobs)}
                            <tbody>{group.jobs.map(renderJobRow)}</tbody>
                          </DataTable>
                        </Panel>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </>
            )}
          </>
        )}
        {canSelectRows && selectedCount > 0 && (
          <div
            className="wcj-selection-spacer"
            aria-hidden="true"
            // Measured, not tokenised: the bar's height is a runtime fact (how many
            // actions wrapped), and this is the space it must not cover.
            style={
              selectionBarHeight > 0
                ? { height: `${Math.ceil(selectionBarHeight + 8)}px` }
                : undefined
            }
          />
        )}
      </Stack>

      {/* Job summary drawer: short answer first, evidence collapsed. */}
      <Drawer
        open={drawerJob !== null}
        onClose={() => setDrawerJobId(null)}
        title={t('control.jobs.detailTitle')}
        closeLabel={t('common.close')}
        className="wcj-detail-drawer"
        footer={
          <>
            {drawerJob && (jobNeedsAttention(drawerJob.status) || drawerJob.reviewedAt) && (
              <Button
                variant="secondary"
                busy={reviewBusyJobId === drawerJob.id}
                onClick={() => void handleToggleReview(drawerJob)}
              >
                {drawerJob.reviewedAt
                  ? t('control.jobs.unmarkReviewed')
                  : t('control.jobs.markReviewed')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDrawerJobId(null)}>
              {t('common.close')}
            </Button>
            {drawerJob && canReprint && offersReprint(getJobVerdict(drawerJob.status)) && (
              <Button
                variant={reprintButtonVariant(getJobVerdict(drawerJob.status))}
                onClick={() => {
                  const target = drawerJob;
                  setDrawerJobId(null);
                  openReprintDialog([target]);
                }}
              >
                {t('control.jobs.reprint')}
              </Button>
            )}
          </>
        }
      >
        {drawerJob && (
          <Stack gap="lg">
            <Stack gap="sm">
              <Inline gap="sm">
                <Mono
                  size="body"
                  weight="semibold"
                  wrap
                  style={{ flex: '1 1 12rem', minWidth: 0 }}
                >
                  {drawerJob.requestId || drawerJob.id}
                </Mono>
                <CopyValueButton
                  value={drawerJob.requestId || drawerJob.id}
                  label={
                    drawerJob.requestId
                      ? t('control.jobs.detailRequestId')
                      : t('control.jobs.detailJobId')
                  }
                  copied={copiedField === 'reference'}
                  onCopy={(value) => void handleCopy(value, 'reference')}
                />
              </Inline>
              <CardDetail columns={2}>
                <CardDetailItem label={t('control.jobs.detailDestination')}>
                  <Text wrap>
                    {formatMsg(t('control.jobs.destinationOnStation'), {
                      printer: drawerJob.printerCode || drawerJob.printerId,
                      station: stationNameFor(drawerJob.deviceId),
                    })}
                  </Text>
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.colStatus')}>
                  <StatusBadge status={drawerJob.status} size="sm" />
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.detailReceived')}>
                  <Text title={drawerJob.createdAt}>{formatCreatedAt(drawerJob.createdAt)}</Text>
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.detailCopies')}>
                  <Text>{drawerJob.copies}</Text>
                </CardDetailItem>
              </CardDetail>
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="semibold" tone="muted">
                {t('control.jobs.detailWhatHappened')}
              </Text>
              <Text wrap>{t(drawerHeadlineKey)}</Text>
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="semibold" tone="muted">
                {t('control.jobs.detailNextStep')}
              </Text>
              <Text wrap tone="muted">
                {t(drawerDetailKey)}
              </Text>
            </Stack>

            {drawerJob && (jobNeedsAttention(drawerJob.status) || drawerJob.reviewedAt) && (
              <Text size="label" tone="muted" wrap>
                {drawerJob.reviewedAt
                  ? formatMsg(t('control.jobs.reviewedByHint'), {
                      name: drawerJob.reviewedBy ?? '',
                    })
                  : t('control.jobs.reviewedHint')}
              </Text>
            )}

            {drawerVerdict?.outcomeUnknown && (
              <Alert tone="warning" title={t('control.jobs.detailUnconfirmedTitle')}>
                {t('control.jobs.detailUnconfirmedBody')}
              </Alert>
            )}

            <CollapsibleSection title={t('control.jobs.detailIncomingData')} defaultOpen={false}>
              {drawerPayloadEntries.length === 0 ? (
                <Text size="label" tone="muted">
                  {t('control.jobs.detailNoIncoming')}
                </Text>
              ) : (
                <Stack gap="md">
                  {drawerPayloadEntries.map(([key, value]) => (
                    <Stack key={key} gap="xs">
                      <Mono size="label" tone="muted" wrap>
                        {key}
                      </Mono>
                      <Inline gap="sm">
                        <Mono size="label" wrap style={{ flex: '1 1 14rem', minWidth: 0 }}>
                          {value}
                        </Mono>
                        <CopyValueButton
                          value={value}
                          label={key}
                          copied={copiedField === `payload:${key}`}
                          onCopy={(next) => void handleCopy(next, `payload:${key}`)}
                        />
                      </Inline>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CollapsibleSection>

            <CollapsibleSection title={t('control.jobs.detailTechnical')} defaultOpen={false}>
              {drawerHasTechnical ? (
                <Stack gap="md">
                  {renderTechnicalField(
                    'jobId',
                    t('control.jobs.detailJobId'),
                    drawerJob.id,
                    true,
                  )}
                  {renderTechnicalField(
                    'requestId',
                    t('control.jobs.detailRequestId'),
                    drawerJob.requestId,
                    true,
                  )}
                  {renderTechnicalField(
                    'source',
                    t('control.jobs.detailSource'),
                    drawerJob.sourceSystem,
                  )}
                  {renderTechnicalField(
                    'template',
                    t('control.jobs.detailTemplate'),
                    drawerJob.resolvedTemplateCode ?? drawerJob.templateCode,
                  )}
                  {renderTechnicalField(
                    'paperProfile',
                    t('control.jobs.detailPaperProfile'),
                    drawerJob.paperProfileId,
                  )}
                  {renderTechnicalField(
                    'printer',
                    t('control.jobs.detailPrinter'),
                    drawerJob.printerCode || drawerJob.printerId,
                  )}
                  {renderTechnicalField(
                    'runner',
                    t('control.jobs.detailRunner'),
                    drawerJob.runnerId,
                  )}
                  {renderTechnicalField(
                    'errorCode',
                    t('control.jobs.detailErrorCode'),
                    drawerJob.errorCode,
                    true,
                  )}
                  {renderTechnicalField(
                    'errorMessage',
                    t('control.jobs.detailErrorMessage'),
                    drawerJob.errorMessage,
                    true,
                  )}
                  {renderTechnicalField(
                    'created',
                    t('page.jobDetail.created'),
                    drawerJob.createdAt,
                  )}
                  {renderTechnicalField(
                    'finished',
                    t('page.jobDetail.finished'),
                    drawerJob.finishedAt ?? drawerJob.completedAt,
                  )}
                  {renderTechnicalField(
                    'updated',
                    t('page.jobDetail.updated'),
                    drawerJob.updatedAt,
                  )}

                  <Stack gap="xs">
                    <Inline gap="sm">
                      <Text size="label" weight="semibold" tone="muted">
                        {t('control.jobs.detailRawJson')}
                      </Text>
                      <CopyValueButton
                        value={drawerPayloadJson}
                        label={t('control.jobs.detailRawJson')}
                        copied={copiedField === 'rawJson'}
                        onCopy={(value) => void handleCopy(value, 'rawJson')}
                      />
                    </Inline>
                    <CodeBlock label={t('control.jobs.detailRawJson')} scroll={false}>
                      {drawerPayloadJson}
                    </CodeBlock>
                  </Stack>

                  <Stack gap="xs">
                    <Inline gap="sm">
                      <Text size="label" weight="semibold" tone="muted">
                        {t('control.jobs.detailLogs')}
                      </Text>
                      {drawerLogText && (
                        <CopyValueButton
                          value={drawerLogText}
                          label={t('control.jobs.detailLogs')}
                          copied={copiedField === 'logs'}
                          onCopy={(value) => void handleCopy(value, 'logs')}
                        />
                      )}
                    </Inline>
                    {drawerLogText ? (
                      <CodeBlock label={t('control.jobs.detailLogs')} scroll={false}>
                        {drawerLogText}
                      </CodeBlock>
                    ) : (
                      <Text size="label" tone="muted">
                        {t('control.jobs.detailNoLogs')}
                      </Text>
                    )}
                  </Stack>
                </Stack>
              ) : (
                <Text size="label" tone="muted">
                  {t('control.jobs.detailNoTechnical')}
                </Text>
              )}
            </CollapsibleSection>

            <span className="ui-visually-hidden" role="status" aria-live="polite">
              {copiedField ? t('control.jobs.detailCopied') : ''}
            </span>
          </Stack>
        )}
      </Drawer>

      {/* Reprint confirmation: never opened from a row, always explicit. */}
      <Dialog
        open={reprintTargets.length > 0}
        onClose={() => setReprintTargets([])}
        title={
          reprintStationIds.length === 1
            ? formatMsg(t('control.jobs.reprintDialogTitle'), {
                name: reprintStationNames[0] ?? '',
              })
            : t('control.jobs.reprintDialogTitleGeneric')
        }
        closeLabel={t('common.close')}
        warning={
          hasUnknownOutcomeTarget
            ? t('control.jobs.reprintUnconfirmedWarning')
            : hasPrintedTarget
              ? t('control.jobs.reprintDuplicateWarning')
              : undefined
        }
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReprintTargets([])}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={hasUnknownOutcomeTarget || hasPrintedTarget ? 'danger' : 'primary'}
              busy={reprintBusy}
              busyLabel={t('control.jobs.reprintSubmitting')}
              disabled={!reprintConfirmed || !reprintReason.trim()}
              onClick={handleSubmitReprint}
            >
              {t('control.jobs.reprintSubmit')}
            </Button>
          </>
        }
      >
        <Stack gap="md">
          <Text size="body">
            {reprintTargets.length === 1
              ? formatMsg(t('control.jobs.reprintDialogSingleDesc'), {
                  id: reprintTargets[0]?.id ?? '',
                })
              : formatMsg(t('control.jobs.reprintDialogBatchDesc'), {
                  count: reprintTargets.length,
                })}
          </Text>
          <Stack gap="xs">
            <Text size="label" weight="semibold" tone="muted">
              {t('control.jobs.detailDestination')}
            </Text>
            {reprintDestinations.map((destination) => (
              <Text key={destination} wrap>
                {destination}
              </Text>
            ))}
          </Stack>
          <FormField label={t('control.jobs.reprintCopiesLabel')}>
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
          <FormField label={t('control.jobs.reprintReasonLabel')} required>
            {(control) => (
              <Input
                {...control}
                value={reprintReason}
                onChange={(event) => setReprintReason(event.target.value)}
              />
            )}
          </FormField>
          <Checkbox
            label={t('control.jobs.reprintConfirmDuplicateLabel')}
            checked={reprintConfirmed}
            onChange={(event) => setReprintConfirmed(event.target.checked)}
          />
        </Stack>
      </Dialog>

      <JobColumnsDialog
        open={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        columns={jobColumns}
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
        onToggleField={toggleCinemaField}
        onClearFields={() => setCinemaFields([])}
        onTogglePanel={toggleCinemaPanel}
        maxFields={CINEMA_MAX_FIELDS}
      />

      {cinemaOpen && !(selectedDeviceId && !selectedDevice) && (
        <CinemaBoard
          stations={cinemaStations}
          jobs={scopeJobs}
          displayFields={cinemaFields}
          showReference={cinemaShowReference}
          labelWidth={cinemaLabelWidth}
          scopeLabel={
            selectedDevice ? stationTitle(selectedDevice) : t('control.jobs.allStations')
          }
          lastSuccessAt={fleetResource.lastSuccessAt}
          panels={cinemaPanels}
          loading={fleetResource.loading && fleet == null}
          refreshing={fleetResource.refreshing}
          stale={fleetResource.stale}
          failed={fleetResource.error != null}
          onExit={closeCinema}
        />
      )}
    </PageLayout>
  );
}
