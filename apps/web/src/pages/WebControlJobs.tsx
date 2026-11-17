import { useCallback, useId, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { JOB_STATUSES, type JobStatus } from '@printerops/domain';
import { apiFetch } from '../api/client.js';
import { useHasPermission } from '../api/session.js';
import { errorMessage } from '../api/errors.js';
import { useLocale } from '../i18n/index.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { formatCreatedAt } from '../lib/formatCreatedAt.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { jobNeedsAttention } from '../lib/jobQueueView.js';
import {
  collectPayloadKeys,
  collectPayloadValueCounts,
  extractJobPayload,
  filterAndGroupJobs,
  payloadEntries,
  type FilterableJob,
  type JobDatePreset,
  type JobGroupBy,
  type JobKeyFilter,
} from '../lib/jobPayload.js';
import {
  Alert,
  Badge,
  Button,
  CardDetail,
  CardDetailItem,
  Checkbox,
  Chip,
  CodeBlock,
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
  MetricGrid,
  MetricTile,
  Mono,
  PageLayout,
  Panel,
  Select,
  Stack,
  StatusBadge,
  Text,
  Toolbar,
} from '../components/ui/index.js';

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
  currentVersion: string;
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

type StationStateFilter = 'ALL' | 'ONLINE' | 'OFFLINE' | 'HAS_ERRORS';

function formatMsg(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.split(`{${key}}`).join(String(value)),
    template,
  );
}

function stationTitle(device: { displayName?: string; hostname: string; deviceId: string }): string {
  return device.displayName?.trim() || device.hostname || device.deviceId;
}

