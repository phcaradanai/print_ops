import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import type { DeviceListItem } from './WebControlDevices.js';
import type { ControlContentBundle, ControlContentIndex, ControlContentKind } from '@printerops/domain';
import {
  Alert,
  Badge,
  Button,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorBanner,
  Freshness,
  Inline,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  Select,
  Stack,
  Text,
} from '../components/ui/index.js';

interface PaperProfileItem {
  id: string;
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
}

interface TemplateItem {
  id: string;
  templateCode: string;
  name: string;
  engine: string;
  status: string;
  paperProfileId?: string;
  updatedAt: string;
}

interface CommandHistoryItem {
  commandId: string;
  status: string;
  terminalState?: string;
  failureReason?: string;
}

interface ContentCommandDetail {
  commandId: string;
  status: string;
  terminalState?: string;
  failureReason?: string;
  resultPayload?: { index?: ControlContentIndex; bundle?: ControlContentBundle };
}

type ClientContentEntry =
  | { kind: 'paper-profile'; code: string; name: string; details: string }
  | { kind: 'template'; code: string; name: string; details: string };

interface ContentImportResult {
  kind: ControlContentKind;
  sourceCode: string;
  importedCode: string;
  profile: 'created' | 'unchanged' | 'none';
  template: 'created' | 'none';
}

interface DeploymentTarget {
  deviceId: string;
  commandId?: string;
  status: string;
  contentKey?: string;
  errorCode?: string;
  errorMessage?: string;
  terminalState?: string;
  failureReason?: string;
}

interface DeploymentRecord {
  deploymentId: string;
  contentKey: string;
  deployments: DeploymentTarget[];
}

const RESOURCE_POLL_MS = 15_000;
const TERMINAL_COMMAND_STATES = new Set(['COMPLETED', 'FAILED', 'REJECTED', 'EXPIRED']);

