import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
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
  ErrorState,
  Freshness,
  Inline,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  Stack,
  Text,
} from '../components/ui/index.js';

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
  latestCompatibleVersion: string | null;
  latestCompatibleRelease?: {
    version: string;
    releaseNotes?: string;
    schemaVersion: number;
  } | null;
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

  const fetchDevice = useCallback(() => apiFetch<DeviceDetailData>(`/v1/control/devices/${id}`), [id]);
  const deviceResource = useApiResource(fetchDevice, { intervalMs: DETAIL_POLL_MS });
  const device = deviceResource.data;

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
    setIsSubmitting(true);
    setActionError(null);
    try {
      if (actionType === 'INSTALL') {
        await apiFetch(`/v1/control/devices/${device.deviceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'OTA_INSTALL',
            targetVersion: device.latestCompatibleVersion,
            idempotencyKey: `install_${device.deviceId}_${device.latestCompatibleVersion}_${Date.now()}`,
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
      title={`Device: ${device.displayName || device.hostname}`}
      density="compact"
      width="full"
      actions={
        <Inline gap="md">
          <Button variant="ghost" onClick={() => navigate('/control/devices')}>
            Back to Devices
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
          <Alert tone="error" title="Manual Recovery Required">
            Device reached a failed rollback state ({device.otaState}). Remote OTA operations are blocked until resolved locally by a physical operator.
          </Alert>
        )}

        {isOffline && (
          <Alert tone="warning" title="Device Offline">
            Device is currently offline. Remote commands cannot be dispatched until connectivity is restored.
          </Alert>
        )}

        {/* Action Command Bar */}
        <Panel padding="md">
          <Inline gap="md">
            <Inline gap="xs">
              <Badge tone={onlineTone}>{device.connectionState}</Badge>
              <Badge tone="neutral">Site: {device.siteId}</Badge>
              <Badge tone={device.otaState === 'COMPLETED' ? 'success' : 'warning'}>OTA: {device.otaState}</Badge>
              <Badge tone={device.printState === 'PRINTING' ? 'info' : 'neutral'}>Print: {device.printState}</Badge>
            </Inline>

            <Inline gap="xs">
              <Button
                variant="secondary"
                disabled={isOffline || isBusy}
                onClick={() => handleOpenConfirm('CHECK')}
              >
                Check Update
              </Button>

              <Button
                variant="primary"
                disabled={isOffline || isBusy || !device.hasUpdateAvailable || isRecoveryRequired}
                onClick={() => handleOpenConfirm('INSTALL')}
              >
                Request Update
              </Button>

              <Button
                variant="danger"
                disabled={isOffline || isBusy || isRecoveryRequired}
                onClick={() => handleOpenConfirm('ROLLBACK')}
              >
                Rollback
              </Button>
            </Inline>
          </Inline>
        </Panel>

        {/* Device Information Cards */}
        <Panel padding="md">
          <CardDetail columns={2}>
            <CardDetailItem label="Device ID">
              <Mono size="body">{device.deviceId}</Mono>
            </CardDetailItem>
            <CardDetailItem label="Installation ID">
              <Mono size="body">{device.installationId}</Mono>
            </CardDetailItem>
            <CardDetailItem label="Hostname / OS">
              <Text size="body">{device.hostname} ({device.platform} / {device.architecture})</Text>
            </CardDetailItem>

            <CardDetailItem label="Installed App Version">
              <Mono size="body" weight="semibold">v{device.appVersion}</Mono>
            </CardDetailItem>
            <CardDetailItem label="Database Schema Version">
              <Mono size="body">v{device.schemaVersion}</Mono>
            </CardDetailItem>
            <CardDetailItem label="Runner Status">
              <Text size="body">v{device.runnerVersion} ({device.runnerStatus || 'UNKNOWN'})</Text>
            </CardDetailItem>

            <CardDetailItem label="Print Readiness">
              <Text size="body">{device.printReadinessSummary || 'READY'}</Text>
            </CardDetailItem>
            <CardDetailItem label="Current Print State">
              <Text size="body">{device.printState}</Text>
            </CardDetailItem>
            <CardDetailItem label="Last Heartbeat">
              <Text size="body">{device.lastSeenAt ? formatRelativeTime(t, device.lastSeenAt) : 'Never'}</Text>
            </CardDetailItem>

            <CardDetailItem label="Compatible Target Release">
              {device.latestCompatibleVersion ? (
                <Inline gap="xs">
                  <Mono size="body" tone="warning" weight="semibold">v{device.latestCompatibleVersion}</Mono>
                  <Badge tone="warning">AVAILABLE</Badge>
                </Inline>
              ) : (
                <Text size="body" tone="muted">Up to date (No new compatible release)</Text>
              )}
            </CardDetailItem>
          </CardDetail>
        </Panel>

        {/* OTA History Table */}
        <Stack gap="md">
          <Text size="title" weight="semibold">OTA & Command History</Text>
          {commands.length === 0 ? (
            <Panel padding="md">
              <Text size="body" tone="muted">No commands recorded for this device yet.</Text>
            </Panel>
          ) : (
            <DataTable label="Device Commands" responsive>
              <thead>
                <tr>
                  <DataHead>Command ID</DataHead>
                  <DataHead>Type</DataHead>
                  <DataHead>Target Version</DataHead>
                  <DataHead>Status</DataHead>
                  <DataHead>Terminal State</DataHead>
                  <DataHead>Requested By</DataHead>
                  <DataHead>Requested At</DataHead>
                  <DataHead>Details</DataHead>
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
        title={actionType === 'INSTALL' ? 'Confirm Remote OTA Update' : actionType === 'ROLLBACK' ? 'Confirm OTA Rollback' : 'Confirm Update Check'}
      >
        <Stack gap="lg">
          {actionError && (
            <Alert tone="error" title="Action Failed">
              {actionError}
            </Alert>
          )}

          <Panel padding="md">
            <Stack gap="xs">
              <Inline>
                <Text size="body" tone="muted">Device: </Text>
                <Text size="body" weight="semibold">{device.displayName || device.hostname} ({device.deviceId})</Text>
              </Inline>
              <Inline>
                <Text size="body" tone="muted">Current Version: </Text>
                <Mono size="body">v{device.appVersion}</Mono>
              </Inline>
              {actionType === 'INSTALL' && (
                <Inline>
                  <Text size="body" tone="muted">Target Version: </Text>
                  <Mono size="body" tone="warning" weight="semibold">v{device.latestCompatibleVersion}</Mono>
                </Inline>
              )}
              <Inline>
                <Text size="body" tone="muted">Current Print State: </Text>
                <Badge tone={device.printState === 'PRINTING' ? 'info' : 'neutral'}>{device.printState}</Badge>
              </Inline>
            </Stack>
          </Panel>

          {/* Explicit Safety Notice required by prompt */}
          <Alert tone="info" title="Print Safety Notice">
            The update will begin only when the local PrintOps instance reaches a safe point. Active printing is never interrupted.
          </Alert>

          <Inline gap="xs">
            <Button variant="ghost" disabled={isSubmitting} onClick={() => setConfirmModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={actionType === 'ROLLBACK' ? 'danger' : 'primary'}
              disabled={isSubmitting}
              onClick={handleExecuteAction}
            >
              {isSubmitting ? 'Dispatching…' : actionType === 'INSTALL' ? 'Confirm Update Request' : actionType === 'ROLLBACK' ? 'Confirm Rollback' : 'Check Now'}
            </Button>
          </Inline>
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
