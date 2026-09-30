import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, triggerDirectDownload } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import { compareVersions } from '@printerops/domain';
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
  ErrorBanner,
  ErrorState,
  Freshness,
  Inline,
  Input,
  Label,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  Select,
  Stack,
  Text,
} from '../components/ui/index.js';

interface ReleaseItem {
  id: string;
  version: string;
  channel: string;
  platform: string;
  schemaVersion: number;
  artifactRef: string;
  sha256: string;
  status: 'AVAILABLE' | 'REVOKED';
  releaseNotes?: string;
  isLts?: boolean;
  isLatest?: boolean;
  createdAt: string;
}
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
  installationPath?: string;
  dataPath?: string;
  osVersion?: string;
  ipAddresses?: string[];
  capabilities?: string[];
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

  // Network discovery state
  const [isScanning, setIsScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [ipModalOpen, setIpModalOpen] = useState(false);
  const [customIp, setCustomIp] = useState('');
  const [isConnectingIp, setIsConnectingIp] = useState(false);
  const [ipError, setIpError] = useState<string | null>(null);

  // Releases & Download state
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [selectedDownloadVersion, setSelectedDownloadVersion] = useState<string>('');
  const fetchReleases = useCallback(() => apiFetch<ReleaseItem[]>('/v1/control/releases'), []);
  const releasesResource = useApiResource(fetchReleases, { intervalMs: 30_000 });
  const rawReleases = releasesResource.data ?? [];

  const availableReleases = useMemo(() => {
    return rawReleases
      .filter((r) => r.status === 'AVAILABLE')
      .slice()
      .sort((a, b) => compareVersions(b.version, a.version) ?? 0);
  }, [rawReleases]);

  const latestRelease = availableReleases[0] ?? null;

  const effectiveSelectedRelease = useMemo(() => {
    if (selectedDownloadVersion) {
      const found = availableReleases.find((r) => r.version === selectedDownloadVersion);
      if (found) return found;
    }
    return latestRelease;
  }, [availableReleases, selectedDownloadVersion, latestRelease]);

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

  const handleScanNetwork = async () => {
    setIsScanning(true);
    setScanNotice(null);
    try {
      const res = await apiFetch<{ discoveredCount: number }>('/v1/control/devices/discover', {
        method: 'POST',
      });
      setScanNotice(t('control.devices.scanSuccess').replace('{count}', String(res.discoveredCount)));
      devicesResource.refresh();
    } catch (err) {
      setScanNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnectIp = async () => {
    if (!customIp.trim()) return;
    setIsConnectingIp(true);
    setIpError(null);
    try {
      const res = await apiFetch<{ discoveredCount: number }>('/v1/control/devices/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: customIp.trim() }),
      });
      if (res.discoveredCount > 0) {
        setIpModalOpen(false);
        setCustomIp('');
        setScanNotice(t('control.devices.scanSuccess').replace('{count}', String(res.discoveredCount)));
        devicesResource.refresh();
      } else {
        setIpError('No PrintOps station responded at the specified IP/hostname.');
      }
    } catch (err) {
      setIpError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnectingIp(false);
    }
  };

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

  const handleDownloadRelease = (release: ReleaseItem | null) => {
    const version = release?.version ?? latestRelease?.version;
    if (!version) return;
    const platform = release?.platform ?? latestRelease?.platform ?? 'windows-x64';
    const filename = `PrintOps_Setup_v${version}_${platform}.exe`;
    const downloadPath = release?.id
      ? `/v1/control/releases/${release.id}/download`
      : `/v1/control/releases/latest/download?platform=${encodeURIComponent(platform)}&version=${encodeURIComponent(version)}`;

    setScanNotice(t('control.downloadNotice')
      .replace('{version}', version)
      .replace('{filename}', filename));

    triggerDirectDownload(downloadPath, filename);
  };

  return (
    <PageLayout
      title="Devices"
      density="compact"
      width="full"
      actions={
        <Inline gap="md">
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedDownloadVersion(latestRelease?.version ?? '');
              setDownloadModalOpen(true);
            }}
          >
            {t('control.devices.downloadApp')}{latestRelease ? ` (v${latestRelease.version})` : ''}
          </Button>
          <Button
            variant="secondary"
            busy={isScanning}
            busyLabel={t('control.devices.scanning')}
            onClick={handleScanNetwork}
          >
            {t('control.devices.scanNetwork')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setIpError(null);
              setIpModalOpen(true);
            }}
          >
            {t('control.devices.addByIp')}
          </Button>
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
      <Inline gap="md" style={{ alignItems: 'center' }}>
        <Text size="body" tone="muted">
          Web Control automatically detects and monitors active PrintOps stations on the network.
        </Text>
        {latestRelease?.version && (
          <Badge tone="neutral">
            {t('control.devices.latestAppRelease').replace('{version}', latestRelease.version)}
          </Badge>
        )}
      </Inline>
      {scanNotice && (
        <Alert tone="info" onDismiss={() => setScanNotice(null)}>
          {scanNotice}
        </Alert>
      )}
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
                <DataHead>PrintOps Client Version</DataHead>
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
                      <Stack gap="xs">
                        <Badge tone={onlineTone}>{dev.connectionState}</Badge>
                        {dev.connectionState === 'ONLINE' && !['ROLLBACK_FAILED', 'RECOVERY_REQUIRED'].includes(dev.otaState) && (
                          <Badge tone="success" title="Client is online and reachable for OTA updates">
                            ● OTA Ready
                          </Badge>
                        )}
                        {dev.connectionState === 'ONLINE' && ['ROLLBACK_FAILED', 'RECOVERY_REQUIRED'].includes(dev.otaState) && (
                          <Badge tone="danger" title="OTA is blocked due to recovery state">
                            ▲ OTA Blocked
                          </Badge>
                        )}
                        {dev.connectionState !== 'ONLINE' && (
                          <Badge tone="neutral" title="Client is offline; cannot receive OTA updates">
                            ○ No OTA
                          </Badge>
                        )}
                      </Stack>
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
              <Stack gap="xs">
                <Text size="body" weight="medium">{t('control.devices.enrollDownloadTitle')}</Text>
                <Text size="label" tone="muted">{t('control.devices.enrollDownloadDesc')}</Text>
                <Inline gap="sm">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSelectedDownloadVersion(latestRelease?.version ?? '');
                      setDownloadModalOpen(true);
                    }}
                  >
                    {t('control.devices.downloadApp')}{latestRelease ? ` (v${latestRelease.version})` : ''}
                  </Button>
                </Inline>
              </Stack>
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
      {/* Add Station by IP Modal */}
      <Dialog
        open={ipModalOpen}
        onClose={() => setIpModalOpen(false)}
        title={t('control.devices.addByIpTitle')}
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            {t('control.devices.addByIpDesc')}
          </Text>
          {ipError && (
            <Alert tone="error" onDismiss={() => setIpError(null)}>
              {ipError}
            </Alert>
          )}
          <Stack gap="xs">
            <Label htmlFor="station-ip-input">IP Address / Hostname</Label>
            <Input
              id="station-ip-input"
              value={customIp}
              placeholder={t('control.devices.ipPlaceholder')}
              onChange={(e) => setCustomIp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConnectIp();
              }}
            />
          </Stack>
          <Inline gap="sm" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setIpModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={isConnectingIp || !customIp.trim()}
              busy={isConnectingIp}
              busyLabel={t('common.connecting')}
              onClick={handleConnectIp}
            >
              {t('control.devices.connect')}
            </Button>
          </Inline>
        </Stack>
      </Dialog>

      {/* Download App Modal */}
      <Dialog
        open={downloadModalOpen}
        onClose={() => setDownloadModalOpen(false)}
        title={t('control.devices.downloadModalTitle')}
      >
        <Stack gap="md">
          <Text size="body" tone="muted">
            {t('control.devices.downloadModalDesc')}
          </Text>

          {availableReleases.length === 0 ? (
            <Alert tone="warning" title={t('control.devices.noReleases')}>
              {t('control.devices.noReleases')}
            </Alert>
          ) : (
            <>
              <Stack gap="xs">
                <Label htmlFor="download-version-select">
                  {t('control.devices.selectVersion')}
                </Label>
                <Select
                  id="download-version-select"
                  aria-label={t('control.devices.selectVersion')}
                  value={effectiveSelectedRelease?.version ?? ''}
                  onChange={(e) => setSelectedDownloadVersion(e.target.value)}
                >
                  {availableReleases.map((rel) => (
                    <option key={rel.id} value={rel.version}>
                      v{rel.version} · {rel.platform} · {rel.channel}
                      {rel.isLatest || rel.id === latestRelease?.id ? ` (${t('control.devices.latest')})` : ''}
                      {rel.isLts || rel.channel === 'lts' ? ' (LTS)' : ''}
                    </option>
                  ))}
                </Select>
              </Stack>

              {effectiveSelectedRelease && (
                <Panel padding="md">
                  <Stack gap="sm">
                    <Inline style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Inline gap="xs" style={{ alignItems: 'center' }}>
                        <Text size="body" weight="bold">v{effectiveSelectedRelease.version}</Text>
                        {(effectiveSelectedRelease.isLatest || effectiveSelectedRelease.id === latestRelease?.id) && (
                          <Badge tone="success">{t('control.devices.latest')}</Badge>
                        )}
                        {(effectiveSelectedRelease.isLts || effectiveSelectedRelease.channel === 'lts') && (
                          <Badge tone="info">LTS</Badge>
                        )}
                        <Badge tone="neutral">{effectiveSelectedRelease.channel}</Badge>
                      </Inline>
                      <Mono size="label">{effectiveSelectedRelease.platform}</Mono>
                    </Inline>
                    <Text size="label" tone="muted">
                      Filename: <Mono size="label">PrintOps_Setup_v{effectiveSelectedRelease.version}_{effectiveSelectedRelease.platform}.exe</Mono>
                    </Text>

                    <CardDetail columns={2}>
                      <CardDetailItem label={t('control.devices.platform')}>
                        <Mono size="body">{effectiveSelectedRelease.platform}</Mono>
                      </CardDetailItem>
                      <CardDetailItem label={t('control.devices.channel')}>
                        <Text size="body">{effectiveSelectedRelease.channel}</Text>
                      </CardDetailItem>
                      <CardDetailItem label={t('control.devices.checksum')}>
                        <Mono size="label" title={effectiveSelectedRelease.sha256}>
                          {effectiveSelectedRelease.sha256 ? `${effectiveSelectedRelease.sha256.slice(0, 16)}…` : '—'}
                        </Mono>
                      </CardDetailItem>
                      <CardDetailItem label={t('control.devices.releaseDate')}>
                        <Text size="body">{formatRelativeTime(t, effectiveSelectedRelease.createdAt)}</Text>
                      </CardDetailItem>
                    </CardDetail>

                    {effectiveSelectedRelease.releaseNotes && (
                      <Stack gap="xs">
                        <Text size="label" weight="medium">{t('control.devices.releaseNotes')}</Text>
                        <Text size="body" tone="muted">{effectiveSelectedRelease.releaseNotes}</Text>
                      </Stack>
                    )}
                  </Stack>
                </Panel>
              )}

              <Inline gap="sm" style={{ justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => setDownloadModalOpen(false)}>
                  {t('common.cancel')}
                </Button>
                {effectiveSelectedRelease && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      handleDownloadRelease(effectiveSelectedRelease);
                    }}
                  >
                    {t('control.devices.downloadVersion').replace('{version}', effectiveSelectedRelease.version)}
                  </Button>
                )}
              </Inline>
            </>
          )}
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
