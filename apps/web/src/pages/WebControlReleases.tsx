import { useCallback, useMemo, useState } from 'react';
import { apiFetch } from '../api/client.js';
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
  channel: 'stable' | 'beta' | 'rc';
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
}

const RELEASES_POLL_MS = 15_000;

export default function WebControlReleases() {
  const { t } = useLocale();

  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [formVersion, setFormVersion] = useState('');
  const [formChannel, setFormChannel] = useState<'stable' | 'beta' | 'rc'>('stable');
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

  return (
    <PageLayout
      title="Release Catalog"
      density="compact"
      width="full"
      actions={
        <Inline gap="md">
          <Button variant="primary" onClick={() => { setRegisterError(null); setRegisterModalOpen(true); }}>
            Register Signed Release
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
                      <Mono size="body" weight="semibold">v{rel.version}</Mono>
                      {rel.releaseNotes && <Text size="label" tone="muted">{rel.releaseNotes}</Text>}
                    </Stack>
                  </DataCell>
                  <DataCell><Mono size="body">{rel.platform}</Mono></DataCell>
                  <DataCell><Text size="body">{rel.channel}</Text></DataCell>
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
                    <Button
                      size="sm"
                      variant={rel.status === 'AVAILABLE' ? 'danger' : 'secondary'}
                      onClick={() => handleToggleStatus(rel)}
                    >
                      {rel.status === 'AVAILABLE' ? 'Revoke' : 'Activate'}
                    </Button>
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
    </PageLayout>
  );
}
