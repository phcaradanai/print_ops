import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch, triggerDirectDownload } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import {
  Alert,
  Badge,
  Button,
  CardDetail,
  CardDetailItem,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Freshness,
  Inline,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  SectionHeading,
  Stack,
  Select,
  Text,
} from '../components/ui/index.js';
import type { ControlCommandProgress } from '@printerops/domain';
import { RemoteCommandProgress } from '../components/RemoteCommandProgress.js';

interface CompatibleReleaseOption {
  id?: string;
  version: string;
  channel?: string;
  schemaVersion: number;
  platform?: string;
  artifactRef?: string;
  releaseNotes?: string;
}

interface DeviceDetailData {
  deviceId: string;
  installationId: string;
  siteId: string;
  hostname: string;
  platform: string;
  architecture: string;
  appVersion: string;
  schemaVersion: number;
  runnerVersion: string;
  runnerStatus?: string;
  printReadinessSummary?: string;
  enrolledAt: string;
  lastSeenAt: string | null;
  connectionState: 'ONLINE' | 'STALE' | 'OFFLINE';
  printState: 'IDLE' | 'PRINTING' | 'PAUSED' | 'ERROR';
  otaState: string;
  lastOtaOperation: string | null;
  status: 'ACTIVE' | 'REVOKED';
  displayName?: string;
  installationPath?: string;
  dataPath?: string;
  osVersion?: string;
  ipAddresses?: string[];
  capabilities?: string[];
  latestCompatibleVersion: string | null;
  latestCompatibleRelease?: {
    id?: string;
    version: string;
    channel?: string;
    releaseNotes?: string;
    schemaVersion: number;
    platform?: string;
    artifactRef?: string;
  } | null;
  compatibleReleases?: CompatibleReleaseOption[];
  hasUpdateAvailable: boolean;
}

interface CommandItem {
  commandId: string;
  deviceId: string;
  type: string;
  targetVersion?: string;
  requestedAt: string;
  expiresAt: string;
  requestedBy: string;
  status: string;
  terminalState?: string;
  failureReason?: string;
  progress?: ControlCommandProgress;
}

const DETAIL_POLL_MS = 6_000;

