import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, triggerDirectDownload } from '../api/client.js';
import { compareVersions } from '@printerops/domain';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import {
  Alert,
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
import type { DeviceListItem } from './WebControlDevices.js';

interface ReleaseItem {
  id: string;
  version: string;
  channel: 'stable' | 'beta' | 'rc' | 'lts';
  platform: 'windows-x64' | 'node-bundle';
  architecture: 'x64' | 'arm64';
  schemaVersion: number;
  manifestRef: string;
  artifactRef: string;
  sha256: string;
  signature: string;
  minSupportedVersion: string;
  status: 'AVAILABLE' | 'REVOKED' | 'DEPRECATED';
  createdAt: string;
  releaseNotes?: string;
  isLts?: boolean;
  isLatest?: boolean;
}

interface StorageSettingsData {
  provider: 'local' | 'minio';
  localPath: string;
  minio: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    prefix: string;
    publicUrl?: string;
  };
}

const RELEASES_POLL_MS = 15_000;

export default function WebControlReleases() {
  const { t } = useLocale();

  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  // Register dialog state
  const [formVersion, setFormVersion] = useState('');
  const [formChannel, setFormChannel] = useState<'stable' | 'beta' | 'rc' | 'lts'>('stable');
  const [formPlatform, setFormPlatform] = useState<'windows-x64' | 'node-bundle'>('windows-x64');
  const [formSchemaVersion, setFormSchemaVersion] = useState(8);
  const [formManifestRef, setFormManifestRef] = useState('');
  const [formArtifactRef, setFormArtifactRef] = useState('');
  const [formSha256, setFormSha256] = useState('');
  const [formSignature, setFormSignature] = useState('');
  const [formMinVersion, setFormMinVersion] = useState('0.1.20');
  const [formNotes, setFormNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Import dialog state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBase64, setImportBase64] = useState<string | null>(null);
  const [importVersion, setImportVersion] = useState('');
  const [importChannel, setImportChannel] = useState<'stable' | 'lts' | 'beta' | 'rc'>('stable');
  const [importPlatform, setImportPlatform] = useState<'windows-x64' | 'node-bundle'>('windows-x64');
  const [importIsLts, setImportIsLts] = useState(false);
  const [importIsLatest, setImportIsLatest] = useState(true);
  const [importNotes, setImportNotes] = useState('');
  const [importUrlOrPath, setImportUrlOrPath] = useState('');
  const [importMode, setImportMode] = useState<'file' | 'path'>('file');
  const [importError, setImportError] = useState<string | null>(null);

  // Edit / Designation dialog state
  const [editingRelease, setEditingRelease] = useState<ReleaseItem | null>(null);
  const [editStatus, setEditStatus] = useState<ReleaseItem['status']>('AVAILABLE');
  const [editChannel, setEditChannel] = useState<ReleaseItem['channel']>('stable');
  const [editIsLts, setEditIsLts] = useState(false);
  const [editIsLatest, setEditIsLatest] = useState(false);
  const [editNotes, setEditNotes] = useState('');

  // Storage settings dialog state
  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [storageConfig, setStorageConfig] = useState<StorageSettingsData>({
    provider: 'local',
    localPath: '/data/releases',
    minio: {
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: '',
      secretKey: '',
      bucket: 'printops-releases',
      prefix: '',
      publicUrl: '',
    },
  });
  const [storageTestResult, setStorageTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [storageTesting, setStorageTesting] = useState(false);
  const [storageSaving, setStorageSaving] = useState(false);

  useEffect(() => {
    void apiFetch<StorageSettingsData>('/v1/control/storage-settings')
      .then((data) => { if (data) setStorageConfig(data); })
      .catch(() => { /* default fallback */ });
  }, []);
  const fetchReleases = useCallback(() => apiFetch<ReleaseItem[]>('/v1/control/releases'), []);
  const releasesResource = useApiResource(fetchReleases, { intervalMs: RELEASES_POLL_MS });
  const releases = releasesResource.data ?? [];

  const fetchDevices = useCallback(() => apiFetch<DeviceListItem[]>('/v1/control/devices'), []);
  const devicesResource = useApiResource(fetchDevices, { intervalMs: RELEASES_POLL_MS });
  const devices = devicesResource.data ?? [];

  // Compute deployment count per version
  const deploymentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of devices) {
      const count = map.get(d.appVersion) ?? 0;
      map.set(d.appVersion, count + 1);
    }
    return map;
  }, [devices]);

  const latestAvailableRelease = useMemo(() => {
    const available = releases.filter((r) => r.status === 'AVAILABLE');
    const sorted = available.slice().sort((a, b) => {
      const diff = compareVersions(b.version, a.version);
      return diff ?? 0;
    });
    return sorted[0] ?? null;
  }, [releases]);

  const handleDownloadRelease = (release: ReleaseItem) => {
    const filename = `PrintOps_Setup_v${release.version}_${release.platform}.exe`;
    setDownloadNotice(t('control.downloadNotice')
      .replace('{version}', release.version)
      .replace('{filename}', filename));
    triggerDirectDownload(`/v1/control/releases/${release.id}/download`, filename);
  };

  const handleRegister = async () => {
    setIsSubmitting(true);
    setRegisterError(null);
    try {
      await apiFetch('/v1/control/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: formVersion,
          channel: formChannel,
          platform: formPlatform,
          schemaVersion: formSchemaVersion,
          manifestRef: formManifestRef,
          artifactRef: formArtifactRef,
          sha256: formSha256,
          signature: formSignature,
          minSupportedVersion: formMinVersion,
          releaseNotes: formNotes,
        }),
      });
      setRegisterModalOpen(false);
      releasesResource.refresh();
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    const match = file.name.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);
    if (match && !importVersion) {
      setImportVersion(match[1]);
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.split(',')[1] ?? res;
      setImportBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleImportRelease = async () => {
    setIsSubmitting(true);
    setImportError(null);
    try {
      await apiFetch('/v1/control/releases/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: importFile?.name || (importUrlOrPath ? importUrlOrPath.split(/[/\\]/).pop() : undefined),
          artifactBase64: importBase64 ?? undefined,
          artifactPath: importMode === 'path' && !importUrlOrPath.startsWith('http') ? importUrlOrPath : undefined,
          artifactUrl: importMode === 'path' && importUrlOrPath.startsWith('http') ? importUrlOrPath : undefined,
          version: importVersion,
          channel: importIsLts ? 'lts' : importChannel,
          platform: importPlatform,
          isLts: importIsLts,
          isLatest: importIsLatest,
          releaseNotes: importNotes || undefined,
        }),
      });
      setImportModalOpen(false);
      setImportFile(null);
      setImportBase64(null);
      setImportVersion('');
      setImportNotes('');
      setImportUrlOrPath('');
      releasesResource.refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetLatest = async (release: ReleaseItem) => {
    try {
      await apiFetch(`/v1/control/releases/${release.id}/set-latest`, { method: 'POST' });
      releasesResource.refresh();
    } catch (err) {
      setDownloadNotice(`Failed to set latest: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleLts = async (release: ReleaseItem) => {
    try {
      const nextLts = !release.isLts;
      await apiFetch(`/v1/control/releases/${release.id}/set-lts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLts: nextLts }),
      });
      releasesResource.refresh();
    } catch (err) {
      setDownloadNotice(`Failed to update LTS: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenEdit = (release: ReleaseItem) => {
    setEditingRelease(release);
    setEditStatus(release.status);
    setEditChannel(release.channel);
    setEditIsLts(Boolean(release.isLts || release.channel === 'lts'));
    setEditIsLatest(Boolean(release.isLatest));
    setEditNotes(release.releaseNotes ?? '');
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingRelease) return;
    setIsSubmitting(true);
    try {
      await apiFetch(`/v1/control/releases/${editingRelease.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus,
          channel: editChannel,
          isLts: editIsLts,
          isLatest: editIsLatest,
          releaseNotes: editNotes,
        }),
      });
      setEditModalOpen(false);
      setEditingRelease(null);
      releasesResource.refresh();
    } catch (err) {
      setDownloadNotice(`Failed to save release: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (release: ReleaseItem) => {
    const nextStatus = release.status === 'AVAILABLE' ? 'REVOKED' : 'AVAILABLE';
    try {
      await apiFetch(`/v1/control/releases/${release.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      releasesResource.refresh();
    } catch {
      // handled
    }
  };

  const handleOpenStorageModal = async () => {
    setStorageTestResult(null);
    setStorageModalOpen(true);
    try {
      const data = await apiFetch<StorageSettingsData>('/v1/control/storage-settings');
      if (data) setStorageConfig(data);
    } catch {
      // retain local
    }
  };

  const handleTestStorage = async () => {
    setStorageTesting(true);
    setStorageTestResult(null);
    try {
      const result = await apiFetch<{ ok: boolean; message: string }>('/v1/control/storage-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storageConfig),
      });
      setStorageTestResult(result);
    } catch (err) {
      setStorageTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setStorageTesting(false);
    }
  };

  const handleSaveStorage = async () => {
    setStorageSaving(true);
    try {
      const updated = await apiFetch<StorageSettingsData>('/v1/control/storage-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storageConfig),
      });
      setStorageConfig(updated);
      setStorageModalOpen(false);
      setDownloadNotice('Storage settings saved successfully.');
    } catch (err) {
      setStorageTestResult({ ok: false, message: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setStorageSaving(false);
    }
  };

  return (
    <PageLayout
      title="PrintOps Client Releases"
      density="compact"
      width="full"
      actions={
        <Inline gap="md">
          {latestAvailableRelease && (
            <Button
              variant="primary"
              onClick={() => handleDownloadRelease(latestAvailableRelease)}
            >
              {t('control.releases.downloadLatest')} (v{latestAvailableRelease.version})
            </Button>
          )}
          <Button variant="primary" onClick={() => { setImportError(null); setImportModalOpen(true); }}>
            {t('control.releases.importApp')}
          </Button>
          <Button variant="secondary" onClick={() => { setRegisterError(null); setRegisterModalOpen(true); }}>
            Register Signed Release
          </Button>
          <Button variant="secondary" onClick={handleOpenStorageModal}>
            {t('control.storage.button')}
          </Button>
          <Freshness
            lastSuccessAt={releasesResource.lastSuccessAt}
            stale={releasesResource.stale}
            refreshing={releasesResource.refreshing}
            paused={releasesResource.paused}
            onRefresh={() => { releasesResource.refresh(); devicesResource.refresh(); }}
          />
        </Inline>
      }
    >
      <Inline gap="md" style={{ alignItems: 'center' }}>
        <Text size="body" tone="muted">
          Web Control manages software releases for enrolled PrintOps clients. Versions in this catalog belong to PrintOps releases, not Web Control.
        </Text>
        {latestAvailableRelease?.version && (
          <Badge tone="neutral">
            {t('control.releases.latestAppRelease').replace('{version}', latestAvailableRelease.version)}
          </Badge>
        )}
        <Badge tone={storageConfig.provider === 'minio' ? 'info' : 'neutral'}>
          Storage: {storageConfig.provider === 'minio' ? `MinIO (${storageConfig.minio.bucket})` : `Local (${storageConfig.localPath})`}
        </Badge>
      </Inline>
      {downloadNotice && (
        <Alert tone="info" onDismiss={() => setDownloadNotice(null)}>
          {downloadNotice}
        </Alert>
      )}
      {releasesResource.stale && releasesResource.error != null && (
        <ErrorBanner error={releasesResource.error} onRetry={releasesResource.refresh} />
      )}

      {releasesResource.loading && !releasesResource.data ? (
        <LoadingState />
      ) : releasesResource.error != null && !releasesResource.data ? (
        <ErrorState error={releasesResource.error} onRetry={releasesResource.refresh} />
      ) : releases.length === 0 ? (
        <EmptyState title="No releases registered in catalog yet" />
      ) : (
        <DataTable label="Release Catalog" responsive>
          <thead>
            <tr>
              <DataHead>Version</DataHead>
              <DataHead>Platform</DataHead>
              <DataHead>Channel</DataHead>
              <DataHead>Schema Version</DataHead>
              <DataHead>Signature / Provenance</DataHead>
              <DataHead>Status</DataHead>
              <DataHead>Device Deployments</DataHead>
              <DataHead>Created</DataHead>
              <DataHead>Action</DataHead>
            </tr>
          </thead>
          <tbody>
            {releases.map((rel) => {
              const statusTone = rel.status === 'AVAILABLE' ? 'success' : 'danger';
              const deployed = deploymentCounts.get(rel.version) ?? 0;
              return (
                <tr key={rel.id}>
                  <DataCell>
                    <Stack gap="xs">
                      <Inline gap="xs" style={{ alignItems: 'center' }}>
                        <Mono size="body" weight="semibold">v{rel.version}</Mono>
                        {rel.isLatest && <Badge tone="success">LATEST</Badge>}
                        {(rel.isLts || rel.channel === 'lts') && <Badge tone="info">LTS</Badge>}
                      </Inline>
                      {rel.releaseNotes && <Text size="label" tone="muted">{rel.releaseNotes}</Text>}
                    </Stack>
                  </DataCell>
                  <DataCell><Mono size="body">{rel.platform}</Mono></DataCell>
                  <DataCell>
                    <Badge tone={rel.channel === 'lts' ? 'info' : rel.channel === 'stable' ? 'neutral' : 'warning'}>
                      {rel.channel}
                    </Badge>
                  </DataCell>
                  <DataCell><Mono size="body">v{rel.schemaVersion}</Mono></DataCell>
                  <DataCell>
                    <Stack gap="xs">
                      <Badge tone="success">Verified Ed25519</Badge>
                      <Mono size="label" tone="muted" title={rel.sha256}>
                        {rel.sha256.slice(0, 12)}…
                      </Mono>
                    </Stack>
                  </DataCell>
                  <DataCell>
                    <Badge tone={statusTone}>{rel.status}</Badge>
                  </DataCell>
                  <DataCell>
                    <Inline gap="xs">
                      <Text size="body" weight="semibold">{deployed}</Text>
                      <Text size="label" tone="muted">device{deployed === 1 ? '' : 's'}</Text>
                    </Inline>
                  </DataCell>
                  <DataCell>
                    <Text size="label" tone="muted">{formatRelativeTime(t, rel.createdAt)}</Text>
                  </DataCell>
                  <DataCell>
                    <Inline gap="xs" style={{ flexWrap: 'wrap' }}>
                      {rel.status === 'AVAILABLE' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDownloadRelease(rel)}
                          title={`${t('control.releases.downloadApp')} v${rel.version}`}
                        >
                          {t('common.download')}
                        </Button>
                      )}
                      {rel.status === 'AVAILABLE' && !rel.isLatest && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSetLatest(rel)}
                          title={t('control.releases.setLatest')}
                        >
                          {t('control.releases.setLatest')}
                        </Button>
                      )}
                      {rel.status === 'AVAILABLE' && (
                        <Button
                          size="sm"
                          variant={rel.isLts ? 'primary' : 'secondary'}
                          onClick={() => handleToggleLts(rel)}
                          title={rel.isLts ? t('control.releases.unsetLts') : t('control.releases.setLts')}
                        >
                          {rel.isLts ? 'LTS: ON' : t('control.releases.setLts')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenEdit(rel)}
                      >
                        {t('control.releases.manage')}
                      </Button>
                      <Button
                        size="sm"
                        variant={rel.status === 'AVAILABLE' ? 'danger' : 'secondary'}
                        onClick={() => handleToggleStatus(rel)}
                      >
                        {rel.status === 'AVAILABLE' ? 'Revoke' : 'Activate'}
                      </Button>
                    </Inline>
                  </DataCell>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}

      {/* Register Release Dialog */}
      <Dialog
        open={registerModalOpen}
        onClose={() => !isSubmitting && setRegisterModalOpen(false)}
        title="Register Signed Release"
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            Register a signed PrintOps release in the catalog. Releases must be cryptographically signed by the offline release key.
          </Text>

          {registerError && (
            <Alert tone="error" title="Registration Failed">
              {registerError}
            </Alert>
          )}

          <Stack gap="md">
            <Inline gap="md">
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text size="label" weight="medium">Version (SemVer)</Text>
                <Input placeholder="0.1.29" value={formVersion} onChange={(e) => setFormVersion(e.target.value)} />
              </Stack>
              <Stack gap="xs" style={{ width: '140px' }}>
                <Text size="label" weight="medium">Channel</Text>
                <Select value={formChannel} onChange={(e) => setFormChannel(e.target.value as 'stable' | 'beta' | 'rc')}>
                  <option value="stable">stable</option>
                  <option value="beta">beta</option>
                  <option value="rc">rc</option>
                </Select>
              </Stack>
            </Inline>

            <Inline gap="md">
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text size="label" weight="medium">Platform</Text>
                <Select value={formPlatform} onChange={(e) => setFormPlatform(e.target.value as 'windows-x64' | 'node-bundle')}>
                  <option value="windows-x64">windows-x64</option>
                  <option value="node-bundle">node-bundle</option>
                </Select>
              </Stack>
              <Stack gap="xs" style={{ width: '140px' }}>
                <Text size="label" weight="medium">Schema Version</Text>
                <Input type="number" value={formSchemaVersion} onChange={(e) => setFormSchemaVersion(Number(e.target.value))} />
              </Stack>
            </Inline>

            <Stack gap="xs">
              <Text size="label" weight="medium">Manifest URL / Reference</Text>
              <Input placeholder="https://releases.local/v0.1.29/manifest.json" value={formManifestRef} onChange={(e) => setFormManifestRef(e.target.value)} />
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="medium">Artifact URL / Reference</Text>
              <Input placeholder="https://releases.local/v0.1.29/setup.exe" value={formArtifactRef} onChange={(e) => setFormArtifactRef(e.target.value)} />
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="medium">SHA-256 Checksum</Text>
              <Input placeholder="64-character hex hash" value={formSha256} onChange={(e) => setFormSha256(e.target.value)} />
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="medium">Ed25519 Cryptographic Signature</Text>
              <Input placeholder="base64 / hex signature string" value={formSignature} onChange={(e) => setFormSignature(e.target.value)} />
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="medium">Minimum Supported Version</Text>
              <Input placeholder="0.1.20" value={formMinVersion} onChange={(e) => setFormMinVersion(e.target.value)} />
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="medium">Release Notes</Text>
              <Input placeholder="Summary of changes" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
            </Stack>

            <Inline gap="xs">
              <Button variant="ghost" disabled={isSubmitting} onClick={() => setRegisterModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={isSubmitting || !formVersion || !formManifestRef || !formArtifactRef || !formSha256 || !formSignature}
                onClick={handleRegister}
              >
                {isSubmitting ? 'Registering…' : 'Register Release'}
              </Button>
            </Inline>
          </Stack>
        </Stack>
      </Dialog>

      {/* Import / Upload PrintOps App Dialog */}
      <Dialog
        open={importModalOpen}
        onClose={() => !isSubmitting && setImportModalOpen(false)}
        title={t('control.releases.importTitle')}
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            {t('control.releases.importDesc')}
          </Text>

          {importError && (
            <Alert tone="error" title="Import Failed">
              {importError}
            </Alert>
          )}

          <Stack gap="md">
            <Inline gap="md">
              <Button
                size="sm"
                variant={importMode === 'file' ? 'primary' : 'secondary'}
                onClick={() => setImportMode('file')}
              >
                Upload File (.exe / .tar.gz)
              </Button>
              <Button
                size="sm"
                variant={importMode === 'path' ? 'primary' : 'secondary'}
                onClick={() => setImportMode('path')}
              >
                Path / Remote URL
              </Button>
            </Inline>

            {importMode === 'file' ? (
              <Stack gap="xs">
                <Text size="label" weight="medium">Installer File</Text>
                <input
                  type="file"
                  accept=".exe,.tar.gz,.zip,.msi"
                  onChange={handleFileChange}
                  style={{
                    padding: '8px',
                    border: '1px dashed var(--color-border, #cbd5e1)',
                    borderRadius: '6px',
                    background: 'var(--color-bg-subtle, #f8fafc)',
                  }}
                />
                {importFile && (
                  <Text size="label" tone="muted">
                    Selected: {importFile.name} ({(importFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </Text>
                )}
              </Stack>
            ) : (
              <Stack gap="xs">
                <Text size="label" weight="medium">Server File Path or HTTPS URL</Text>
                <Input
                  placeholder="e.g. C:/dist/PrintOps_Setup_v0.1.32_windows-x64.exe or https://cdn.example.com/setup.exe"
                  value={importUrlOrPath}
                  onChange={(e) => {
                    setImportUrlOrPath(e.target.value);
                    const match = e.target.value.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);
                    if (match && !importVersion) setImportVersion(match[1]);
                  }}
                />
              </Stack>
            )}

            <Inline gap="md">
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text size="label" weight="medium">Version (SemVer)</Text>
                <Input
                  placeholder="e.g. 0.1.32"
                  value={importVersion}
                  onChange={(e) => setImportVersion(e.target.value)}
                />
              </Stack>
              <Stack gap="xs" style={{ width: '140px' }}>
                <Text size="label" weight="medium">Channel</Text>
                <Select
                  value={importIsLts ? 'lts' : importChannel}
                  onChange={(e) => {
                    const ch = e.target.value as 'stable' | 'lts' | 'beta' | 'rc';
                    setImportChannel(ch);
                    if (ch === 'lts') setImportIsLts(true);
                  }}
                >
                  <option value="stable">stable</option>
                  <option value="lts">lts</option>
                  <option value="beta">beta</option>
                  <option value="rc">rc</option>
                </Select>
              </Stack>
            </Inline>

            <Inline gap="md">
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text size="label" weight="medium">Platform</Text>
                <Select
                  value={importPlatform}
                  onChange={(e) => setImportPlatform(e.target.value as 'windows-x64' | 'node-bundle')}
                >
                  <option value="windows-x64">windows-x64</option>
                  <option value="node-bundle">node-bundle</option>
                </Select>
              </Stack>
            </Inline>

            <Stack gap="sm" style={{ padding: '8px 12px', background: 'var(--color-bg-subtle, #f8fafc)', borderRadius: '6px' }}>
              <Text size="label" weight="semibold">Designations</Text>
              <Inline gap="lg">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                  <input
                    type="checkbox"
                    checked={importIsLatest}
                    onChange={(e) => setImportIsLatest(e.target.checked)}
                  />
                  <strong>Set as LATEST</strong> (Recommended target for stations)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                  <input
                    type="checkbox"
                    checked={importIsLts}
                    onChange={(e) => {
                      setImportIsLts(e.target.checked);
                      if (e.target.checked) setImportChannel('lts');
                    }}
                  />
                  <strong>Set as LTS</strong> (Long-Term Support track)
                </label>
              </Inline>
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="medium">Release Notes</Text>
              <Input
                placeholder="Key features, bug fixes, or deployment guidelines"
                value={importNotes}
                onChange={(e) => setImportNotes(e.target.value)}
              />
            </Stack>

            <Inline gap="xs" style={{ justifyContent: 'flex-end' }}>
              <Button variant="ghost" disabled={isSubmitting} onClick={() => setImportModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={isSubmitting || !importVersion || (importMode === 'file' ? !importFile : !importUrlOrPath.trim())}
                onClick={handleImportRelease}
              >
                {isSubmitting ? 'Importing…' : 'Import Release'}
              </Button>
            </Inline>
          </Stack>
        </Stack>
      </Dialog>

      {/* Edit Release Designation Dialog */}
      <Dialog
        open={editModalOpen}
        onClose={() => !isSubmitting && setEditModalOpen(false)}
        title={t('control.releases.editTitle')}
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            Update release status, channel, and LTS / Latest designations for PrintOps v{editingRelease?.version}.
          </Text>

          <Stack gap="md">
            <Inline gap="md">
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text size="label" weight="medium">Channel</Text>
                <Select
                  value={editChannel}
                  onChange={(e) => {
                    const ch = e.target.value as 'stable' | 'beta' | 'rc' | 'lts';
                    setEditChannel(ch);
                    if (ch === 'lts') setEditIsLts(true);
                  }}
                >
                  <option value="stable">stable</option>
                  <option value="lts">lts</option>
                  <option value="beta">beta</option>
                  <option value="rc">rc</option>
                </Select>
              </Stack>
              <Stack gap="xs" style={{ flex: 1 }}>
                <Text size="label" weight="medium">Status</Text>
                <Select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as ReleaseItem['status'])}
                >
                  <option value="AVAILABLE">AVAILABLE</option>
                  <option value="DEPRECATED">DEPRECATED</option>
                  <option value="REVOKED">REVOKED</option>
                </Select>
              </Stack>
            </Inline>

            <Stack gap="sm" style={{ padding: '8px 12px', background: 'var(--color-bg-subtle, #f8fafc)', borderRadius: '6px' }}>
              <Text size="label" weight="semibold">Designations</Text>
              <Inline gap="lg">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                  <input
                    type="checkbox"
                    checked={editIsLatest}
                    onChange={(e) => setEditIsLatest(e.target.checked)}
                  />
                  <strong>Set as LATEST</strong>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                  <input
                    type="checkbox"
                    checked={editIsLts}
                    onChange={(e) => {
                      setEditIsLts(e.target.checked);
                      if (e.target.checked) setEditChannel('lts');
                    }}
                  />
                  <strong>Set as LTS</strong>
                </label>
              </Inline>
            </Stack>

            <Stack gap="xs">
              <Text size="label" weight="medium">Release Notes</Text>
              <Input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </Stack>

            <Inline gap="xs" style={{ justifyContent: 'flex-end' }}>
              <Button variant="ghost" disabled={isSubmitting} onClick={() => setEditModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" disabled={isSubmitting} onClick={handleSaveEdit}>
                {isSubmitting ? 'Saving…' : 'Save Changes'}
              </Button>
            </Inline>
          </Stack>
        </Stack>
      </Dialog>

      {/* Storage Settings Dialog */}
      <Dialog
        open={storageModalOpen}
        onClose={() => !storageSaving && setStorageModalOpen(false)}
        title={t('control.storage.title')}
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            {t('control.storage.desc')}
          </Text>

          {storageTestResult && (
            <Alert tone={storageTestResult.ok ? 'success' : 'error'} title={storageTestResult.ok ? 'Connection Verified' : 'Connection Failed'}>
              {storageTestResult.message}
            </Alert>
          )}

          <Stack gap="md">
            <Stack gap="xs">
              <Text size="label" weight="medium">{t('control.storage.provider')}</Text>
              <Inline gap="md">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="storage-provider"
                    value="minio"
                    checked={storageConfig.provider === 'minio'}
                    onChange={() => setStorageConfig({ ...storageConfig, provider: 'minio' })}
                  />
                  <strong>{t('control.storage.minio')}</strong>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="storage-provider"
                    value="local"
                    checked={storageConfig.provider === 'local'}
                    onChange={() => setStorageConfig({ ...storageConfig, provider: 'local' })}
                  />
                  <span>{t('control.storage.local')}</span>
                </label>
              </Inline>
              <Text size="body" tone="muted">{t('control.storage.providerHelp')}</Text>
              <Text size="body" tone="muted">
                {storageConfig.provider === 'local'
                  ? t('control.storage.localHelp')
                  : t('control.storage.minioHelp')}
              </Text>
            </Stack>

            {storageConfig.provider === 'local' ? (
              <Stack gap="xs">
                <Text size="label" weight="medium">{t('control.storage.localPath')}</Text>
                <Input
                  placeholder="/data/releases"
                  value={storageConfig.localPath}
                  onChange={(e) => setStorageConfig({ ...storageConfig, localPath: e.target.value })}
                />
                <Text size="label" tone="muted">
                  Path on the Web Control server host/container where release binaries are saved.
                </Text>
              </Stack>
            ) : (
              <>
                <Inline gap="md">
                  <Stack gap="xs" style={{ flex: 2 }}>
                    <Text size="label" weight="medium">{t('control.storage.endpoint')}</Text>
                    <Input
                      placeholder="minio or localhost"
                      value={storageConfig.minio.endPoint}
                      onChange={(e) => setStorageConfig({
                        ...storageConfig,
                        minio: { ...storageConfig.minio, endPoint: e.target.value },
                      })}
                    />
                  </Stack>
                  <Stack gap="xs" style={{ width: '120px' }}>
                    <Text size="label" weight="medium">{t('control.storage.port')}</Text>
                    <Input
                      type="number"
                      value={storageConfig.minio.port}
                      onChange={(e) => setStorageConfig({
                        ...storageConfig,
                        minio: { ...storageConfig.minio, port: Number(e.target.value) || 9000 },
                      })}
                    />
                  </Stack>
                </Inline>

                <Inline gap="md">
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Text size="label" weight="medium">{t('control.storage.bucket')}</Text>
                    <Input
                      placeholder="printops-releases"
                      value={storageConfig.minio.bucket}
                      onChange={(e) => setStorageConfig({
                        ...storageConfig,
                        minio: { ...storageConfig.minio, bucket: e.target.value },
                      })}
                    />
                  </Stack>
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Text size="label" weight="medium">{t('control.storage.prefix')}</Text>
                    <Input
                      placeholder="releases/"
                      value={storageConfig.minio.prefix}
                      onChange={(e) => setStorageConfig({
                        ...storageConfig,
                        minio: { ...storageConfig.minio, prefix: e.target.value },
                      })}
                    />
                  </Stack>
                </Inline>

                <Inline gap="md">
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Text size="label" weight="medium">{t('control.storage.accessKey')}</Text>
                    <Input
                      value={storageConfig.minio.accessKey}
                      onChange={(e) => setStorageConfig({
                        ...storageConfig,
                        minio: { ...storageConfig.minio, accessKey: e.target.value },
                      })}
                    />
                  </Stack>
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Text size="label" weight="medium">{t('control.storage.secretKey')}</Text>
                    <Input
                      type="password"
                      value={storageConfig.minio.secretKey}
                      onChange={(e) => setStorageConfig({
                        ...storageConfig,
                        minio: { ...storageConfig.minio, secretKey: e.target.value },
                      })}
                    />
                  </Stack>
                </Inline>

                <Inline gap="lg">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="checkbox"
                      checked={storageConfig.minio.useSSL}
                      onChange={(e) => setStorageConfig({
                        ...storageConfig,
                        minio: { ...storageConfig.minio, useSSL: e.target.checked },
                      })}
                    />
                    <span>{t('control.storage.useSSL')}</span>
                  </label>
                </Inline>

                <Stack gap="xs">
                  <Text size="label" weight="medium">{t('control.storage.publicUrl')}</Text>
                  <Input
                    placeholder="http://localhost:9000/printops-releases"
                    value={storageConfig.minio.publicUrl || ''}
                    onChange={(e) => setStorageConfig({
                      ...storageConfig,
                      minio: { ...storageConfig.minio, publicUrl: e.target.value },
                    })}
                  />
                </Stack>
              </>
            )}

            <Inline gap="xs" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
              <Button
                variant="secondary"
                disabled={storageTesting || storageSaving}
                busy={storageTesting}
                busyLabel={t('control.storage.testing')}
                onClick={handleTestStorage}
              >
                {t('control.storage.test')}
              </Button>
              <Inline gap="xs">
                <Button variant="ghost" disabled={storageSaving} onClick={() => setStorageModalOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={storageSaving}
                  busy={storageSaving}
                  busyLabel={t('control.storage.saving')}
                  onClick={handleSaveStorage}
                >
                  {t('control.storage.save')}
                </Button>
              </Inline>
            </Inline>
          </Stack>
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