export default function WebControlJobs() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const canReprint = useHasPermission('job:retry');
  const canManageControl = useHasPermission('control:manage');
  const [searchParams, setSearchParams] = useSearchParams();
  const valueListId = useId();

  const selectedDeviceId = searchParams.get('deviceId') || '';

  const fetchFleet = useCallback(
    () => apiFetch<ControlJobsFleetResponse>('/v1/control/jobs'),
    [],
  );
  const fleetResource = useApiResource(fetchFleet, { intervalMs: 5_000 });
  const fleet = fleetResource.data;
  const devices = fleet?.devices ?? [];
  const summary = fleet?.summary;

  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Overview station card filters
  const [stationSearch, setStationSearch] = useState('');
  const [stationStateFilter, setStationStateFilter] = useState<StationStateFilter>('ALL');

  // Station drill-down job filters & grouping
  const [jobSearch, setJobSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NEEDS_ATTENTION' | JobStatus>('ALL');
  const [datePreset, setDatePreset] = useState<JobDatePreset>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupBy, setGroupBy] = useState<JobGroupBy>('none');
  const [keyFilters, setKeyFilters] = useState<JobKeyFilter[]>([]);
  const [pendingKey, setPendingKey] = useState('');
  const [pendingValue, setPendingValue] = useState('');

  // Selection, Drawer & Dialogs
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [drawerJob, setDrawerJob] = useState<ControlSyncedJobItem | null>(null);

  const [renameTarget, setRenameTarget] = useState<ControlStationItem | null>(null);
  const [renameDisplayName, setRenameDisplayName] = useState('');
  const [renameSiteId, setRenameSiteId] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const [reprintTargets, setReprintTargets] = useState<ControlSyncedJobItem[]>([]);
  const [reprintCopies, setReprintCopies] = useState(1);
  const [reprintReason, setReprintReason] = useState('');
  const [reprintConfirmed, setReprintConfirmed] = useState(false);
  const [reprintBusy, setReprintBusy] = useState(false);

  const selectedDevice = useMemo(
    () => (selectedDeviceId ? devices.find((d) => d.deviceId === selectedDeviceId) : undefined),
    [devices, selectedDeviceId],
  );

  const filteredDevices = useMemo(() => {
    const q = stationSearch.trim().toLocaleLowerCase();
    return devices.filter((dev) => {
      if (stationStateFilter === 'ONLINE' && dev.connectionState !== 'ONLINE') return false;
      if (stationStateFilter === 'OFFLINE' && dev.connectionState === 'ONLINE') return false;
      if (
        stationStateFilter === 'HAS_ERRORS' &&
        dev.stats.failedJobs === 0 &&
        dev.stats.attentionJobs === 0
      ) {
        return false;
      }
      if (!q) return true;
      const hay = [
        dev.displayName,
        dev.deviceId,
        dev.hostname,
        dev.siteId,
        ...(dev.ipAddresses ?? []),
        ...dev.payloadKeys,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      if (hay.includes(q)) return true;
      return filterAndGroupJobs(dev.jobs, { status: 'ALL', search: stationSearch }).filteredJobs.length > 0;
    });
  }, [devices, stationSearch, stationStateFilter]);

  const stationJobs = selectedDevice?.jobs ?? [];

  const availablePayloadKeys = useMemo(
    () => collectPayloadKeys(stationJobs),
    [stationJobs],
  );

  // Narrow available values for the currently selected key using all other active
  // filters (except filters on pendingKey itself) so chained key filters like
  // hn = 123456 -> prescription = 213456 show matching values immediately.
  const jobsMatchingOtherFilters = useMemo(
    () =>
      filterAndGroupJobs(stationJobs, {
        status: statusFilter,
        search: jobSearch,
        datePreset,
        dateFrom,
        dateTo,
        keyFilters: keyFilters.filter((kf) => kf.key !== pendingKey),
      }).filteredJobs,
    [stationJobs, statusFilter, jobSearch, datePreset, dateFrom, dateTo, keyFilters, pendingKey],
  );

  const suggestedPayloadValueCounts = useMemo(
    () => collectPayloadValueCounts(jobsMatchingOtherFilters, pendingKey),
    [jobsMatchingOtherFilters, pendingKey],
  );

  const filteredValuePills = useMemo(() => {
    const q = pendingValue.trim().toLocaleLowerCase();
    if (!q) return suggestedPayloadValueCounts;
    return suggestedPayloadValueCounts.filter((entry) =>
      entry.value.toLocaleLowerCase().includes(q),
    );
  }, [suggestedPayloadValueCounts, pendingValue]);

  const effectiveKeyFilters = useMemo(() => {
    const trimmedKey = pendingKey.trim();
    const trimmedVal = pendingValue.trim();
    if (!trimmedKey || !trimmedVal) return keyFilters;
    return [
      ...keyFilters.filter((kf) => kf.key !== trimmedKey),
      { key: trimmedKey, value: trimmedVal, exact: false },
    ];
  }, [keyFilters, pendingKey, pendingValue]);

  const { filteredJobs, groups } = useMemo(
    () =>
      filterAndGroupJobs(stationJobs, {
        status: statusFilter,
        search: jobSearch,
        datePreset,
        dateFrom,
        dateTo,
        keyFilters: effectiveKeyFilters,
        groupBy,
      }),
    [stationJobs, statusFilter, jobSearch, datePreset, dateFrom, dateTo, effectiveKeyFilters, groupBy],
  );

  const resetDrillDownState = useCallback(() => {
    setJobSearch('');
    setStatusFilter('ALL');
    setDatePreset('all');
    setDateFrom('');
    setDateTo('');
    setGroupBy('none');
    setKeyFilters([]);
    setPendingKey('');
    setPendingValue('');
    setSelectedJobIds([]);
    setDrawerJob(null);
  }, []);

  const openStation = useCallback(
    (deviceId: string, initialStatus: 'ALL' | 'NEEDS_ATTENTION' = 'ALL') => {
      resetDrillDownState();
      if (initialStatus !== 'ALL') {
        setStatusFilter(initialStatus);
      }
      setSearchParams({ deviceId });
    },
    [resetDrillDownState, setSearchParams],
  );

  const goOverview = useCallback(() => {
    resetDrillDownState();
    setSearchParams({});
  }, [resetDrillDownState, setSearchParams]);

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

  const openRenameDialog = (dev: ControlStationItem) => {
    setRenameTarget(dev);
    setRenameDisplayName(dev.displayName ?? dev.hostname ?? '');
    setRenameSiteId(dev.siteId ?? 'default');
  };

  const handleSaveRename = async () => {
    if (!renameTarget) return;
    setRenameBusy(true);
    try {
      const updated = await apiFetch<{ displayName?: string }>(
        `/v1/control/devices/${encodeURIComponent(renameTarget.deviceId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: renameDisplayName.trim(),
            siteId: renameSiteId.trim() || undefined,
          }),
        },
      );
      setNotice({
        tone: 'success',
        message: formatMsg(t('control.devices.displayNameSaved'), {
          name: updated.displayName || renameDisplayName.trim() || renameTarget.deviceId,
        }),
      });
      setRenameTarget(null);
      fleetResource.refresh();
    } catch (err) {
      setNotice({
        tone: 'error',
        message: formatMsg(t('control.devices.displayNameSaveFailed'), {
          message: errorMessage(err),
        }),
      });
    } finally {
      setRenameBusy(false);
    }
  };

  const toggleKeyFilter = (key: string, value: string, exact = true) => {
    setKeyFilters((prev) => {
      const exists = prev.some(
        (kf) =>
          kf.key === key &&
          kf.value.toLocaleLowerCase() === value.toLocaleLowerCase(),
      );
      if (exists) {
        return prev.filter(
          (kf) =>
            !(
              kf.key === key &&
              kf.value.toLocaleLowerCase() === value.toLocaleLowerCase()
            ),
        );
      }
      return [...prev.filter((kf) => kf.key !== key), { key, value, exact }];
    });
  };

  const handleAddKeyFilter = () => {
    const key = pendingKey.trim();
    const val = pendingValue.trim();
    if (!key || !val) return;
    setKeyFilters((prev) => [
      ...prev.filter((kf) => kf.key !== key),
      { key, value: val, exact: false },
    ]);
    setPendingValue('');
  };

  const toggleJobSelection = (jobId: string) => {
    setSelectedJobIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId],
    );
  };

  const toggleGroupSelection = (groupJobs: ControlSyncedJobItem[]) => {
    const groupIds = groupJobs.map((j) => j.id);
    const allSelected =
      groupIds.length > 0 && groupIds.every((id) => selectedJobIds.includes(id));
    setSelectedJobIds((prev) => {
      if (allSelected) {
        return prev.filter((id) => !groupIds.includes(id));
      }
      const next = new Set(prev);
      for (const id of groupIds) next.add(id);
      return Array.from(next);
    });
  };

  const openReprintDialog = (jobs: ControlSyncedJobItem[]) => {
    if (jobs.length === 0) return;
    setReprintTargets(jobs);
    setReprintCopies(jobs.length === 1 ? Math.max(1, jobs[0]?.copies ?? 1) : 1);
    setReprintReason(t('control.jobs.reprintReasonDefault'));
    setReprintConfirmed(false);
  };

  const hasDuplicateRiskTargets = useMemo(
    () =>
      reprintTargets.some(
        (job) => job.status === 'SUCCESS' || jobNeedsAttention(job.status),
      ),
    [reprintTargets],
  );

  const handleSubmitReprint = async () => {
    if (!selectedDevice || reprintTargets.length === 0 || !reprintConfirmed) return;
    const reason = reprintReason.trim() || t('control.jobs.reprintReasonDefault');
    const copies = Math.min(20, Math.max(1, Number(reprintCopies) || 1));

    setReprintBusy(true);
    try {
      for (const job of reprintTargets) {
        await apiFetch(
          `/v1/control/devices/${encodeURIComponent(selectedDevice.deviceId)}/jobs/${encodeURIComponent(job.id)}/reprint`,
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
      const stationName = stationTitle(selectedDevice);
      setNotice({
        tone: 'success',
        message:
          reprintTargets.length === 1
            ? formatMsg(t('control.jobs.reprintSuccessSingle'), {
                id: reprintTargets[0].id.slice(0, 12),
                station: stationName,
              })
            : formatMsg(t('control.jobs.reprintSuccessBatch'), {
                count: reprintTargets.length,
                station: stationName,
              }),
      });
      setReprintTargets([]);
      setSelectedJobIds([]);
      fleetResource.refresh();
    } catch (err) {
      setNotice({
        tone: 'error',
        message: formatMsg(t('control.jobs.reprintFailed'), {
          message: errorMessage(err),
        }),
      });
    } finally {
      setReprintBusy(false);
    }
  };

  const groupOptions = useMemo(() => {
    const base: Array<{ value: JobGroupBy; label: string }> = [
      { value: 'none', label: t('control.jobs.groupNone') },
      { value: 'date', label: t('control.jobs.groupDate') },
      { value: 'status', label: t('control.jobs.groupStatus') },
      { value: 'template', label: t('control.jobs.groupTemplate') },
      { value: 'printer', label: t('control.jobs.groupPrinter') },
      { value: 'source', label: t('control.jobs.groupSource') },
    ];
    for (const key of availablePayloadKeys) {
      base.push({
        value: `key:${key}`,
        label: formatMsg(t('control.jobs.groupKeyPrefix'), { key }),
      });
    }
    return base;
  }, [availablePayloadKeys, t]);

  const pageTitle = selectedDevice
    ? stationTitle(selectedDevice)
    : t('control.jobs.title');
  const pageDescription = selectedDevice
    ? formatMsg(t('control.jobs.stationSubtitle'), { name: stationTitle(selectedDevice) })
    : t('control.jobs.description');

  const headerActions = (
    <Inline gap="sm">
      <Freshness
        lastSuccessAt={fleetResource.lastSuccessAt}
        stale={fleetResource.stale}
        refreshing={fleetResource.refreshing}
        paused={fleetResource.paused}
        onRefresh={fleetResource.refresh}
      />
      {selectedDevice ? (
        <Button variant="secondary" onClick={goOverview}>
          {t('control.jobs.backToOverview')}
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => navigate('/control/devices')}>
          {t('control.jobs.manageDevices')}
        </Button>
      )}
      <Button variant="primary" busy={syncing} onClick={handleSync}>
        {selectedDevice ? t('control.jobs.syncStation') : t('control.jobs.syncAll')}
      </Button>
    </Inline>
  );

  return (
    <PageLayout
      density="compact"
      width="full"
      title={pageTitle}
      description={pageDescription}
      actions={headerActions}
    >
      <Stack gap="lg">
        {notice && (
          <Alert
            tone={notice.tone}
            onDismiss={() => setNotice(null)}
            dismissLabel={t('common.close')}
          >
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
        ) : !selectedDevice ? (
          /* ─── Mode A: Fleet Summary + PrintOps Station Cards ─────────────────── */
          <Stack gap="lg">
            {summary && (
              <MetricGrid label={t('control.jobs.fleetMetricsLabel')}>
                <MetricTile
                  label={t('control.jobs.metricTotalJobs')}
                  value={summary.totalJobs}
                />
                <MetricTile
                  label={t('control.jobs.metricQueuedJobs')}
                  value={summary.queuedJobs}
                  tone="accent"
                />
                <MetricTile
                  label={t('control.jobs.metricSuccessJobs')}
                  value={summary.successJobs}
                  tone="ok"
                />
                <MetricTile
                  label={t('control.jobs.metricAttentionJobs')}
                  value={summary.attentionJobs}
                  tone={summary.attentionJobs > 0 ? 'attention' : 'neutral'}
                />
                <MetricTile
                  label={t('control.jobs.metricFailedJobs')}
                  value={summary.failedJobs}
                  tone={summary.failedJobs > 0 ? 'critical' : 'neutral'}
                />
                <MetricTile
                  label={t('control.jobs.metricOnlineStations')}
                  value={`${summary.onlineDevices} / ${summary.totalDevices}`}
                  detail={formatMsg(t('control.jobs.metricDevicesOnlineDetail'), {
                    online: summary.onlineDevices,
                    total: summary.totalDevices,
                  })}
                  tone={summary.offlineDevices > 0 ? 'attention' : 'ok'}
                />
              </MetricGrid>
            )}

            {summary && summary.errorBreakdown.length > 0 && (
              <Panel
                title={t('control.jobs.errorBreakdownTitle')}
                description={t('control.jobs.errorBreakdownDesc')}
              >
                <DataTable label={t('control.jobs.errorBreakdownTitle')} responsive>
                  <thead>
                    <tr>
                      <DataHead>{t('control.jobs.switchStation')}</DataHead>
                      <DataHead>{t('control.jobs.colStatus')}</DataHead>
                      <DataHead>{t('control.jobs.metricFailedJobs')}</DataHead>
                      <DataHead>{t('control.jobs.statLastJob')}</DataHead>
                      <DataHead>{t('control.jobs.colActions')}</DataHead>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.errorBreakdown.slice(0, 8).map((errItem) => (
                      <tr key={`${errItem.deviceId}-${errItem.errorCode}`}>
                        <DataCell label={t('control.jobs.switchStation')}>
                          <Stack gap="xs">
                            <Text weight="semibold">{errItem.deviceName}</Text>
                            <Mono size="label" tone="muted">
                              {errItem.deviceId}
                            </Mono>
                          </Stack>
                        </DataCell>
                        <DataCell label={t('control.jobs.colStatus')}>
                          <Stack gap="xs">
                            <Badge tone="danger">
                              <Mono>{errItem.errorCode}</Mono>
                            </Badge>
                            {errItem.errorMessage && (
                              <Text size="label" tone="muted" wrap>
                                {errItem.errorMessage}
                              </Text>
                            )}
                          </Stack>
                        </DataCell>
                        <DataCell label={t('control.jobs.metricFailedJobs')}>
                          <Text weight="semibold">{errItem.count}</Text>
                        </DataCell>
                        <DataCell label={t('control.jobs.statLastJob')}>
                          <Text size="label" tone="muted">
                            {formatCreatedAt(errItem.latestAt)}
                          </Text>
                        </DataCell>
                        <DataCell label={t('control.jobs.colActions')}>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openStation(errItem.deviceId, 'NEEDS_ATTENTION')}
                          >
                            {t('control.jobs.inspectErrors')}
                          </Button>
                        </DataCell>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </Panel>
            )}

            <Panel
              title={t('control.jobs.stationDirectoryTitle')}
              description={t('control.jobs.stationDirectoryDesc')}
            >
              <Stack gap="md">
                <Grid columns={2} gap="md">
                  <FormField label={t('control.jobs.stationSearchLabel')}>
                    {(control) => (
                      <Input
                        {...control}
                        type="search"
                        placeholder={t('control.jobs.stationSearchPlaceholder')}
                        value={stationSearch}
                        onChange={(e) => setStationSearch(e.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label={t('control.jobs.stationStateLabel')}>
                    {(control) => (
                      <Select
                        {...control}
                        value={stationStateFilter}
                        onChange={(e) =>
                          setStationStateFilter(e.target.value as StationStateFilter)
                        }
                      >
                        <option value="ALL">{t('control.jobs.stationStateAll')}</option>
                        <option value="ONLINE">{t('control.jobs.stationStateOnline')}</option>
                        <option value="OFFLINE">{t('control.jobs.stationStateOffline')}</option>
                        <option value="HAS_ERRORS">
                          {t('control.jobs.stationStateHasErrors')}
                        </option>
                      </Select>
                    )}
                  </FormField>
                </Grid>

                {filteredDevices.length === 0 ? (
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
                  <Grid columns={2} gap="md">
                    {filteredDevices.map((dev) => {
                      const online = dev.connectionState === 'ONLINE';
                      const visibleKeys = dev.payloadKeys.slice(0, 6);
                      const hiddenKeysCount = Math.max(0, dev.payloadKeys.length - 6);
                      return (
                        <Panel
                          key={dev.deviceId}
                          title={stationTitle(dev)}
                          description={`${dev.deviceId} · ${dev.siteId}`}
                          actions={
                            <Inline gap="xs">
                              <Badge tone={online ? 'success' : 'danger'}>
                                {online ? t('control.jobs.online') : t('control.jobs.offline')}
                              </Badge>
                              <Badge tone="neutral">v{dev.currentVersion}</Badge>
                              {canManageControl && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openRenameDialog(dev)}
                                >
                                  {t('control.devices.editDisplayName')}
                                </Button>
                              )}
                            </Inline>
                          }
                          footer={
                            <Inline gap="sm" style={{ justifyContent: 'flex-end' }}>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  navigate(`/control/devices/${encodeURIComponent(dev.deviceId)}`)
                                }
                              >
                                {t('control.jobs.deviceSettings')}
                              </Button>
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => openStation(dev.deviceId)}
                              >
                                {t('control.jobs.openJobs')}
                              </Button>
                            </Inline>
                          }
                        >
                          <Stack gap="sm">
                            <CardDetail columns={2}>
                              <CardDetailItem label={t('control.jobs.metricTotalJobs')}>
                                <Text weight="semibold">{dev.stats.totalJobs}</Text>
                              </CardDetailItem>
                              <CardDetailItem label={t('control.jobs.metricQueuedJobs')}>
                                <Text weight="semibold" tone="primary">
                                  {dev.stats.queuedJobs}
                                </Text>
                              </CardDetailItem>
                              <CardDetailItem label={t('control.jobs.metricAttentionJobs')}>
                                <Text
                                  weight="semibold"
                                  tone={dev.stats.attentionJobs > 0 ? 'warning' : 'default'}
                                >
                                  {dev.stats.attentionJobs}
                                </Text>
                              </CardDetailItem>
                              <CardDetailItem label={t('control.jobs.metricFailedJobs')}>
                                <Text
                                  weight="semibold"
                                  tone={dev.stats.failedJobs > 0 ? 'danger' : 'default'}
                                >
                                  {dev.stats.failedJobs}
                                </Text>
                              </CardDetailItem>
                              <CardDetailItem label={t('control.jobs.statLastJob')}>
                                <Text size="label" tone="muted">
                                  {dev.stats.lastJobAt
                                    ? formatRelativeTime(t, dev.stats.lastJobAt)
                                    : '—'}
                                </Text>
                              </CardDetailItem>
                            </CardDetail>

                            <Stack gap="xs">
                              <Text size="label" tone="muted">
                                {t('control.jobs.payloadKeysPreview')}
                              </Text>
                              {visibleKeys.length > 0 ? (
                                <Inline gap="xs">
                                  {visibleKeys.map((key) => (
                                    <Badge key={key} tone="info">
                                      <Mono size="label">{key}</Mono>
                                    </Badge>
                                  ))}
                                  {hiddenKeysCount > 0 && (
                                    <Badge tone="neutral">
                                      {formatMsg(t('control.jobs.moreKeys'), {
                                        count: hiddenKeysCount,
                                      })}
                                    </Badge>
                                  )}
                                </Inline>
                              ) : (
                                <Text size="label" tone="muted">
                                  {t('control.jobs.noPayloadKeysYet')}
                                </Text>
                              )}
                            </Stack>

                            {dev.stats.latestError && (
                              <Alert
                                tone={
                                  dev.stats.latestError.status === 'FAILED'
                                    ? 'error'
                                    : 'warning'
                                }
                                title={t('control.jobs.latestError')}
                              >
                                <Inline gap="xs">
                                  <Mono size="label">
                                    {dev.stats.latestError.errorCode ||
                                      dev.stats.latestError.status}
                                  </Mono>
                                  {dev.stats.latestError.errorMessage && (
                                    <Text size="label" wrap>
                                      — {dev.stats.latestError.errorMessage}
                                    </Text>
                                  )}
                                </Inline>
                              </Alert>
                            )}
                          </Stack>
                        </Panel>
                      );
                    })}
                  </Grid>
                )}
              </Stack>
            </Panel>
          </Stack>
        ) : (
          /* ─── Mode B: Station Drill-Down: Filter, Group & Remote Re-print ───── */
          <Stack gap="lg">
            <Panel>
              <Inline gap="md" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <Inline gap="md" style={{ alignItems: 'flex-end' }}>
                  <FormField label={t('control.jobs.switchStation')}>
                    {(control) => (
                      <Select
                        {...control}
                        value={selectedDevice.deviceId}
                        onChange={(e) => openStation(e.target.value)}
                      >
                        {devices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {stationTitle(d)} ({d.stats.totalJobs})
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  {canManageControl && (
                    <Button
                      variant="secondary"
                      onClick={() => openRenameDialog(selectedDevice)}
                    >
                      {t('control.devices.editDisplayName')}
                    </Button>
                  )}
                </Inline>
                <Inline gap="xs">
                  <Badge
                    tone={selectedDevice.connectionState === 'ONLINE' ? 'success' : 'danger'}
                  >
                    {selectedDevice.connectionState === 'ONLINE'
                      ? t('control.jobs.online')
                      : t('control.jobs.offline')}
                  </Badge>
                  <Badge tone="neutral">v{selectedDevice.currentVersion}</Badge>
                  <Mono size="label" tone="muted">
                    {selectedDevice.deviceId} · {selectedDevice.siteId}
                  </Mono>
                </Inline>
              </Inline>
            </Panel>

            <MetricGrid label={t('control.jobs.stationMetricsLabel')}>
              <MetricTile
                label={t('control.jobs.metricTotalJobs')}
                value={selectedDevice.stats.totalJobs}
              />
              <MetricTile
                label={t('control.jobs.metricQueuedJobs')}
                value={selectedDevice.stats.queuedJobs}
                tone="accent"
              />
              <MetricTile
                label={t('control.jobs.metricSuccessJobs')}
                value={selectedDevice.stats.successJobs}
                tone="ok"
              />
              <MetricTile
                label={t('control.jobs.metricAttentionJobs')}
                value={selectedDevice.stats.attentionJobs}
                tone={selectedDevice.stats.attentionJobs > 0 ? 'attention' : 'neutral'}
              />
              <MetricTile
                label={t('control.jobs.metricFailedJobs')}
                value={selectedDevice.stats.failedJobs}
                tone={selectedDevice.stats.failedJobs > 0 ? 'critical' : 'neutral'}
              />
            </MetricGrid>

            <Panel
              title={t('control.jobs.filtersTitle')}
              actions={
                <Inline gap="sm">
                  <Text size="label" tone="muted">
                    {formatMsg(t('control.jobs.matchingCount'), {
                      shown: filteredJobs.length,
                      total: stationJobs.length,
                    })}
                  </Text>
                  <Button size="sm" variant="ghost" onClick={resetDrillDownState}>
                    {t('control.jobs.clearFilters')}
                  </Button>
                </Inline>
              }
            >
              <Stack gap="md">
                <Grid columns={3} gap="md">
                  <FormField label={t('control.jobs.searchLabel')}>
                    {(control) => (
                      <Input
                        {...control}
                        type="search"
                        placeholder={t('control.jobs.searchPlaceholder')}
                        value={jobSearch}
                        onChange={(e) => setJobSearch(e.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label={t('control.jobs.statusLabel')}>
                    {(control) => (
                      <Select
                        {...control}
                        value={statusFilter}
                        onChange={(e) =>
                          setStatusFilter(
                            e.target.value as 'ALL' | 'NEEDS_ATTENTION' | JobStatus,
                          )
                        }
                      >
                        <option value="ALL">{t('control.jobs.statusAll')}</option>
                        <option value="NEEDS_ATTENTION">
                          {t('control.jobs.statusNeedsAttention')}
                        </option>
                        {JOB_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label={t('control.jobs.groupByLabel')}>
                    {(control) => (
                      <Select
                        {...control}
                        value={groupBy}
                        onChange={(e) => setGroupBy(e.target.value as JobGroupBy)}
                      >
                        {groupOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                </Grid>

                <Grid columns={3} gap="md">
                  <FormField label={t('control.jobs.datePresetLabel')}>
                    {(control) => (
                      <Select
                        {...control}
                        value={datePreset}
                        onChange={(e) => {
                          const next = e.target.value as JobDatePreset;
                          setDatePreset(next);
                          if (next !== 'all') {
                            setDateFrom('');
                            setDateTo('');
                          }
                        }}
                      >
                        <option value="all">{t('control.jobs.datePresetAll')}</option>
                        <option value="today">{t('control.jobs.datePresetToday')}</option>
                        <option value="7d">{t('control.jobs.datePreset7d')}</option>
                        <option value="30d">{t('control.jobs.datePreset30d')}</option>
                      </Select>
                    )}
                  </FormField>
                  <FormField label={t('control.jobs.dateFromLabel')}>
                    {(control) => (
                      <Input
                        {...control}
                        type="date"
                        value={dateFrom}
                        onChange={(e) => {
                          setDateFrom(e.target.value);
                          if (e.target.value) setDatePreset('all');
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
                        onChange={(e) => {
                          setDateTo(e.target.value);
                          if (e.target.value) setDatePreset('all');
                        }}
                      />
                    )}
                  </FormField>
                </Grid>

                {availablePayloadKeys.length > 0 && (
                  <Stack gap="sm">
                    <Grid columns={4} gap="md">
                      <FormField label={t('control.jobs.keyFilterKeyLabel')}>
                        {(control) => (
                          <Select
                            {...control}
                            value={pendingKey}
                            onChange={(e) => {
                              setPendingKey(e.target.value);
                              setPendingValue('');
                            }}
                          >
                            <option value="">
                              {t('control.jobs.keyFilterKeyPlaceholder')}
                            </option>
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
                            onChange={(e) => {
                              const picked = e.target.value;
                              if (!pendingKey || !picked) return;
                              setKeyFilters((prev) => [
                                ...prev.filter((kf) => kf.key !== pendingKey),
                                { key: pendingKey, value: picked, exact: true },
                              ]);
                              setPendingValue('');
                            }}
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
                              onChange={(e) => setPendingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddKeyFilter();
                                }
                              }}
                              disabled={!pendingKey}
                            />
                            <datalist id={valueListId}>
                              {suggestedPayloadValueCounts.map((entry) => (
                                <option key={entry.value} value={entry.value} />
                              ))}
                            </datalist>
                          </>
                        )}
                      </FormField>
                      <Inline gap="sm" style={{ alignItems: 'flex-end' }}>
                        <Button
                          variant="secondary"
                          disabled={!pendingKey || !pendingValue.trim()}
                          onClick={handleAddKeyFilter}
                        >
                          {t('control.jobs.addKeyFilter')}
                        </Button>
                      </Inline>
                    </Grid>

                    {pendingKey && filteredValuePills.length > 0 && (
                      <Inline gap="xs">
                        <Text size="label" tone="muted">
                          {formatMsg(t('control.jobs.keyFilterAvailableValues'), { key: pendingKey })}:
                        </Text>
                        {filteredValuePills.slice(0, 20).map((entry) => {
                          const selected = keyFilters.some(
                            (kf) =>
                              kf.key === pendingKey &&
                              kf.value.toLocaleLowerCase() === entry.value.toLocaleLowerCase(),
                          );
                          return (
                            <Chip
                              key={entry.value}
                              selected={selected}
                              onClick={() => {
                                toggleKeyFilter(pendingKey, entry.value, true);
                                setPendingValue('');
                              }}
                            >
                              {entry.value} ({entry.count})
                            </Chip>
                          );
                        })}
                        {filteredValuePills.length > 20 && (
                          <Badge tone="neutral">
                            {formatMsg(t('control.jobs.moreKeys'), {
                              count: filteredValuePills.length - 20,
                            })}
                          </Badge>
                        )}
                      </Inline>
                    )}

                    {keyFilters.length > 0 && (
                      <Toolbar label={t('control.jobs.activeKeyFiltersLabel')}>
                        <Inline gap="xs">
                          <Text size="label" tone="muted">
                            {t('control.jobs.activeKeyFiltersLabel')}:
                          </Text>
                          {keyFilters.map((kf) => (
                            <Chip
                              key={kf.key}
                              selected
                              onClick={() => toggleKeyFilter(kf.key, kf.value, kf.exact !== false)}
                            >
                              <Mono size="label">{kf.key}</Mono> = {kf.value} ×
                            </Chip>
                          ))}
                        </Inline>
                      </Toolbar>
                    )}
                  </Stack>
                )}
              </Stack>
            </Panel>

            {canReprint && selectedJobIds.length > 0 && (
              <Toolbar label={t('control.jobs.selectedCount')}>
                <Inline gap="md" style={{ justifyContent: 'space-between' }}>
                  <Text weight="semibold">
                    {formatMsg(t('control.jobs.selectedCount'), {
                      count: selectedJobIds.length,
                    })}
                  </Text>
                  <Inline gap="sm">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedJobIds([])}
                    >
                      {t('control.jobs.clearSelection')}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        const chosen = stationJobs.filter((j) =>
                          selectedJobIds.includes(j.id),
                        );
                        openReprintDialog(chosen);
                      }}
                    >
                      {formatMsg(t('control.jobs.reprintSelected'), {
                        count: selectedJobIds.length,
                      })}
                    </Button>
                  </Inline>
                </Inline>
              </Toolbar>
            )}

            {filteredJobs.length === 0 ? (
              <EmptyState
                title={t('control.jobs.noJobs')}
                hint={t('control.jobs.noJobsHint')}
                action={
                  <Button variant="secondary" onClick={resetDrillDownState}>
                    {t('control.jobs.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <Stack gap="md">
                {groups.map((group) => {
                  const allGroupSelected =
                    group.jobs.length > 0 &&
                    group.jobs.every((job) => selectedJobIds.includes(job.id));
                  return (
                    <Panel
                      key={group.groupKey}
                      title={
                        groupBy === 'none'
                          ? t('control.jobs.tableLabel')
                          : group.groupLabel
                      }
                      actions={
                        <Inline gap="xs">
                          <Badge tone="neutral">
                            {formatMsg(t('control.jobs.groupSummary'), {
                              total: group.totalCount,
                            })}
                          </Badge>
                          {group.failedCount > 0 && (
                            <Badge tone="danger">{group.failedCount} failed</Badge>
                          )}
                          {group.attentionCount > 0 && (
                            <Badge tone="warning">{group.attentionCount} attention</Badge>
                          )}
                        </Inline>
                      }
                      padding="none"
                    >
                      <DataTable label={t('control.jobs.tableLabel')} responsive>
                        <thead>
                          <tr>
                            {canReprint && (
                              <DataHead>
                                <Checkbox
                                  hideLabel
                                  label={formatMsg(t('control.jobs.selectAllGroup'), {
                                    group: group.groupLabel,
                                  })}
                                  checked={allGroupSelected}
                                  onChange={() => toggleGroupSelection(group.jobs)}
                                />
                              </DataHead>
                            )}
                            <DataHead>{t('control.jobs.colJobAndPayload')}</DataHead>
                            <DataHead>{t('control.jobs.colTemplatePrinter')}</DataHead>
                            <DataHead>{t('control.jobs.colStatus')}</DataHead>
                            <DataHead>{t('control.jobs.colCreated')}</DataHead>
                            <DataHead>{t('control.jobs.colActions')}</DataHead>
                          </tr>
                        </thead>
                        <tbody>
                          {group.jobs.map((job) => {
                            const entries = payloadEntries(job);
                            const previewEntries = entries.slice(0, 6);
                            const overflowCount = Math.max(0, entries.length - 6);
                            const isChecked = selectedJobIds.includes(job.id);

                            return (
                              <tr key={job.id} className={isChecked ? 'is-selected' : undefined}>
                                {canReprint && (
                                  <DataCell label={t('control.jobs.colSelect')}>
                                    <Checkbox
                                      hideLabel
                                      label={formatMsg(t('control.jobs.selectJobRow'), {
                                        id: job.id.slice(0, 10),
                                      })}
                                      checked={isChecked}
                                      onChange={() => toggleJobSelection(job.id)}
                                    />
                                  </DataCell>
                                )}
                                <DataCell label={t('control.jobs.colJobAndPayload')}>
                                  <Stack gap="xs">
                                    <Inline gap="xs">
                                      <Mono size="label" weight="semibold">
                                        {job.requestId || job.id}
                                      </Mono>
                                      {job.copies > 1 && (
                                        <Badge tone="neutral">×{job.copies}</Badge>
                                      )}
                                      {job.reprintOfJobId && (
                                        <Badge tone="info">reprint</Badge>
                                      )}
                                    </Inline>
                                    {previewEntries.length > 0 ? (
                                      <Inline gap="xs">
                                        {previewEntries.map(({ key, value }) => {
                                          const active = keyFilters.some(
                                            (kf) =>
                                              kf.key === key &&
                                              kf.value.toLocaleLowerCase() ===
                                                value.toLocaleLowerCase(),
                                          );
                                          return (
                                            <Chip
                                              key={key}
                                              selected={active}
                                              onClick={() => toggleKeyFilter(key, value)}
                                            >
                                              <Mono size="label">{key}</Mono>: {value}
                                            </Chip>
                                          );
                                        })}
                                        {overflowCount > 0 && (
                                          <Badge tone="neutral">+{overflowCount}</Badge>
                                        )}
                                      </Inline>
                                    ) : (
                                      <Text size="label" tone="muted">
                                        {job.payloadSnapshot || '—'}
                                      </Text>
                                    )}
                                  </Stack>
                                </DataCell>
                                <DataCell label={t('control.jobs.colTemplatePrinter')}>
                                  <Stack gap="xs">
                                    <Mono size="label">
                                      {job.resolvedTemplateCode || job.templateCode || '—'}
                                    </Mono>
                                    <Text size="label" tone="muted">
                                      {job.printerCode || job.printerId}
                                      {job.sourceSystem ? ` · ${job.sourceSystem}` : ''}
                                    </Text>
                                  </Stack>
                                </DataCell>
                                <DataCell label={t('control.jobs.colStatus')}>
                                  <Stack gap="xs">
                                    <StatusBadge status={job.status} size="sm" />
                                    {(job.errorCode || job.errorMessage) && (
                                      <Text size="label" tone="danger" wrap>
                                        {job.errorCode ? `${job.errorCode}: ` : ''}
                                        {job.errorMessage ?? ''}
                                      </Text>
                                    )}
                                  </Stack>
                                </DataCell>
                                <DataCell label={t('control.jobs.colCreated')}>
                                  <Text size="label" tone="muted">
                                    {formatCreatedAt(job.createdAt)}
                                  </Text>
                                </DataCell>
                                <DataCell label={t('control.jobs.colActions')}>
                                  <Inline gap="xs">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => setDrawerJob(job)}
                                    >
                                      {t('control.jobs.viewPayload')}
                                    </Button>
                                    {canReprint && (
                                      <Button
                                        size="sm"
                                        variant="primary"
                                        onClick={() => openReprintDialog([job])}
                                      >
                                        {t('control.jobs.reprint')}
                                      </Button>
                                    )}
                                  </Inline>
                                </DataCell>
                              </tr>
                            );
                          })}
                        </tbody>
                      </DataTable>
                    </Panel>
                  );
                })}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>

      {/* Incoming Payload Inspection Drawer */}
      <Drawer
        open={drawerJob !== null}
        onClose={() => setDrawerJob(null)}
        title={t('control.jobs.drawerTitle')}
        closeLabel={t('common.close')}
        footer={
          drawerJob &&
          selectedDevice && (
            <Inline gap="sm" style={{ justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setDrawerJob(null)}>
                {t('common.close')}
              </Button>
              {canReprint && (
                <Button
                  variant="primary"
                  onClick={() => {
                    const target = drawerJob;
                    setDrawerJob(null);
                    openReprintDialog([target]);
                  }}
                >
                  {formatMsg(t('control.jobs.drawerReprintButton'), {
                    name: stationTitle(selectedDevice),
                  })}
                </Button>
              )}
            </Inline>
          )
        }
      >
        {drawerJob && (
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="label" weight="semibold" tone="muted">
                {t('control.jobs.drawerMetaTitle')}
              </Text>
              <CardDetail columns={2}>
                <CardDetailItem label="Job ID">
                  <Mono size="label">{drawerJob.id}</Mono>
                </CardDetailItem>
                <CardDetailItem label="Request ID">
                  <Mono size="label">{drawerJob.requestId || '—'}</Mono>
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.colStatus')}>
                  <StatusBadge status={drawerJob.status} size="sm" />
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.drawerCopies')}>
                  <Text>{drawerJob.copies}</Text>
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.drawerSource')}>
                  <Mono size="label">{drawerJob.sourceSystem || '—'}</Mono>
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.drawerTemplate')}>
                  <Mono size="label">
                    {drawerJob.resolvedTemplateCode || drawerJob.templateCode || '—'}
                  </Mono>
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.drawerProfile')}>
                  <Mono size="label">{drawerJob.paperProfileId || '—'}</Mono>
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.drawerPrinter')}>
                  <Mono size="label">
                    {drawerJob.printerCode || drawerJob.printerId}
                  </Mono>
                </CardDetailItem>
                <CardDetailItem label={t('control.jobs.drawerCreated')}>
                  <Text size="label">{formatCreatedAt(drawerJob.createdAt)}</Text>
                </CardDetailItem>
              </CardDetail>
            </Stack>

            {(drawerJob.errorCode || drawerJob.errorMessage) && (
              <Alert tone="error" title={t('control.jobs.drawerError')}>
                <Text wrap>
                  {drawerJob.errorCode ? `${drawerJob.errorCode}: ` : ''}
                  {drawerJob.errorMessage ?? ''}
                </Text>
              </Alert>
            )}

            <Stack gap="xs">
              <Text size="label" weight="semibold" tone="muted">
                {t('control.jobs.drawerPayloadTitle')}
              </Text>
              {(() => {
                const entries = payloadEntries(drawerJob);
                if (entries.length === 0) {
                  return (
                    <Text size="label" tone="muted">
                      {t('control.jobs.drawerNoPayload')}
                    </Text>
                  );
                }
                return (
                  <CardDetail columns={1}>
                    {entries.map(({ key, value }) => (
                      <CardDetailItem key={key} label={<Mono size="label">{key}</Mono>}>
                        <Inline gap="sm" style={{ justifyContent: 'space-between' }}>
                          <Mono size="body" wrap>
                            {value}
                          </Mono>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              toggleKeyFilter(key, value);
                              setDrawerJob(null);
                            }}
                          >
                            {t('control.jobs.drawerFilterValue')}
                          </Button>
                        </Inline>
                      </CardDetailItem>
                    ))}
                  </CardDetail>
                );
              })()}
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="semibold" tone="muted">
                {t('control.jobs.drawerRawJsonTitle')}
              </Text>
              <CodeBlock label={t('control.jobs.drawerRawJsonTitle')}>
                {JSON.stringify(extractJobPayload(drawerJob), null, 2)}
              </CodeBlock>
            </Stack>
          </Stack>
        )}
      </Drawer>

      {/* Edit Display Name Dialog */}
      <Dialog
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title={t('control.devices.editDisplayNameTitle')}
        closeLabel={t('common.close')}
        footer={
          <Inline gap="sm" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              busy={renameBusy}
              disabled={!renameDisplayName.trim()}
              onClick={handleSaveRename}
            >
              {t('common.save')}
            </Button>
          </Inline>
        }
      >
        <Stack gap="md">
          <Text size="label" tone="muted">
            {t('control.devices.editDisplayNameHint')}
          </Text>
          <FormField label={t('control.devices.displayNameLabel')} required>
            {(control) => (
              <Input
                {...control}
                value={renameDisplayName}
                onChange={(e) => setRenameDisplayName(e.target.value)}
                placeholder={t('control.devices.displayNamePlaceholder')}
              />
            )}
          </FormField>
          <FormField label={t('control.devices.siteIdLabel')}>
            {(control) => (
              <Input
                {...control}
                value={renameSiteId}
                onChange={(e) => setRenameSiteId(e.target.value)}
                placeholder={t('control.devices.siteIdPlaceholder')}
              />
            )}
          </FormField>
        </Stack>
      </Dialog>

      {/* Remote Re-print Confirmation Dialog */}
      <Dialog
        open={reprintTargets.length > 0 && selectedDevice !== undefined}
        onClose={() => setReprintTargets([])}
        title={
          selectedDevice
            ? formatMsg(t('control.jobs.reprintDialogTitle'), {
                name: stationTitle(selectedDevice),
              })
            : ''
        }
        closeLabel={t('common.close')}
        warning={
          hasDuplicateRiskTargets
            ? t('control.jobs.reprintDuplicateWarning')
            : undefined
        }
        dismissOnBackdrop={false}
        footer={
          <Inline gap="sm" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setReprintTargets([])}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              busy={reprintBusy}
              busyLabel={t('control.jobs.reprintSubmitting')}
              disabled={!reprintConfirmed || !reprintReason.trim()}
              onClick={handleSubmitReprint}
            >
              {t('control.jobs.reprintSubmit')}
            </Button>
          </Inline>
        }
      >
        <Stack gap="md">
          <Text size="body">
            {reprintTargets.length === 1
              ? formatMsg(t('control.jobs.reprintDialogSingleDesc'), {
                  id: reprintTargets[0].id,
                })
              : formatMsg(t('control.jobs.reprintDialogBatchDesc'), {
                  count: reprintTargets.length,
                })}
          </Text>
          <FormField label={t('control.jobs.reprintCopiesLabel')}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={20}
                value={reprintCopies}
                onChange={(e) => setReprintCopies(Number(e.target.value) || 1)}
              />
            )}
          </FormField>
          <FormField label={t('control.jobs.reprintReasonLabel')} required>
            {(control) => (
              <Input
                {...control}
                value={reprintReason}
                onChange={(e) => setReprintReason(e.target.value)}
              />
            )}
          </FormField>
          <Checkbox
            label={t('control.jobs.reprintConfirmDuplicateLabel')}
            checked={reprintConfirmed}
            onChange={(e) => setReprintConfirmed(e.target.checked)}
          />
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