export default function WebControlDeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLocale();

  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [actionType, setActionType] = useState<'INSTALL' | 'ROLLBACK' | 'CHECK'>('INSTALL');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [targetVersion, setTargetVersion] = useState('');

  const fetchDevice = useCallback(() => apiFetch<DeviceDetailData>(`/v1/control/devices/${id}`), [id]);
  const deviceResource = useApiResource(fetchDevice, { intervalMs: DETAIL_POLL_MS });
  const device = deviceResource.data;
  const compatibleReleases = device?.compatibleReleases
    ?? (device?.latestCompatibleRelease ? [device.latestCompatibleRelease] : []);
  const latestCompatibleVersion = device?.latestCompatibleVersion
    ?? compatibleReleases[0]?.version
    ?? '';
  const selectedRelease = compatibleReleases.find((release) => release.version === targetVersion);

  useEffect(() => {
    if (!compatibleReleases.some((release) => release.version === targetVersion)) {
      setTargetVersion(latestCompatibleVersion);
    }
  }, [compatibleReleases, latestCompatibleVersion, targetVersion]);

  const fetchCommands = useCallback(() => apiFetch<CommandItem[]>(`/v1/control/devices/${id}/commands`), [id]);
  const commandsResource = useApiResource(fetchCommands, { intervalMs: DETAIL_POLL_MS });
  const commands = commandsResource.data ?? [];

  const handleOpenConfirm = (type: 'INSTALL' | 'ROLLBACK' | 'CHECK') => {
    setActionType(type);
    setActionError(null);
    setConfirmModalOpen(true);
  };

  const handleExecuteAction = async () => {
    if (!device) return;
    if (actionType === 'INSTALL' && !selectedRelease) {
      setActionError('Select an available compatible release for this device.');
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      if (actionType === 'INSTALL') {
        await apiFetch(`/v1/control/devices/${device.deviceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'OTA_INSTALL',
            targetVersion,
            idempotencyKey: `install_${device.deviceId}_${targetVersion}_${Date.now()}`,
          }),
        });
      } else if (actionType === 'ROLLBACK') {
        await apiFetch(`/v1/control/devices/${device.deviceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'OTA_ROLLBACK',
            idempotencyKey: `rollback_${device.deviceId}_${Date.now()}`,
          }),
        });
      } else if (actionType === 'CHECK') {
        await apiFetch(`/v1/control/devices/${device.deviceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'OTA_CHECK',
            idempotencyKey: `check_${device.deviceId}_${Date.now()}`,
          }),
        });
      }
      setConfirmModalOpen(false);
      deviceResource.refresh();
      commandsResource.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (deviceResource.loading && !device) return <LoadingState />;
  if (deviceResource.error && !device) return <ErrorState error={deviceResource.error} onRetry={deviceResource.refresh} />;
  if (!device) return <ErrorState error={new Error('Device not found')} onRetry={deviceResource.refresh} />;

  const isOffline = device.connectionState === 'OFFLINE';
  const isBusy = device.otaState === 'DOWNLOADING' || device.otaState === 'INSTALLING' || device.otaState === 'WAITING_FOR_IDLE';
  const isRecoveryRequired = device.otaState === 'ROLLBACK_FAILED' || device.otaState === 'RECOVERY_REQUIRED';

  const onlineTone = device.connectionState === 'ONLINE' ? 'success' : devStateToTone(device.connectionState);

  function devStateToTone(state: string): 'warning' | 'danger' {
    return state === 'STALE' ? 'warning' : 'danger';
  }

  return (
    <PageLayout
      title={t('control.devices.detailTitle').replace('{name}', device.displayName || device.hostname)}
      density="compact"
      width="full"
      actions={
        <Inline gap="md">
          <Button variant="ghost" onClick={() => navigate('/control/devices')}>
            {t('control.devices.backToDevices')}
          </Button>
          <Freshness
            lastSuccessAt={deviceResource.lastSuccessAt}
            stale={deviceResource.stale}
            refreshing={deviceResource.refreshing}
            paused={deviceResource.paused}
            onRefresh={() => { deviceResource.refresh(); commandsResource.refresh(); }}
          />
        </Inline>
      }
    >
      <Stack gap="lg">
        {isRecoveryRequired && (
          <Alert tone="error" title={t('control.devices.recoveryTitle')}>
            {t('control.devices.recoveryBody').replace('{state}', device.otaState)}
          </Alert>
        )}

        {isOffline && (
          <Alert tone="warning" title={t('control.devices.offlineTitle')}>
            {t('control.devices.offlineBody')}
          </Alert>
        )}

        {/* Action Command Bar */}
        <Panel padding="md">
          <Inline gap="md" style={{ justifyContent: 'space-between', alignItems: 'end', flexWrap: 'wrap' }}>
            <Inline gap="xs">
              <Badge tone={onlineTone}>{device.connectionState}</Badge>
              <Badge tone="neutral">{t('control.devices.colSite')}: {device.siteId}</Badge>
              {device.connectionState === 'ONLINE' && !['ROLLBACK_FAILED', 'RECOVERY_REQUIRED'].includes(device.otaState) && (
                <Badge tone="success" title={t('control.devices.otaReadyHint')}>{t('control.devices.otaReady')}</Badge>
              )}
              {device.connectionState === 'ONLINE' && ['ROLLBACK_FAILED', 'RECOVERY_REQUIRED'].includes(device.otaState) && (
                <Badge tone="danger" title={t('control.devices.otaBlocked')}>{t('control.devices.otaBlocked')}</Badge>
              )}
              {device.connectionState !== 'ONLINE' && (
                <Badge tone="neutral" title={t('control.devices.noOtaHint')}>{t('control.devices.noOta')}</Badge>
              )}
              <Badge tone={device.otaState === 'COMPLETED' ? 'success' : 'warning'}>{t('control.devices.colOta')}: {device.otaState}</Badge>
              <Badge tone={device.printState === 'PRINTING' ? 'info' : 'neutral'}>{t('control.devices.colPrint')}: {device.printState}</Badge>
            </Inline>

            <Inline gap="xs">
              <Button
                variant="secondary"
                disabled={isOffline || isBusy}
                onClick={() => handleOpenConfirm('CHECK')}
              >
                {t('control.devices.checkUpdate')}
              </Button>

            </Inline>
            <Stack gap="xs" style={{ minWidth: '220px' }}>
              <Text size="label" weight="medium">{t('control.devices.targetVersion')}</Text>
              <Select
                aria-label={t('control.devices.targetVersion')}
                value={targetVersion}
                disabled={isOffline || isBusy || compatibleReleases.length === 0 || isRecoveryRequired}
                onChange={(event) => setTargetVersion(event.target.value)}
              >
                {compatibleReleases.length === 0
                  ? <option value="">{t('control.devices.noCompatibleRelease')}</option>
                  : compatibleReleases.map((release) => (
                    <option key={release.version} value={release.version}>
                      v{release.version} · {release.channel ?? 'stable'} · schema v{release.schemaVersion}
                    </option>
                  ))}
              </Select>
              <Text size="label" tone="muted">{t('control.devices.compatibleReleasesHint')}</Text>
            </Stack>
            <Inline gap="xs">
              <Button
                variant="primary"
                disabled={isOffline || isBusy || !device.hasUpdateAvailable || !selectedRelease || isRecoveryRequired}
                onClick={() => handleOpenConfirm('INSTALL')}
              >
                {t('control.devices.requestUpdate')}
              </Button>

              <Button
                variant="danger"
                disabled={isOffline || isBusy || isRecoveryRequired}
                onClick={() => handleOpenConfirm('ROLLBACK')}
              >
                {t('control.devices.rollback')}
              </Button>
              {selectedRelease && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const platform = selectedRelease.platform
                      || (device.platform === 'win32' || device.platform === 'windows' ? 'windows-x64' : device.platform);
                    const candidate = selectedRelease.artifactRef?.split('?')[0]?.split(/[/\\]/).pop();
                    const filename = candidate && candidate.includes('.')
                      ? candidate
                      : `PrintOps_${selectedRelease.version}_${platform}.exe`;
                    const downloadUrl = selectedRelease.id
                      ? `/v1/control/releases/${selectedRelease.id}/download`
                      : `/v1/control/releases/latest/download?version=${encodeURIComponent(selectedRelease.version)}&platform=${encodeURIComponent(platform)}`;
                    triggerDirectDownload(downloadUrl, filename);
                  }}
                >
                  {t('common.download')} v{selectedRelease.version}
                </Button>
              )}
            </Inline>
          </Inline>
        </Panel>

        {/* Device Information Cards */}
        <Panel padding="md">
          <CardDetail columns={2}>
            <CardDetailItem label={t('control.devices.deviceIdLabel')}>
              <Mono size="body">{device.deviceId}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.installationId')}>
              <Mono size="body">{device.installationId}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.hostnameOs')}>
              <Text size="body">{device.hostname} ({device.platform} / {device.architecture}{device.osVersion ? ` / ${device.osVersion}` : ''})</Text>
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.networkAddresses')}>
              <Text size="body">{device.ipAddresses?.length ? device.ipAddresses.join(', ') : t('control.content.notReported')}</Text>
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.installationPath')}>
              {device.installationPath ? <Mono size="body">{device.installationPath}</Mono> : <Text size="body" tone="muted">{t('control.content.notReported')}</Text>}
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.dataPath')}>
              {device.dataPath ? <Mono size="body">{device.dataPath}</Mono> : <Text size="body" tone="muted">{t('control.content.notReported')}</Text>}
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.remoteCapabilities')}>
              <Text size="body">{device.capabilities?.join(', ') || t('control.devices.otaOnlyNotReported')}</Text>
            </CardDetailItem>

            <CardDetailItem label={t('control.devices.colVersion')}>
              <Mono size="body" weight="semibold">v{device.appVersion}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.schemaVersion')}>
              <Mono size="body">v{device.schemaVersion}</Mono>
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.runnerStatus')}>
              <Text size="body">v{device.runnerVersion} ({device.runnerStatus || 'UNKNOWN'})</Text>
            </CardDetailItem>

            <CardDetailItem label={t('control.devices.printReadiness')}>
              <Text size="body">{device.printReadinessSummary || 'READY'}</Text>
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.currentPrintState')}>
              <Text size="body">{device.printState}</Text>
            </CardDetailItem>
            <CardDetailItem label={t('control.devices.lastHeartbeat')}>
              <Text size="body">{device.lastSeenAt ? formatRelativeTime(t, device.lastSeenAt) : t('control.devices.never')}</Text>
            </CardDetailItem>

            <CardDetailItem label={t('control.devices.colLatestCompatible')}>
              {device.latestCompatibleVersion ? (
                <Inline gap="xs">
                  <Mono size="body" tone="warning" weight="semibold">v{device.latestCompatibleVersion}</Mono>
                  <Badge tone="warning">{t('control.devices.available')}</Badge>
                </Inline>
              ) : (
                <Text size="body" tone="muted">{t('control.devices.upToDateNoRelease')}</Text>
              )}
            </CardDetailItem>
          </CardDetail>
        </Panel>

        {/* OTA History Table */}
        <Stack gap="md">
          <SectionHeading title={t('control.devices.historyTitle')} />
          {commands.length === 0 ? (
            <Panel padding="md">
              <EmptyState title={t('control.devices.noCommands')} />
            </Panel>
          ) : (
            <DataTable label={t('control.devices.commandsTable')} responsive>
              <thead>
                <tr>
                  <DataHead>{t('control.devices.colCommandId')}</DataHead>
                  <DataHead>{t('control.devices.colType')}</DataHead>
                  <DataHead>{t('control.devices.colTargetVersion')}</DataHead>
                  <DataHead>{t('control.devices.colStatus')}</DataHead>
                  <DataHead>{t('control.devices.colProgress')}</DataHead>
                  <DataHead>{t('control.devices.colTerminalState')}</DataHead>
                  <DataHead>{t('control.devices.colRequestedBy')}</DataHead>
                  <DataHead>{t('control.devices.colRequestedAt')}</DataHead>
                  <DataHead>{t('control.devices.colDetails')}</DataHead>
                </tr>
              </thead>
              <tbody>
                {commands.map((cmd) => {
                  const statusTone = cmd.status === 'COMPLETED' ? 'success' : cmd.status === 'FAILED' ? 'danger' : 'warning';
                  return (
                    <tr key={cmd.commandId}>
                      <DataCell><Mono size="label">{cmd.commandId}</Mono></DataCell>
                      <DataCell><Mono size="body">{cmd.type}</Mono></DataCell>
                      <DataCell><Mono size="body">{cmd.targetVersion ? `v${cmd.targetVersion}` : '—'}</Mono></DataCell>
                      <DataCell><Badge tone={statusTone}>{cmd.status}</Badge></DataCell>
                      <DataCell>
                        <RemoteCommandProgress
                          progress={cmd.progress ?? (['PENDING', 'DELIVERED', 'ACCEPTED'].includes(cmd.status)
                            ? {
                              current: 0,
                              total: 1,
                              percent: 0,
                              mode: 'steps',
                              phase: 'queued',
                              ...(cmd.targetVersion ? { item: cmd.targetVersion } : {}),
                            }
                            : undefined)}
                          commandType={cmd.type}
                          status={cmd.status}
                          compact
                        />
                      </DataCell>
                      <DataCell><Text size="body">{cmd.terminalState || '—'}</Text></DataCell>
                      <DataCell><Text size="label">{cmd.requestedBy}</Text></DataCell>
                      <DataCell><Text size="label">{formatRelativeTime(t, cmd.requestedAt)}</Text></DataCell>
                      <DataCell><Text size="label" tone="muted">{cmd.failureReason || '—'}</Text></DataCell>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </Stack>
      </Stack>

      {/* Explicit Confirmation Modal */}
      <Dialog
        open={confirmModalOpen}
        onClose={() => !isSubmitting && setConfirmModalOpen(false)}
        title={actionType === 'INSTALL' ? t('control.devices.confirmInstallTitle') : actionType === 'ROLLBACK' ? t('control.devices.confirmRollbackTitle') : t('control.devices.confirmCheckTitle')}
      >
        <Stack gap="lg">
          {actionError && (
            <Alert tone="error" title={t('control.devices.actionFailed')}>
              {actionError}
            </Alert>
          )}

          <Panel padding="md">
            <Stack gap="xs">
              <Inline>
                <Text size="body" tone="muted">{t('control.devices.confirmDeviceLabel')} </Text>
                <Text size="body" weight="semibold">{device.displayName || device.hostname} ({device.deviceId})</Text>
              </Inline>
              <Inline>
                <Text size="body" tone="muted">{t('control.devices.confirmCurrentVersionLabel')} </Text>
                <Mono size="body">v{device.appVersion}</Mono>
              </Inline>
              {actionType === 'INSTALL' && (
                <Stack gap="xs">
                  <Inline>
                    <Text size="body" tone="muted">{t('control.devices.confirmTargetVersionLabel')} </Text>
                    <Mono size="body" tone="warning" weight="semibold">v{targetVersion}</Mono>
                  </Inline>
                  {selectedRelease && (
                    <Text size="label" tone="muted">
                      {selectedRelease.channel ?? 'stable'} channel · schema v{selectedRelease.schemaVersion}
                      {selectedRelease.releaseNotes ? ` · ${selectedRelease.releaseNotes}` : ''}
                    </Text>
                  )}
                </Stack>
              )}
              <Inline>
                <Text size="body" tone="muted">{t('control.devices.confirmPrintStateLabel')} </Text>
                <Badge tone={device.printState === 'PRINTING' ? 'info' : 'neutral'}>{device.printState}</Badge>
              </Inline>
            </Stack>
          </Panel>

          {/* Explicit Safety Notice required by prompt */}
          <Alert tone="info" title={t('control.devices.safetyTitle')}>
            {t('control.devices.safetyBody')}
          </Alert>

          <Inline gap="xs">
            <Button variant="ghost" disabled={isSubmitting} onClick={() => setConfirmModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={actionType === 'ROLLBACK' ? 'danger' : 'primary'}
              disabled={isSubmitting || (actionType === 'INSTALL' && !selectedRelease)}
              onClick={handleExecuteAction}
            >
              {isSubmitting ? t('control.devices.dispatching') : actionType === 'INSTALL' ? t('control.devices.confirmInstall') : actionType === 'ROLLBACK' ? t('control.devices.confirmRollback') : t('control.devices.checkNow')}
            </Button>
          </Inline>
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
