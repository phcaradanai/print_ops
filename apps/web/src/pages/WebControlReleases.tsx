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
  Checkbox,
  DataCell,
  DataHead,
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
  RowActionMenu,
  Select,
  Stack,
  Tab,
  TabList,
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
  const [editError, setEditError] = useState<string | null>(null);

  // Edit / Designation dialog state
  const [editingRelease, setEditingRelease] = useState<ReleaseItem | null>(null);
  const [editStatus, setEditStatus] = useState<ReleaseItem['status']>('AVAILABLE');
  const [editChannel, setEditChannel] = useState<ReleaseItem['channel']>('stable');
  const [editIsLts, setEditIsLts] = useState(false);
  const [editIsLatest, setEditIsLatest] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<ReleaseItem | null>(null);

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
      setDownloadNotice(t('control.releases.setLatestFailed').replace('{message}', err instanceof Error ? err.message : String(err)));
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
      setDownloadNotice(t('control.releases.setLtsFailed').replace('{message}', err instanceof Error ? err.message : String(err)));
    }
  };

  const handleOpenEdit = (release: ReleaseItem) => {
    setEditingRelease(release);
    setEditStatus(release.status);
    setEditChannel(release.channel);
    setEditIsLts(Boolean(release.isLts || release.channel === 'lts'));
    setEditIsLatest(Boolean(release.isLatest));
    setEditNotes(release.releaseNotes ?? '');
    setEditError(null);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingRelease) return;
    setIsSubmitting(true);
    setEditError(null);
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
      setEditError(t('control.releases.saveFailed').replace('{message}', err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  const setReleaseStatus = async (release: ReleaseItem, status: ReleaseItem['status']) => {
    try {
      await apiFetch(`/v1/control/releases/${release.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      releasesResource.refresh();
    } catch (err) {
      setDownloadNotice(t('control.releases.statusFailed').replace('{message}', err instanceof Error ? err.message : String(err)));
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;
    setIsSubmitting(true);
    await setReleaseStatus(revokeTarget, 'REVOKED');
    setIsSubmitting(false);
    setRevokeTarget(null);
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
      setDownloadNotice(t('control.releases.storageSaved'));
    } catch (err) {
      setStorageTestResult({ ok: false, message: t('control.releases.storageSaveFailed').replace('{message}', err instanceof Error ? err.message : String(err)) });
    } finally {
      setStorageSaving(false);
    }
  };

  return (
    <PageLayout
      title={t('control.releases.title')}
      description={t('control.releases.subtitle')}
      density="compact"
      width="full"
      actions={
        <Inline gap="md">
          {latestAvailableRelease && (
            <Button
              variant="secondary"
              onClick={() => handleDownloadRelease(latestAvailableRelease)}
            >
              {t('control.releases.downloadLatest')} (v{latestAvailableRelease.version})
            </Button>
          )}
          <Button variant="secondary" onClick={handleOpenStorageModal}>
            {t('control.storage.button')}
          </Button>
          <Button variant="secondary" onClick={() => { setRegisterError(null); setRegisterModalOpen(true); }}>
            {t('control.releases.registerRelease')}
          </Button>
          <Button variant="primary" onClick={() => { setImportError(null); setImportModalOpen(true); }}>
            {t('control.releases.importApp')}
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
      <Inline gap="md">
        <Text size="body" tone="muted">
          {t('control.releases.intro')}
        </Text>
        {latestAvailableRelease?.version && (
          <Badge tone="neutral">
            {t('control.releases.latestAppRelease').replace('{version}', latestAvailableRelease.version)}
          </Badge>
        )}
        <Badge className="ui-badge--wrap" tone={storageConfig.provider === 'minio' ? 'info' : 'neutral'}>
          {t('control.releases.storageSummary').replace('{detail}', storageConfig.provider === 'minio' ? `MinIO (${storageConfig.minio.bucket})` : `Local (${storageConfig.localPath})`)}
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
        <EmptyState title={t('control.releases.noReleases')} />
      ) : (
        <DataTable label={t('control.releases.catalogLabel')} responsive>
          <thead>
            <tr>
              <DataHead>{t('control.releases.colVersion')}</DataHead>
              <DataHead>{t('control.releases.platform')}</DataHead>
              <DataHead>{t('control.releases.channel')}</DataHead>
              <DataHead>{t('control.releases.schemaVersion')}</DataHead>
              <DataHead>{t('control.releases.colSignatureProvenance')}</DataHead>
              <DataHead>{t('control.releases.colStatus')}</DataHead>
              <DataHead>{t('control.releases.colDeployments')}</DataHead>
              <DataHead>{t('control.releases.colCreated')}</DataHead>
              <DataHead>{t('control.releases.colAction')}</DataHead>
            </tr>
          </thead>
          <tbody>
            {releases.map((rel) => {
              const statusTone = rel.status === 'AVAILABLE' ? 'success' : 'danger';
              const deployed = deploymentCounts.get(rel.version) ?? 0;
              return (
                <tr key={rel.id}>
                  <DataCell label={t('control.releases.colVersion')}>
                    <Stack gap="xs">
                      <Inline gap="xs" style={{ alignItems: 'center' }}>
                        <Mono size="body" weight="semibold">v{rel.version}</Mono>
                        {rel.isLatest && <Badge tone="success">{t('control.releases.latestBadge')}</Badge>}
                        {(rel.isLts || rel.channel === 'lts') && <Badge tone="info">LTS</Badge>}
                      </Inline>
                      {rel.releaseNotes && <Text size="label" tone="muted">{rel.releaseNotes}</Text>}
                    </Stack>
                  </DataCell>
                  <DataCell label={t('control.releases.platform')}><Mono size="body">{rel.platform}</Mono></DataCell>
                  <DataCell label={t('control.releases.channel')}>
                    <Badge tone={rel.channel === 'lts' ? 'info' : rel.channel === 'stable' ? 'neutral' : 'warning'}>
                      {rel.channel}
                    </Badge>
                  </DataCell>
                  <DataCell label={t('control.releases.schemaVersion')}><Mono size="body">v{rel.schemaVersion}</Mono></DataCell>
                  <DataCell label={t('control.releases.colSignatureProvenance')}>
                    <Stack gap="xs">
                      <Mono size="label" tone="muted" title={rel.sha256}>
                        {rel.sha256.slice(0, 12)}…
                      </Mono>
                    </Stack>
                  </DataCell>
                  <DataCell label={t('control.releases.colStatus')}>
                    <Badge tone={statusTone}>{rel.status}</Badge>
                  </DataCell>
                  <DataCell label={t('control.releases.colDeployments')}>
                    <Inline gap="xs">
                      <Text size="body" weight="semibold">{deployed}</Text>
                      <Text size="label" tone="muted">{t(deployed === 1 ? 'control.releases.deviceOne' : 'control.releases.deviceMany')}</Text>
                    </Inline>
                  </DataCell>
                  <DataCell label={t('control.releases.colCreated')}>
                    <Text size="label" tone="muted">{formatRelativeTime(t, rel.createdAt)}</Text>
                  </DataCell>
                  <DataCell label={t('control.releases.colAction')}>
                    <Inline gap="xs">
                      <Button size="sm" variant="secondary" onClick={() => handleOpenEdit(rel)}>
                        {t('control.releases.manage')}
                      </Button>
                      <RowActionMenu
                        label={t('control.releases.rowActions').replace('{version}', rel.version)}
                        items={rel.status === 'AVAILABLE' ? [
                          { id: 'download', label: `${t('control.releases.downloadApp')} v${rel.version}`, onSelect: () => handleDownloadRelease(rel) },
                          ...(rel.isLatest ? [] : [{ id: 'latest', label: t('control.releases.setLatest'), onSelect: () => void handleSetLatest(rel) }]),
                          { id: 'lts', label: rel.isLts ? t('control.releases.unsetLts') : t('control.releases.setLts'), onSelect: () => void handleToggleLts(rel) },
                          { id: 'revoke', label: t('control.releases.revoke'), danger: true, onSelect: () => setRevokeTarget(rel) },
                        ] : [
                          { id: 'activate', label: t('control.releases.activate'), onSelect: () => void setReleaseStatus(rel, 'AVAILABLE') },
                        ]}
                      />
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
        title={t('control.releases.registerRelease')}
        footer={<>
          <Button variant="secondary" disabled={isSubmitting} onClick={() => setRegisterModalOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={isSubmitting || !formVersion || !formManifestRef || !formArtifactRef || !formSha256 || !formSignature}
            onClick={handleRegister}
          >
            {isSubmitting ? t('control.releases.registering') : t('control.releases.registerSubmit')}
          </Button>
        </>}
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            {t('control.releases.registerDesc')}
          </Text>

          {registerError && (
            <Alert tone="error" title={t('control.releases.registerFailedTitle')}>
              {registerError}
            </Alert>
          )}

          <Stack gap="md">
            <Grid columns={2} gap="md">
              <FormField label={t('control.releases.versionLabel')} required>
                {(control) => <Input {...control} placeholder="0.1.29" value={formVersion} onChange={(e) => setFormVersion(e.target.value)} />}
              </FormField>
              <FormField label={t('control.releases.channel')}>
                {(control) => (
                  <Select {...control} value={formChannel} onChange={(e) => setFormChannel(e.target.value as 'stable' | 'beta' | 'rc')}>
                    <option value="stable">stable</option>
                    <option value="beta">beta</option>
                    <option value="rc">rc</option>
                  </Select>
                )}
              </FormField>
              <FormField label={t('control.releases.platform')}>
                {(control) => (
                  <Select {...control} value={formPlatform} onChange={(e) => setFormPlatform(e.target.value as 'windows-x64' | 'node-bundle')}>
                    <option value="windows-x64">windows-x64</option>
                    <option value="node-bundle">node-bundle</option>
                  </Select>
                )}
              </FormField>
              <FormField label={t('control.releases.schemaVersion')}>
                {(control) => <Input {...control} type="number" value={formSchemaVersion} onChange={(e) => setFormSchemaVersion(Number(e.target.value))} />}
              </FormField>
            </Grid>

            <FormField label={t('control.releases.manifestRef')} required>
              {(control) => <Input {...control} placeholder="https://releases.local/v0.1.29/manifest.json" value={formManifestRef} onChange={(e) => setFormManifestRef(e.target.value)} />}
            </FormField>
            <FormField label={t('control.releases.artifactRef')} required>
              {(control) => <Input {...control} placeholder="https://releases.local/v0.1.29/setup.exe" value={formArtifactRef} onChange={(e) => setFormArtifactRef(e.target.value)} />}
            </FormField>
            <FormField label={t('control.releases.sha256Field')} required>
              {(control) => <Input {...control} placeholder="64-character hex hash" value={formSha256} onChange={(e) => setFormSha256(e.target.value)} />}
            </FormField>
            <FormField label={t('control.releases.signatureField')} required>
              {(control) => <Input {...control} placeholder="base64 / hex signature string" value={formSignature} onChange={(e) => setFormSignature(e.target.value)} />}
            </FormField>
            <FormField label={t('control.releases.minSupportedVersion')}>
              {(control) => <Input {...control} placeholder="0.1.20" value={formMinVersion} onChange={(e) => setFormMinVersion(e.target.value)} />}
            </FormField>
            <FormField label={t('control.releases.releaseNotes')}>
              {(control) => <Input {...control} placeholder="Summary of changes" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />}
            </FormField>
          </Stack>
        </Stack>
      </Dialog>

      {/* Import / Upload PrintOps App Dialog */}
      <Dialog
        open={importModalOpen}
        onClose={() => !isSubmitting && setImportModalOpen(false)}
        title={t('control.releases.importTitle')}
        footer={<>
          <Button variant="secondary" disabled={isSubmitting} onClick={() => setImportModalOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={isSubmitting || !importVersion || (importMode === 'file' ? !importFile : !importUrlOrPath.trim())}
            onClick={handleImportRelease}
          >
            {isSubmitting ? t('control.releases.importing') : t('control.releases.importSubmit')}
          </Button>
        </>}
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            {t('control.releases.importDesc')}
          </Text>

          {importError && (
            <Alert tone="error" title={t('control.releases.importFailedTitle')}>
              {importError}
            </Alert>
          )}

          <Stack gap="md">
            <TabList label={t('control.releases.importSource')}>
              <Tab selected={importMode === 'file'} onClick={() => setImportMode('file')}>
                {t('control.releases.uploadModeFile')}
              </Tab>
              <Tab selected={importMode === 'path'} onClick={() => setImportMode('path')}>
                {t('control.releases.uploadModePath')}
              </Tab>
            </TabList>

            {importMode === 'file' ? (
              <FormField
                label={t('control.releases.installerFile')}
                required
                hint={importFile ? t('control.releases.selectedFile').replace('{name}', importFile.name).replace('{size}', (importFile.size / (1024 * 1024)).toFixed(2)) : undefined}
              >
                {(control) => <Input {...control} type="file" accept=".exe,.tar.gz,.zip,.msi" onChange={handleFileChange} />}
              </FormField>
            ) : (
              <FormField label={t('control.releases.pathInput')} required>
                {(control) => (
                  <Input
                    {...control}
                    placeholder="e.g. C:/dist/PrintOps_Setup_v0.1.32_windows-x64.exe or https://cdn.example.com/setup.exe"
                    value={importUrlOrPath}
                    onChange={(e) => {
                      setImportUrlOrPath(e.target.value);
                      const match = e.target.value.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);
                      if (match && !importVersion) setImportVersion(match[1]);
                    }}
                  />
                )}
              </FormField>
            )}

            <Grid columns={2} gap="md">
              <FormField label={t('control.releases.versionLabel')} required>
                {(control) => <Input {...control} placeholder="e.g. 0.1.32" value={importVersion} onChange={(e) => setImportVersion(e.target.value)} />}
              </FormField>
              <FormField label={t('control.releases.channel')}>
                {(control) => (
                  <Select
                    {...control}
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
                )}
              </FormField>
            </Grid>

            <FormField label={t('control.releases.platform')}>
              {(control) => (
                <Select {...control} value={importPlatform} onChange={(e) => setImportPlatform(e.target.value as 'windows-x64' | 'node-bundle')}>
                  <option value="windows-x64">windows-x64</option>
                  <option value="node-bundle">node-bundle</option>
                </Select>
              )}
            </FormField>

            <Stack gap="sm" role="group" aria-label={t('control.releases.designations')}>
              <Text size="label" weight="semibold">{t('control.releases.designations')}</Text>
              <Checkbox
                label={t('control.releases.setAsLatest')}
                description={t('control.releases.setAsLatestHint')}
                checked={importIsLatest}
                onChange={(e) => setImportIsLatest(e.target.checked)}
              />
              <Checkbox
                label={t('control.releases.setAsLts')}
                description={t('control.releases.setAsLtsHint')}
                checked={importIsLts}
                onChange={(e) => {
                  setImportIsLts(e.target.checked);
                  if (e.target.checked) setImportChannel('lts');
                }}
              />
            </Stack>

            <FormField label={t('control.releases.releaseNotes')}>
              {(control) => <Input {...control} placeholder="Key features, bug fixes, or deployment guidelines" value={importNotes} onChange={(e) => setImportNotes(e.target.value)} />}
            </FormField>
          </Stack>
        </Stack>
      </Dialog>

      {/* Edit Release Designation Dialog */}
      <Dialog
        open={editModalOpen}
        onClose={() => !isSubmitting && setEditModalOpen(false)}
        title={t('control.releases.editTitle')}
        footer={<>
          <Button variant="secondary" disabled={isSubmitting} onClick={() => setEditModalOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={isSubmitting} onClick={handleSaveEdit}>
            {isSubmitting ? t('common.saving') : t('control.releases.saveChanges')}
          </Button>
        </>}
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            {t('control.releases.editDesc').replace('{version}', editingRelease?.version ?? '')}
          </Text>

          {editError && <Alert tone="error">{editError}</Alert>}

          <Stack gap="md">
            <Grid columns={2} gap="md">
              <FormField label={t('control.releases.channel')}>
                {(control) => (
                  <Select
                    {...control}
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
                )}
              </FormField>
              <FormField label={t('control.releases.colStatus')}>
                {(control) => (
                  <Select {...control} value={editStatus} onChange={(e) => setEditStatus(e.target.value as ReleaseItem['status'])}>
                    <option value="AVAILABLE">AVAILABLE</option>
                    <option value="DEPRECATED">DEPRECATED</option>
                    <option value="REVOKED">REVOKED</option>
                  </Select>
                )}
              </FormField>
            </Grid>

            <Stack gap="sm" role="group" aria-label={t('control.releases.designations')}>
              <Text size="label" weight="semibold">{t('control.releases.designations')}</Text>
              <Checkbox
                label={t('control.releases.setAsLatest')}
                checked={editIsLatest}
                onChange={(e) => setEditIsLatest(e.target.checked)}
              />
              <Checkbox
                label={t('control.releases.setAsLts')}
                checked={editIsLts}
                onChange={(e) => {
                  setEditIsLts(e.target.checked);
                  if (e.target.checked) setEditChannel('lts');
                }}
              />
            </Stack>

            <FormField label={t('control.releases.releaseNotes')}>
              {(control) => <Input {...control} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />}
            </FormField>
          </Stack>
        </Stack>
      </Dialog>

      {/* Revoke confirmation: a revoked release can no longer be downloaded by stations. */}
      <Dialog
        open={revokeTarget != null}
        onClose={() => !isSubmitting && setRevokeTarget(null)}
        title={t('control.releases.revokeConfirmTitle').replace('{version}', revokeTarget?.version ?? '')}
        dismissOnBackdrop={false}
        footer={<>
          <Button variant="secondary" disabled={isSubmitting} onClick={() => setRevokeTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" busy={isSubmitting} onClick={() => void handleConfirmRevoke()}>
            {t('control.releases.revoke')}
          </Button>
        </>}
      >
        <Text size="body">{t('control.releases.revokeConfirmBody')}</Text>
      </Dialog>

      {/* Storage Settings Dialog */}
      <Dialog
        open={storageModalOpen}
        onClose={() => !storageSaving && setStorageModalOpen(false)}
        title={t('control.storage.title')}
        footer={<>
          <Button
            variant="secondary"
            disabled={storageTesting || storageSaving}
            busy={storageTesting}
            busyLabel={t('control.storage.testing')}
            onClick={handleTestStorage}
          >
            {t('control.storage.test')}
          </Button>
          <Button variant="secondary" disabled={storageSaving} onClick={() => setStorageModalOpen(false)}>
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
        </>}
      >
        <Stack gap="lg">
          <Text size="body" tone="muted">
            {t('control.storage.desc')}
          </Text>

          {storageTestResult && (
            <Alert tone={storageTestResult.ok ? 'success' : 'error'} title={storageTestResult.ok ? t('control.storage.testOk') : t('control.storage.testFailed')}>
              {storageTestResult.message}
            </Alert>
          )}

          <Stack gap="md">
            <FormField
              label={t('control.storage.provider')}
              hint={<>
                {t('control.storage.providerHelp')}{' '}
                {storageConfig.provider === 'local' ? t('control.storage.localHelp') : t('control.storage.minioHelp')}
              </>}
            >
              {(control) => (
                <Select
                  {...control}
                  value={storageConfig.provider}
                  onChange={(e) => setStorageConfig({ ...storageConfig, provider: e.target.value as StorageSettingsData['provider'] })}
                >
                  <option value="local">{t('control.storage.local')}</option>
                  <option value="minio">{t('control.storage.minio')}</option>
                </Select>
              )}
            </FormField>

            {storageConfig.provider === 'local' ? (
              <FormField label={t('control.storage.localPath')} hint={t('control.storage.localPathHelp')}>
                {(control) => (
                  <Input
                    {...control}
                    placeholder="/data/releases"
                    value={storageConfig.localPath}
                    onChange={(e) => setStorageConfig({ ...storageConfig, localPath: e.target.value })}
                  />
                )}
              </FormField>
            ) : (
              <>
                <Grid columns={2} gap="md">
                  <FormField label={t('control.storage.endpoint')}>
                    {(control) => (
                      <Input
                        {...control}
                        placeholder="minio or localhost"
                        value={storageConfig.minio.endPoint}
                        onChange={(e) => setStorageConfig({ ...storageConfig, minio: { ...storageConfig.minio, endPoint: e.target.value } })}
                      />
                    )}
                  </FormField>
                  <FormField label={t('control.storage.port')}>
                    {(control) => (
                      <Input
                        {...control}
                        type="number"
                        value={storageConfig.minio.port}
                        onChange={(e) => setStorageConfig({ ...storageConfig, minio: { ...storageConfig.minio, port: Number(e.target.value) || 9000 } })}
                      />
                    )}
                  </FormField>
                  <FormField label={t('control.storage.bucket')}>
                    {(control) => (
                      <Input
                        {...control}
                        placeholder="printops-releases"
                        value={storageConfig.minio.bucket}
                        onChange={(e) => setStorageConfig({ ...storageConfig, minio: { ...storageConfig.minio, bucket: e.target.value } })}
                      />
                    )}
                  </FormField>
                  <FormField label={t('control.storage.prefix')}>
                    {(control) => (
                      <Input
                        {...control}
                        placeholder="releases/"
                        value={storageConfig.minio.prefix}
                        onChange={(e) => setStorageConfig({ ...storageConfig, minio: { ...storageConfig.minio, prefix: e.target.value } })}
                      />
                    )}
                  </FormField>
                  <FormField label={t('control.storage.accessKey')}>
                    {(control) => (
                      <Input
                        {...control}
                        value={storageConfig.minio.accessKey}
                        onChange={(e) => setStorageConfig({ ...storageConfig, minio: { ...storageConfig.minio, accessKey: e.target.value } })}
                      />
                    )}
                  </FormField>
                  <FormField label={t('control.storage.secretKey')}>
                    {(control) => (
                      <Input
                        {...control}
                        type="password"
                        value={storageConfig.minio.secretKey}
                        onChange={(e) => setStorageConfig({ ...storageConfig, minio: { ...storageConfig.minio, secretKey: e.target.value } })}
                      />
                    )}
                  </FormField>
                </Grid>

                <Checkbox
                  label={t('control.storage.useSSL')}
                  checked={storageConfig.minio.useSSL}
                  onChange={(e) => setStorageConfig({ ...storageConfig, minio: { ...storageConfig.minio, useSSL: e.target.checked } })}
                />

                <FormField label={t('control.storage.publicUrl')}>
                  {(control) => (
                    <Input
                      {...control}
                      placeholder="http://localhost:9000/printops-releases"
                      value={storageConfig.minio.publicUrl || ''}
                      onChange={(e) => setStorageConfig({ ...storageConfig, minio: { ...storageConfig.minio, publicUrl: e.target.value } })}
                    />
                  )}
                </FormField>
              </>
            )}
          </Stack>
        </Stack>
      </Dialog>
    </PageLayout>
  );
}
