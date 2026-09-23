import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import {
  Badge,
  Button,
  DataCell,
  DataHead,
  DataTable,
  Dialog,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Freshness,
  Inline,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Select,
  Stack,
  Text,
} from '../components/ui/index.js';

export interface DeviceListItem {
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
  enrolledAt: string;
  lastSeenAt: string | null;
  connectionState: 'ONLINE' | 'STALE' | 'OFFLINE';
  printState: 'IDLE' | 'PRINTING' | 'PAUSED' | 'ERROR';
  otaState: string;
  lastOtaOperation: string | null;
  status: 'ACTIVE' | 'REVOKED';
  displayName?: string;
  latestCompatibleVersion: string | null;
  hasUpdateAvailable: boolean;
}

const DEVICES_POLL_MS = 10_000;

export default function WebControlDevices() {
  const { t } = useLocale();
  const navigate = useNavigate();

  // Filters
  const [onlineFilter, setOnlineFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [versionFilter, setVersionFilter] = useState<'all' | 'outdated' | 'current'>('all');
  const [otaFilter, setOtaFilter] = useState<string>('all');
  const [siteFilter, setSiteFilter] = useState<string>('');

  // Enrollment token modal
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenSiteId, setTokenSiteId] = useState('main-clinic');
  const [tokenTtl, setTokenTtl] = useState(3600);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);

  const fetchDevices = useCallback(() => apiFetch<DeviceListItem[]>('/v1/control/devices'), []);
  const devicesResource = useApiResource(fetchDevices, { intervalMs: DEVICES_POLL_MS });
  const rawDevices = devicesResource.data ?? [];

  const filteredDevices = useMemo(() => {
    return rawDevices.filter((dev) => {
      if (onlineFilter === 'online' && dev.connectionState !== 'ONLINE') return false;
      if (onlineFilter === 'offline' && dev.connectionState !== 'OFFLINE') return false;
      if (versionFilter === 'outdated' && !dev.hasUpdateAvailable) return false;
      if (versionFilter === 'current' && dev.hasUpdateAvailable) return false;
      if (otaFilter !== 'all' && dev.otaState !== otaFilter) return false;
      if (siteFilter && !dev.siteId.toLowerCase().includes(siteFilter.toLowerCase())) return false;
      return true;
    });
  }, [rawDevices, onlineFilter, versionFilter, otaFilter, siteFilter]);

  const handleGenerateToken = async () => {
    setIsGeneratingToken(true);
    try {
      const res = await apiFetch<{ token: string }>('/v1/control/enrollment-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: tokenSiteId, expiresInSeconds: tokenTtl }),
      });
      setGeneratedToken(res.token);
    } catch {
      // handled
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  return (
    <PageLayout
      title="Devices"
      density="compact"
      width="full"
      actions={
        <Inline gap="md">
          <Button variant="secondary" onClick={() => { setGeneratedToken(null); setTokenModalOpen(true); }}>
            Generate Enrollment Token
          </Button>
          <Freshness
            lastSuccessAt={devicesResource.lastSuccessAt}
            stale={devicesResource.stale}
            refreshing={devicesResource.refreshing}
            paused={devicesResource.paused}
            onRefresh={devicesResource.refresh}
          />
        </Inline>
      }
    >
      {devicesResource.stale && devicesResource.error != null && (
        <ErrorBanner error={devicesResource.error} onRetry={devicesResource.refresh} />
      )}

      {/* Filter Controls */}
      <Stack gap="md">
        <Inline gap="md">
          <Select
            value={onlineFilter}
            onChange={(e) => setOnlineFilter(e.target.value as 'all' | 'online' | 'offline')}
            aria-label="Filter by connection"
          >
            <option value="all">All Connections</option>
            <option value="online">Online only</option>
            <option value="offline">Offline only</option>
          </Select>

          <Select
            value={versionFilter}
            onChange={(e) => setVersionFilter(e.target.value as 'all' | 'outdated' | 'current')}
            aria-label="Filter by update status"
          >
            <option value="all">All Versions</option>
            <option value="outdated">Update Available</option>
            <option value="current">Up to date</option>
          </Select>

          <Select
            value={otaFilter}
            onChange={(e) => setOtaFilter(e.target.value)}
            aria-label="Filter by OTA state"
          >
            <option value="all">All OTA States</option>
            <option value="IDLE">IDLE</option>
            <option value="WAITING_FOR_IDLE">WAITING_FOR_IDLE</option>
            <option value="DOWNLOADING">DOWNLOADING</option>
            <option value="VERIFIED">VERIFIED</option>
            <option value="INSTALLING">INSTALLING</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="ROLLED_BACK">ROLLED_BACK</option>
            <option value="ROLLBACK_FAILED">ROLLBACK_FAILED</option>
          </Select>

          <Input
            placeholder="Filter by site..."
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            style={{ width: '180px' }}
          />
        </Inline>

        {devicesResource.loading && !devicesResource.data ? (
          <LoadingState />
        ) : devicesResource.error != null && !devicesResource.data ? (
          <ErrorState error={devicesResource.error} onRetry={devicesResource.refresh} />
        ) : filteredDevices.length === 0 ? (
          <EmptyState title="No PrintOps devices match criteria" />
        ) : (
          <DataTable label="PrintOps Devices" responsive>
            <thead>
              <tr>
                <DataHead>Device</DataHead>
                <DataHead>Site</DataHead>
                <DataHead>Online Status</DataHead>
                <DataHead>Installed Version</DataHead>
                <DataHead>Latest Compatible</DataHead>
                <DataHead>Print Status</DataHead>
                <DataHead>OTA Status</DataHead>
                <DataHead>Last Seen</DataHead>
                <DataHead>Action</DataHead>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((dev) => {
                const onlineTone = dev.connectionState === 'ONLINE' ? 'success' : dev.connectionState === 'STALE' ? 'warning' : 'danger';
                const printTone = dev.printState === 'PRINTING' ? 'info' : dev.printState === 'ERROR' ? 'danger' : 'neutral';
                const otaTone = dev.otaState === 'COMPLETED' ? 'success' : dev.otaState.includes('FAILED') ? 'danger' : dev.otaState === 'IDLE' ? 'neutral' : 'warning';

                return (
                  <tr key={dev.deviceId}>
                    <DataCell>
                      <Stack gap="xs">
                        <Text weight="medium">{dev.displayName || dev.hostname}</Text>
                        <Mono size="label" tone="muted">{dev.deviceId}</Mono>
                      </Stack>
                    </DataCell>
                    <DataCell>{dev.siteId}</DataCell>
                    <DataCell>
                      <Badge tone={onlineTone}>{dev.connectionState}</Badge>
                    </DataCell>
                    <DataCell>
                      <Mono size="body">v{dev.appVersion}</Mono>
                    </DataCell>
                    <DataCell>
                      {dev.latestCompatibleVersion ? (
                        <Inline gap="xs">
                          <Mono size="body" tone="warning">v{dev.latestCompatibleVersion}</Mono>
                          <Badge tone="warning">UPDATE</Badge>
                        </Inline>
                      ) : (
                        <Text size="body" tone="muted">Up to date</Text>
                      )}
                    </DataCell>
                    <DataCell>
                      <Badge tone={printTone}>{dev.printState}</Badge>
                    </DataCell>
                    <DataCell>
                      <Badge tone={otaTone}>{dev.otaState}</Badge>
                    </DataCell>
                    <DataCell>
                      <Text size="label" tone="muted">
                        {dev.lastSeenAt ? formatRelativeTime(t, dev.lastSeenAt) : 'Never'}
                      </Text>
                    </DataCell>
                    <DataCell>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`/control/devices/${dev.deviceId}`)}
                      >
                        Detail
                      </Button>
                    </DataCell>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Stack>

      {/* Enrollment Token Modal */}
      <Dialog
        open={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        title="Generate One-Time Enrollment Token"
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            Generate an enrollment token to bootstrap a new PrintOps station. Each token is one-time use and device-bound.
          </Text>

          {!generatedToken ? (
            <Stack gap="md">
              <Stack gap="xs">
                <Text size="label" weight="medium">Site Identifier</Text>
                <Input
                  value={tokenSiteId}
                  onChange={(e) => setTokenSiteId(e.target.value)}
                  placeholder="e.g. main-clinic, radiology-1"
                />
              </Stack>
              <Stack gap="xs">
                <Text size="label" weight="medium">Expires In (Seconds)</Text>
                <Input
                  type="number"
                  value={tokenTtl}
                  onChange={(e) => setTokenTtl(Number(e.target.value))}
                />
              </Stack>
              <Inline gap="sm">
                <Button variant="ghost" onClick={() => setTokenModalOpen(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={isGeneratingToken || !tokenSiteId}
                  onClick={handleGenerateToken}
                >
                  {isGeneratingToken ? 'Generating…' : 'Generate Token'}
                </Button>
              </Inline>
            </Stack>
          ) : (
            <Stack gap="md">
              <Text size="body" weight="medium" tone="success">Enrollment Token Ready:</Text>
              <Inline gap="sm">
                <Input readOnly value={generatedToken} style={{ fontFamily: 'monospace' }} />
                <Button variant="secondary" onClick={() => copyToClipboard(generatedToken)}>
                  Copy
                </Button>
              </Inline>
              <Text size="label" tone="muted">
                Provide this token during device setup. Once enrolled, the device will obtain its own permanent per-device credentials.
              </Text>
              <Inline>
                <Button variant="primary" onClick={() => setTokenModalOpen(false)}>Done</Button>
              </Inline>
            </Stack>
          )}
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