export default function WebControlContent() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [kind, setKind] = useState<'paper-profile' | 'template'>('paper-profile');
  const [itemId, setItemId] = useState('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<DeploymentRecord | null>(null);
  const [inventoryDeviceId, setInventoryDeviceId] = useState('');
  const [clientInventory, setClientInventory] = useState<ControlContentIndex | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryActivity, setInventoryActivity] = useState('');
  const [isReadingClient, setIsReadingClient] = useState(false);
  const [pulledBundle, setPulledBundle] = useState<ControlContentBundle | null>(null);
  const [pullCommandId, setPullCommandId] = useState('');
  const [importCode, setImportCode] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ContentImportResult | null>(null);
  const deploymentRef = useRef<DeploymentRecord | null>(deployment);
  useEffect(() => { deploymentRef.current = deployment; }, [deployment]);

  const fetchProfiles = useCallback(() => apiFetch<PaperProfileItem[]>('/v1/paper-profiles'), []);
  const profilesResource = useApiResource(fetchProfiles, { intervalMs: RESOURCE_POLL_MS });
  const profiles = profilesResource.data ?? [];

  const fetchTemplates = useCallback(() => apiFetch<TemplateItem[]>('/v1/templates'), []);
  const templatesResource = useApiResource(fetchTemplates, { intervalMs: RESOURCE_POLL_MS });
  const templates = templatesResource.data ?? [];

  const fetchDevices = useCallback(() => apiFetch<DeviceListItem[]>('/v1/control/devices'), []);
  const devicesResource = useApiResource(fetchDevices, { intervalMs: RESOURCE_POLL_MS });
  const devices = devicesResource.data ?? [];

  const contentItems = useMemo(() => kind === 'paper-profile'
    ? profiles.map((profile) => ({
      id: profile.id,
      code: profile.code,
      name: profile.name,
      details: `${profile.widthMm} × ${profile.heightMm} mm · ${profile.dpi} dpi`,
    }))
    : templates.map((template) => ({
      id: template.id,
      code: template.templateCode,
      name: template.name,
      details: `${template.engine} · ${template.status}`,
    })), [kind, profiles, templates]);

  useEffect(() => {
    if (!contentItems.some((item) => item.id === itemId)) {
      setItemId(contentItems[0]?.id ?? '');
    }
  }, [contentItems, itemId]);

  const compatibleOnlineDevices = devices.filter((device) =>
    device.connectionState === 'ONLINE' && device.capabilities?.includes('content-sync-v1'));
  const contentReadableDevices = useMemo(() => devices.filter((device) =>
    device.connectionState === 'ONLINE' && device.capabilities?.includes('content-pull-v1')), [devices]);
  const selectedContent = contentItems.find((item) => item.id === itemId);
  const hasCatalogError = (profilesResource.error && !profilesResource.data)
    || (templatesResource.error && !templatesResource.data)
    || (devicesResource.error && !devicesResource.data);

  useEffect(() => {
    if (!contentReadableDevices.some((device) => device.deviceId === inventoryDeviceId)) {
      setInventoryDeviceId(contentReadableDevices[0]?.deviceId ?? '');
      setClientInventory(null);
      setPulledBundle(null);
      setPullCommandId('');
    }
  }, [contentReadableDevices, inventoryDeviceId]);

  const issueAndWaitForContentCommand = async (
    deviceId: string,
    body: { type: 'CONTENT_LIST' } | { type: 'CONTENT_PULL'; contentType: ControlContentKind; contentKey: string },
  ): Promise<ContentCommandDetail> => {
    const issued = await apiFetch<ContentCommandDetail>(`/v1/control/devices/${encodeURIComponent(deviceId)}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        idempotencyKey: `content_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      }),
    });
    setInventoryActivity(`Command ${issued.commandId} is ${issued.status.toLowerCase()}. Waiting for the client…`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await apiFetch<ContentCommandDetail>(
        `/v1/control/devices/${encodeURIComponent(deviceId)}/commands/${encodeURIComponent(issued.commandId)}`,
      );
      if (current.status === 'COMPLETED') return current;
      if (['FAILED', 'REJECTED', 'EXPIRED'].includes(current.status)) {
        throw new Error(current.failureReason || `Client command ${current.status.toLowerCase()}`);
      }
      setInventoryActivity(`Command ${current.commandId} is ${current.status.toLowerCase()}. Waiting for the client…`);
      await new Promise((resolve) => window.setTimeout(resolve, 750));
    }
    throw new Error('The client has not returned a result yet. Refresh the client catalog to try again.');
  };

  const readClientCatalog = async () => {
    if (!inventoryDeviceId) return;
    setIsReadingClient(true);
    setInventoryError(null);
    setImportError(null);
    setImportResult(null);
    setPulledBundle(null);
    setPullCommandId('');
    setClientInventory(null);
    setInventoryActivity('Requesting profile and template list…');
    try {
      const result = await issueAndWaitForContentCommand(inventoryDeviceId, { type: 'CONTENT_LIST' });
      if (!result.resultPayload?.index) throw new Error('The client completed without returning its content list.');
      setClientInventory(result.resultPayload.index);
      setInventoryActivity(`Loaded ${result.resultPayload.index.profiles.length} paper profiles and ${result.resultPayload.index.templates.length} templates.`);
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : String(error));
      setInventoryActivity('');
    } finally {
      setIsReadingClient(false);
    }
  };

  const pullClientItem = async (item: ClientContentEntry) => {
    if (!inventoryDeviceId) return;
    setIsReadingClient(true);
    setInventoryError(null);
    setImportError(null);
    setImportResult(null);
    setPulledBundle(null);
    setPullCommandId('');
    setInventoryActivity(`Pulling ${item.kind === 'paper-profile' ? 'paper profile' : 'template'} ${item.code}…`);
    try {
      const result = await issueAndWaitForContentCommand(inventoryDeviceId, {
        type: 'CONTENT_PULL',
        contentType: item.kind,
        contentKey: item.code,
      });
      const bundle = result.resultPayload?.bundle;
      if (!bundle) throw new Error('The client completed without returning the selected content.');
      setPulledBundle(bundle);
      setPullCommandId(result.commandId);
      setImportCode(bundle.kind === 'paper-profile' ? bundle.profile!.code : bundle.template!.templateCode);
      setInventoryActivity(`Pulled ${item.code}. Review the snapshot, then import it as a copy.`);
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : String(error));
      setInventoryActivity('');
    } finally {
      setIsReadingClient(false);
    }
  };

  const importPulledBundle = async () => {
    if (!pulledBundle || !inventoryDeviceId) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await apiFetch<ContentImportResult>(
        `/v1/control/devices/${encodeURIComponent(inventoryDeviceId)}/content-import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commandId: pullCommandId, code: importCode.trim() }),
        },
      );
      setImportResult(result);
      profilesResource.refresh();
      templatesResource.refresh();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    if (!deployment) return;
    const deploymentId = deployment.deploymentId;

    const pollCommands = async () => {
      const snapshot = deploymentRef.current;
      if (!snapshot || snapshot.deploymentId !== deploymentId || snapshot.deployments.every((target) =>
        !target.commandId || TERMINAL_COMMAND_STATES.has(target.status))) return;
      const updatedTargets = await Promise.all(snapshot.deployments.map(async (target) => {
        if (!target.commandId || TERMINAL_COMMAND_STATES.has(target.status)) return target;
        try {
          const history = await apiFetch<CommandHistoryItem[]>(
            `/v1/control/devices/${encodeURIComponent(target.deviceId)}/commands?limit=20`,
          );
          const current = history.find((command) => command.commandId === target.commandId);
          return current
            ? { ...target, status: current.status, terminalState: current.terminalState, failureReason: current.failureReason }
            : target;
        } catch {
          return target;
        }
      }));
      setDeployment((current) => current?.deploymentId === deploymentId
        ? { ...current, deployments: updatedTargets }
        : current);
    };

    const timer = window.setInterval(() => { void pollCommands(); }, 5_000);
    void pollCommands();
    return () => window.clearInterval(timer);
  }, [deployment?.deploymentId]);

  const toggleDevice = (deviceId: string) => {
    setSelectedDeviceIds((current) => current.includes(deviceId)
      ? current.filter((id) => id !== deviceId)
      : [...current, deviceId]);
  };

  const selectAllCompatible = () => {
    setSelectedDeviceIds((current) => current.length === compatibleOnlineDevices.length
      ? []
      : compatibleOnlineDevices.map((device) => device.deviceId));
  };

  const publish = async () => {
    if (!selectedContent || selectedDeviceIds.length === 0) return;
    setIsPublishing(true);
    setPublishError(null);
    try {
      const result = await apiFetch<DeploymentRecord>('/v1/control/content/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          itemId,
          deviceIds: selectedDeviceIds,
          overwriteExisting,
          deploymentId: `deploy_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        }),
      });
      setDeployment(result);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPublishing(false);
    }
  };

  const deploymentDevice = (deviceId: string) => devices.find((device) => device.deviceId === deviceId);
  const inventoryDevice = devices.find((device) => device.deviceId === inventoryDeviceId);
  const remoteContentEntries: ClientContentEntry[] = [
    ...(clientInventory?.profiles ?? []).map((profile) => ({
      kind: 'paper-profile' as const,
      code: profile.code,
      name: profile.name,
      details: `${profile.widthMm} × ${profile.heightMm} mm · ${profile.dpi} dpi · ${profile.orientation}`,
    })),
    ...(clientInventory?.templates ?? []).map((template) => ({
      kind: 'template' as const,
      code: template.templateCode,
      name: template.name,
      details: `${template.engine} · ${template.status}${template.paperProfileCode ? ` · ${template.paperProfileCode}` : ''}`,
    })),
  ];

  return (
    <PageLayout
      title="Content Distribution"
      density="compact"
      width="full"
      actions={
        <Inline gap="md">
          <Freshness
            lastSuccessAt={devicesResource.lastSuccessAt}
            stale={devicesResource.stale}
            refreshing={devicesResource.refreshing}
            paused={devicesResource.paused}
            onRefresh={() => {
              profilesResource.refresh();
              templatesResource.refresh();
              devicesResource.refresh();
            }}
          />
        </Inline>
      }
    >
      <Stack gap="lg">
        <Text size="body" tone="muted">
          Web Control keeps the master paper profiles and templates. Choose one item and send it to enrolled PrintOps clients that are online and support content sync.
        </Text>
        <Alert tone="info" title="Network visibility">
          Only enrolled installations that report through the control agent appear here. Web Control does not scan the local network.
        </Alert>

        <Panel padding="md">
          <Stack gap="md">
            <Inline gap="md" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Stack gap="xs">
                <Text size="title" weight="semibold">Read content from a PrintOps client</Text>
                <Text size="label" tone="muted">Inspect client profiles and templates, pull one item, then import it as a Web Control copy.</Text>
              </Stack>
              <Inline gap="sm" style={{ alignItems: 'end' }}>
                <Stack gap="xs" style={{ minWidth: '260px' }}>
                  <Text size="label" weight="medium">Online client</Text>
                  <Select
                    value={inventoryDeviceId}
                    disabled={contentReadableDevices.length === 0 || isReadingClient || isImporting}
                    onChange={(event) => {
                      setInventoryDeviceId(event.target.value);
                      setClientInventory(null);
                      setPulledBundle(null);
                      setPullCommandId('');
                      setImportResult(null);
                    }}
                  >
                    {contentReadableDevices.length === 0
                      ? <option value="">No compatible clients online</option>
                      : contentReadableDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.displayName || device.hostname} · {device.deviceId}
                        </option>
                      ))}
                  </Select>
                </Stack>
                <Button
                  variant="secondary"
                  disabled={!inventoryDeviceId || isReadingClient || isImporting}
                  onClick={() => void readClientCatalog()}
                >
                  {isReadingClient ? 'Contacting client…' : 'Read catalog'}
                </Button>
              </Inline>
            </Inline>

            {contentReadableDevices.length === 0 && devices.length > 0 && (
              <Alert tone="warning" title="Client update required">
                Client inventory and pull require the latest PrintOps control agent. Online clients without that capability remain visible in the device list.
              </Alert>
            )}
            {inventoryError && <ErrorBanner error={inventoryError} />}
            {inventoryActivity && <Text size="label" tone="muted" aria-live="polite">{inventoryActivity}</Text>}
            {clientInventory?.truncated && (
              <Alert tone="warning" title="Client list is limited">
                This client has more than 500 items in at least one category. The first 500 profiles and templates are shown.
              </Alert>
            )}

            {clientInventory && (remoteContentEntries.length === 0 ? (
              <EmptyState title="This client has no paper profiles or templates" />
            ) : (
              <DataTable label="Client paper profiles and templates" responsive>
                <thead>
                  <tr><DataHead>Type</DataHead><DataHead>Code</DataHead><DataHead>Name</DataHead><DataHead>Details</DataHead><DataHead>Action</DataHead></tr>
                </thead>
                <tbody>
                  {remoteContentEntries.map((item) => (
                    <tr key={`${item.kind}:${item.code}`}>
                      <DataCell>{item.kind === 'paper-profile' ? 'Paper profile' : 'Template'}</DataCell>
                      <DataCell><Mono size="label">{item.code}</Mono></DataCell>
                      <DataCell>{item.name}</DataCell>
                      <DataCell><Text size="label" tone="muted">{item.details}</Text></DataCell>
                      <DataCell>
                        <Button size="sm" variant="secondary" disabled={isReadingClient || isImporting} onClick={() => void pullClientItem(item)}>
                          Pull for review
                        </Button>
                      </DataCell>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ))}

            {pulledBundle && (
              <Stack gap="sm">
                <Text size="label" weight="medium">Pulled snapshot from {inventoryDevice?.displayName || inventoryDevice?.hostname || inventoryDeviceId}</Text>
                <pre style={{ maxHeight: '18rem', overflow: 'auto', padding: '0.75rem', borderRadius: '0.5rem', background: 'var(--surface-subtle, #f4f5f6)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.75rem' }}>
                  {JSON.stringify(pulledBundle, null, 2)}
                </pre>
                <Alert tone="info" title="Import creates a copy">
                  Existing Web Control items are never replaced. Template copies are imported as drafts and can be edited before publishing.
                </Alert>
                <Inline gap="md" style={{ alignItems: 'end' }}>
                  <Stack gap="xs" style={{ minWidth: '260px', maxWidth: '100%' }}>
                    <Text size="label" weight="medium">Code in Web Control</Text>
                    <input
                      value={importCode}
                      onChange={(event) => setImportCode(event.target.value)}
                      maxLength={128}
                      aria-label="Code for imported copy"
                    />
                  </Stack>
                  <Button variant="primary" disabled={isImporting || !importCode.trim() || !pullCommandId} onClick={() => void importPulledBundle()}>
                    {isImporting ? 'Importing…' : 'Import copy'}
                  </Button>
                  {importError && <Text size="label" tone="danger">{importError}</Text>}
                </Inline>
              </Stack>
            )}

            {importResult && (
              <Alert tone="success" title={`${importResult.kind === 'paper-profile' ? 'Paper profile' : 'Template'} ${importResult.importedCode} is in Web Control`}>
                {importResult.template === 'created' ? 'Imported as a draft. ' : ''}
                {importResult.profile === 'created' ? 'Its paper profile dependency was imported too. ' : ''}
                Open the catalog to edit the imported copy.
                <div style={{ marginTop: '0.75rem' }}>
                  <Button variant="secondary" onClick={() => navigate(importResult.kind === 'paper-profile' ? '/control/paper-profiles' : '/control/templates')}>
                    {importResult.kind === 'paper-profile' ? 'Open paper profiles' : 'Open templates'}
                  </Button>
                </div>
              </Alert>
            )}
          </Stack>
        </Panel>

        {Boolean(hasCatalogError) && (
          <ErrorBanner
            error={profilesResource.error ?? templatesResource.error ?? devicesResource.error ?? 'Unable to load content catalog'}
            onRetry={() => { profilesResource.refresh(); templatesResource.refresh(); devicesResource.refresh(); }}
          />
        )}

        <Panel padding="md">
          <Stack gap="md">
            <Inline gap="md">
              <Stack gap="xs" style={{ minWidth: '180px' }}>
                <Text size="label" weight="medium">Content type</Text>
                <Select value={kind} onChange={(event) => { setKind(event.target.value as 'paper-profile' | 'template'); setItemId(''); }}>
                  <option value="paper-profile">Paper profile</option>
                  <option value="template">Template</option>
                </Select>
              </Stack>
              <Stack gap="xs" style={{ flex: 1, minWidth: '240px' }}>
                <Text size="label" weight="medium">Master item</Text>
                <Select value={itemId} onChange={(event) => setItemId(event.target.value)} disabled={contentItems.length === 0}>
                  {contentItems.length === 0
                    ? <option value="">No {kind === 'paper-profile' ? 'paper profiles' : 'templates'} in the catalog</option>
                    : contentItems.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </Select>
              </Stack>
              <Stack gap="xs" style={{ alignSelf: 'end' }}>
                <Inline gap="sm">
                  <Button variant="secondary" onClick={() => navigate('/control/paper-profiles')}>Manage profiles</Button>
                  <Button variant="secondary" onClick={() => navigate('/control/templates')}>Manage templates</Button>
                </Inline>
              </Stack>
            </Inline>

            {selectedContent && (
              <Text size="label" tone="muted">Selected master: <Mono size="label">{selectedContent.code}</Mono> · {selectedContent.details}</Text>
            )}

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(event) => setOverwriteExisting(event.target.checked)}
                aria-label="Replace matching client content"
              />
              <span>
                <Text size="body" weight="medium">Replace matching codes on selected clients</Text>
                <Text size="label" tone="muted">Off by default. Without this option, a different local item with the same code is kept and the client reports a conflict.</Text>
              </span>
            </label>
          </Stack>
        </Panel>

        <Stack gap="sm">
          <Inline gap="md">
            <Text size="title" weight="semibold">Target clients</Text>
            <Badge tone="neutral">{compatibleOnlineDevices.length} online and compatible</Badge>
            <Button size="sm" variant="secondary" disabled={compatibleOnlineDevices.length === 0} onClick={selectAllCompatible}>
              {selectedDeviceIds.length === compatibleOnlineDevices.length && compatibleOnlineDevices.length > 0 ? 'Clear selection' : 'Select compatible'}
            </Button>
          </Inline>

          {devicesResource.loading && !devicesResource.data ? <LoadingState /> : devices.length === 0 ? (
            <EmptyState title="No enrolled PrintOps clients have reported in" />
          ) : (
            <DataTable label="PrintOps clients available for content sync" responsive>
              <thead>
                <tr>
                  <DataHead>Select</DataHead>
                  <DataHead>Client</DataHead>
                  <DataHead>Site</DataHead>
                  <DataHead>Installed PrintOps version</DataHead>
                  <DataHead>Network address</DataHead>
                  <DataHead>Last seen</DataHead>
                  <DataHead>Content sync</DataHead>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const supportsContentSync = device.capabilities?.includes('content-sync-v1') === true;
                  const canSelect = supportsContentSync && device.connectionState === 'ONLINE';
                  return (
                    <tr key={device.deviceId}>
                      <DataCell>
                        <input
                          type="checkbox"
                          checked={selectedDeviceIds.includes(device.deviceId)}
                          disabled={!canSelect}
                          onChange={() => toggleDevice(device.deviceId)}
                          aria-label={`Select ${device.displayName || device.hostname}`}
                        />
                      </DataCell>
                      <DataCell>
                        <Stack gap="xs">
                          <Text weight="medium">{device.displayName || device.hostname}</Text>
                          <Mono size="label" tone="muted">{device.deviceId}</Mono>
                        </Stack>
                      </DataCell>
                      <DataCell>{device.siteId}</DataCell>
                      <DataCell><Mono size="body">v{device.appVersion}</Mono></DataCell>
                      <DataCell><Text size="label">{device.ipAddresses?.join(', ') || 'Not reported'}</Text></DataCell>
                      <DataCell><Text size="label" tone="muted">{device.lastSeenAt ? formatRelativeTime(t, device.lastSeenAt) : 'Never'}</Text></DataCell>
                      <DataCell>
                        <Badge tone={supportsContentSync ? 'success' : 'warning'}>
                          {supportsContentSync ? 'READY' : 'Client update required'}
                        </Badge>
                      </DataCell>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}

          {devices.length > 0 && compatibleOnlineDevices.length === 0 && (
            <Alert tone="warning" title="No client can receive profiles yet">
              Update the PrintOps client and its control agent to enable signed content sync. Existing app versions remain visible above.
            </Alert>
          )}

          <Inline gap="md">
            <Button
              variant="primary"
              disabled={isPublishing || !selectedContent || selectedDeviceIds.length === 0}
              onClick={() => void publish()}
            >
              {isPublishing ? 'Sending…' : `Publish to ${selectedDeviceIds.length} client${selectedDeviceIds.length === 1 ? '' : 's'}`}
            </Button>
            {publishError && <Text size="label" tone="danger">{publishError}</Text>}
          </Inline>
        </Stack>

        {deployment && (
          <Stack gap="sm">
            <Text size="title" weight="semibold">Latest distribution</Text>
            <Text size="label" tone="muted">{deployment.contentKey} · {deployment.deploymentId}</Text>
            <DataTable label="Latest content distribution status" responsive>
              <thead>
                <tr><DataHead>Client</DataHead><DataHead>Status</DataHead><DataHead>Result</DataHead></tr>
              </thead>
              <tbody>
                {deployment.deployments.map((target) => {
                  const device = deploymentDevice(target.deviceId);
                  const tone = target.status === 'COMPLETED' ? 'success' : target.status === 'REJECTED' || target.status === 'FAILED' ? 'danger' : 'warning';
                  return (
                    <tr key={target.deviceId}>
                      <DataCell>{device?.displayName || device?.hostname || target.deviceId}</DataCell>
                      <DataCell><Badge tone={tone}>{target.terminalState || target.status}</Badge></DataCell>
                      <DataCell><Text size="label" tone={target.errorMessage || target.failureReason ? 'danger' : 'muted'}>{target.errorMessage || target.failureReason || target.commandId || 'Not sent'}</Text></DataCell>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </Stack>
        )}
      </Stack>
    </PageLayout>
  );
}
