import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useLocale } from '../i18n/index.js';
import { formatRelativeTime } from '../lib/relativeTime.js';
import { useApiResource } from '../hooks/useApiResource.js';
import type { DeviceListItem } from './WebControlDevices.js';
import type { ControlCommandProgress, ControlContentBundle, ControlContentIndex, ControlContentKind } from '@printerops/domain';
import { RemoteCommandProgress } from '../components/RemoteCommandProgress.js';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  CodeBlock,
  DataCell,
  DataHead,
  DataTable,
  EmptyState,
  ErrorBanner,
  FormField,
  Freshness,
  Inline,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  SectionHeading,
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
  progress?: ControlCommandProgress;
}

interface ContentCommandDetail {
  commandId: string;
  status: string;
  terminalState?: string;
  failureReason?: string;
  progress?: ControlCommandProgress;
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
  progress?: ControlCommandProgress;
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
  const [inventoryProgress, setInventoryProgress] = useState<ControlCommandProgress | null>(null);
  const [inventoryCommandType, setInventoryCommandType] = useState<'CONTENT_LIST' | 'CONTENT_PULL'>('CONTENT_LIST');
  const [inventoryCommandStatus, setInventoryCommandStatus] = useState('ACCEPTED');
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
    setInventoryCommandType(body.type);
    setInventoryCommandStatus(issued.status);
    setInventoryProgress(issued.progress ?? {
      current: 0,
      total: 1,
      percent: 0,
      mode: 'steps',
      phase: body.type === 'CONTENT_LIST' ? 'listing-content' : 'pulling-content',
      ...(body.type === 'CONTENT_PULL' ? { item: body.contentKey } : {}),
    });
    setInventoryActivity(t('control.content.commandWaiting').replace('{id}', issued.commandId).replace('{status}', issued.status.toLowerCase()));
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await apiFetch<ContentCommandDetail>(
        `/v1/control/devices/${encodeURIComponent(deviceId)}/commands/${encodeURIComponent(issued.commandId)}`,
      );
      setInventoryCommandStatus(current.status);
      if (current.progress) setInventoryProgress(current.progress);
      if (current.status === 'COMPLETED') return current;
      if (['FAILED', 'REJECTED', 'EXPIRED'].includes(current.status)) {
        throw new Error(current.failureReason || `Client command ${current.status.toLowerCase()}`);
      }
      setInventoryActivity(t('control.content.commandWaiting').replace('{id}', current.commandId).replace('{status}', current.status.toLowerCase()));
      await new Promise((resolve) => window.setTimeout(resolve, 750));
    }
    throw new Error(t('control.content.notReturnedYet'));
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
    setInventoryCommandType('CONTENT_LIST');
    setInventoryCommandStatus('ACCEPTED');
    setInventoryProgress({
      current: 0,
      total: 1,
      percent: 0,
      mode: 'steps',
      phase: 'listing-content',
    });
    setInventoryActivity(t('control.content.requestingList'));
    try {
      const result = await issueAndWaitForContentCommand(inventoryDeviceId, { type: 'CONTENT_LIST' });
      if (!result.resultPayload?.index) throw new Error(t('control.content.noListReturned'));
      setClientInventory(result.resultPayload.index);
      setInventoryActivity(t('control.content.loadedCatalog').replace('{profiles}', String(result.resultPayload.index.profiles.length)).replace('{templates}', String(result.resultPayload.index.templates.length)));
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : String(error));
      setInventoryActivity('');
      setInventoryCommandStatus('FAILED');
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
    setInventoryCommandType('CONTENT_PULL');
    setInventoryCommandStatus('ACCEPTED');
    setInventoryProgress({
      current: 0,
      total: 1,
      percent: 0,
      mode: 'steps',
      phase: 'pulling-content',
      item: item.name,
    });
    setInventoryActivity(t('control.content.pullActivity').replace('{kind}', t(item.kind === 'paper-profile' ? 'control.content.profileWord' : 'control.content.templateWord')).replace('{code}', item.code));
    try {
      const result = await issueAndWaitForContentCommand(inventoryDeviceId, {
        type: 'CONTENT_PULL',
        contentType: item.kind,
        contentKey: item.code,
      });
      const bundle = result.resultPayload?.bundle;
      if (!bundle) throw new Error(t('control.content.noContentReturned'));
      setPulledBundle(bundle);
      setPullCommandId(result.commandId);
      setImportCode(bundle.kind === 'paper-profile' ? bundle.profile!.code : bundle.template!.templateCode);
      setInventoryActivity(t('control.content.pullDone').replace('{code}', item.code));
    } catch (error) {
      setInventoryError(error instanceof Error ? error.message : String(error));
      setInventoryActivity('');
      setInventoryCommandStatus('FAILED');
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
            ? {
              ...target,
              status: current.status,
              terminalState: current.terminalState,
              failureReason: current.failureReason,
              progress: current.progress ?? target.progress,
            }
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
      title={t('control.content.title')}
      description={t('control.content.subtitle')}
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
          {t('control.content.intro')}
        </Text>
        <Alert tone="info" title={t('control.content.networkTitle')}>
          {t('control.content.networkBody')}
        </Alert>

        <Panel padding="md">
          <Stack gap="md">
            <SectionHeading
              title={t('control.content.readTitle')}
              description={t('control.content.readDesc')}
              actions={
                <Inline gap="sm">
                  <Stack gap="xs" className="wc-field-wide">
                    <FormField label={t('control.content.onlineClient')}>
                      {(control) => (
                      <Select {...control}
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
                          ? <option value="">{t('control.content.noReadableClients')}</option>
                          : contentReadableDevices.map((device) => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {device.displayName || device.hostname} · {device.deviceId}
                            </option>
                          ))}
                      </Select>
                      )}
                    </FormField>
                  </Stack>
                  <Button
                    variant="secondary"
                    disabled={!inventoryDeviceId || isReadingClient || isImporting}
                    onClick={() => void readClientCatalog()}
                  >
                    {isReadingClient ? t('control.content.contactingClient') : t('control.content.readCatalog')}
                  </Button>
                </Inline>
              }
            />

            {contentReadableDevices.length === 0 && devices.length > 0 && (
              <Alert tone="warning" title={t('control.content.updateRequiredTitle')}>
                {t('control.content.updateRequiredBody')}
              </Alert>
            )}
            {inventoryError && <ErrorBanner error={inventoryError} />}
            {inventoryActivity && <Text size="label" tone="muted" aria-live="polite">{inventoryActivity}</Text>}
            {inventoryProgress && (
              <RemoteCommandProgress
                progress={inventoryProgress}
                commandType={inventoryCommandType}
                status={inventoryCommandStatus}
                compact
              />
            )}
            {clientInventory?.truncated && (
              <Alert tone="warning" title={t('control.content.truncatedTitle')}>
                {t('control.content.truncatedBody')}
              </Alert>
            )}

            {clientInventory && (remoteContentEntries.length === 0 ? (
              <EmptyState title={t('control.content.clientEmpty')} />
            ) : (
              <DataTable label={t('control.content.clientCatalog')} responsive>
                <thead>
                  <tr><DataHead>{t('control.content.colType')}</DataHead><DataHead>{t('control.content.colCode')}</DataHead><DataHead>{t('control.content.colName')}</DataHead><DataHead>{t('control.content.colDetails')}</DataHead><DataHead>{t('control.content.colAction')}</DataHead></tr>
                </thead>
                <tbody>
                  {remoteContentEntries.map((item) => (
                    <tr key={`${item.kind}:${item.code}`}>
                      <DataCell label={t('control.content.colType')}>{t(item.kind === 'paper-profile' ? 'control.content.kindProfile' : 'control.content.kindTemplate')}</DataCell>
                      <DataCell label={t('control.content.colCode')}><Mono size="label">{item.code}</Mono></DataCell>
                      <DataCell label={t('control.content.colName')}>{item.name}</DataCell>
                      <DataCell label={t('control.content.colDetails')}><Text size="label" tone="muted">{item.details}</Text></DataCell>
                      <DataCell label={t('control.content.colAction')}>
                        <Button size="sm" variant="secondary" disabled={isReadingClient || isImporting} onClick={() => void pullClientItem(item)}>
                          {t('control.content.pullForReview')}
                        </Button>
                      </DataCell>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ))}

            {pulledBundle && (
              <Stack gap="sm">
                <Text size="label" weight="medium">{t('control.content.pulledSnapshot').replace('{name}', inventoryDevice?.displayName || inventoryDevice?.hostname || inventoryDeviceId)}</Text>
                <CodeBlock scroll label={t('control.content.pulledSnapshot').replace('{name}', inventoryDevice?.displayName || inventoryDevice?.hostname || inventoryDeviceId)}>
                  {JSON.stringify(pulledBundle, null, 2)}
                </CodeBlock>
                <Alert tone="info" title={t('control.content.importCopyTitle')}>
                  {t('control.content.importCopyBody')}
                </Alert>
                <Inline gap="md">
                  <Stack gap="xs" className="wc-field-wide">
                    <FormField label={t('control.content.importCodeLabel')}>
                      {(control) => (
                      <Input {...control}
                        value={importCode}
                        onChange={(event) => setImportCode(event.target.value)}
                        maxLength={128}
                        aria-label={t('control.content.importCodeAria')}
                      />
                      )}
                    </FormField>
                  </Stack>
                  <Button variant="primary" disabled={isImporting || !importCode.trim() || !pullCommandId} onClick={() => void importPulledBundle()}>
                    {isImporting ? t('control.content.importing') : t('control.content.importCopy')}
                  </Button>
                  {importError && <Text size="label" tone="danger">{importError}</Text>}
                </Inline>
              </Stack>
            )}

            {importResult && (
              <Alert tone="success" title={t('control.content.importedTitle').replace('{kind}', t(importResult.kind === 'paper-profile' ? 'control.content.kindProfile' : 'control.content.kindTemplate')).replace('{code}', importResult.importedCode)}>
                {importResult.template === 'created' ? `${t('control.content.importedDraft')} ` : ''}
                {importResult.profile === 'created' ? `${t('control.content.importedProfile')} ` : ''}
                {t('control.content.importedOpen')}
                <div style={{ marginTop: '0.75rem' }}>
                  <Button variant="secondary" onClick={() => navigate(importResult.kind === 'paper-profile' ? '/control/paper-profiles' : '/control/templates')}>
                    {t(importResult.kind === 'paper-profile' ? 'control.content.openProfiles' : 'control.content.openTemplates')}
                  </Button>
                </div>
              </Alert>
            )}
          </Stack>
        </Panel>

        {Boolean(hasCatalogError) && (
          <ErrorBanner
            error={profilesResource.error ?? templatesResource.error ?? devicesResource.error ?? t('control.content.catalogLoadFailed')}
            onRetry={() => { profilesResource.refresh(); templatesResource.refresh(); devicesResource.refresh(); }}
          />
        )}

        <Panel padding="md">
          <Stack gap="md">
            <Inline gap="md">
              <Stack gap="xs" className="wc-field-narrow">
                <FormField label={t('control.content.typeLabel')}>
                  {(control) => (
                  <Select {...control} value={kind} onChange={(event) => { setKind(event.target.value as 'paper-profile' | 'template'); setItemId(''); }}>
                    <option value="paper-profile">{t('control.content.kindProfile')}</option>
                    <option value="template">{t('control.content.kindTemplate')}</option>
                  </Select>
                  )}
                </FormField>
              </Stack>
              <Stack gap="xs" className="wc-field-grow">
                <FormField label={t('control.content.masterItem')}>
                  {(control) => (
                  <Select {...control} value={itemId} onChange={(event) => setItemId(event.target.value)} disabled={contentItems.length === 0}>
                    {contentItems.length === 0
                      ? <option value="">{t(kind === 'paper-profile' ? 'control.content.noProfilesInCatalog' : 'control.content.noTemplatesInCatalog')}</option>
                      : contentItems.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                  </Select>
                  )}
                </FormField>
              </Stack>
              <Inline gap="sm">
                <Button variant="secondary" onClick={() => navigate('/control/paper-profiles')}>{t('control.content.manageProfiles')}</Button>
                <Button variant="secondary" onClick={() => navigate('/control/templates')}>{t('control.content.manageTemplates')}</Button>
              </Inline>
            </Inline>

            {selectedContent && (
              <Text size="label" tone="muted">{t('control.content.selectedMaster')}: <Mono size="label">{selectedContent.code}</Mono> · {selectedContent.details}</Text>
            )}

            <Checkbox
              label={t('control.content.overwriteLabel')}
              description={t('control.content.overwriteHint')}
              checked={overwriteExisting}
              onChange={(event) => setOverwriteExisting(event.target.checked)}
              aria-label={t('control.content.overwriteAria')}
            />
          </Stack>
        </Panel>

        <Stack gap="sm">
          <Inline gap="md">
            <Text size="title" weight="semibold">{t('control.content.targetClients')}</Text>
            <Badge tone="neutral">{t('control.content.onlineCompatible').replace('{count}', String(compatibleOnlineDevices.length))}</Badge>
            <Button size="sm" variant="secondary" disabled={compatibleOnlineDevices.length === 0} onClick={selectAllCompatible}>
              {selectedDeviceIds.length === compatibleOnlineDevices.length && compatibleOnlineDevices.length > 0 ? t('control.content.clearSelection') : t('control.content.selectCompatible')}
            </Button>
          </Inline>

          {devicesResource.loading && !devicesResource.data ? <LoadingState /> : devices.length === 0 ? (
            <EmptyState title={t('control.content.noEnrolledClients')} />
          ) : (
            <DataTable label={t('control.content.availableDevices')} responsive>
              <thead>
                <tr>
                  <DataHead>{t('control.content.colSelect')}</DataHead>
                  <DataHead>{t('control.content.colClient')}</DataHead>
                  <DataHead>{t('control.content.colSite')}</DataHead>
                  <DataHead>{t('control.content.colVersion')}</DataHead>
                  <DataHead>{t('control.content.colAddress')}</DataHead>
                  <DataHead>{t('control.content.colLastSeen')}</DataHead>
                  <DataHead>{t('control.content.colContentSync')}</DataHead>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const supportsContentSync = device.capabilities?.includes('content-sync-v1') === true;
                  const canSelect = supportsContentSync && device.connectionState === 'ONLINE';
                  return (
                    <tr key={device.deviceId}>
                      <DataCell label={t('control.content.colSelect')}>
                        <Checkbox
                          hideLabel
                          label={device.displayName || device.hostname}
                          checked={selectedDeviceIds.includes(device.deviceId)}
                          disabled={!canSelect}
                          onChange={() => toggleDevice(device.deviceId)}
                          aria-label={t('control.content.colSelect')}
                        />
                      </DataCell>
                      <DataCell label={t('control.content.colClient')}>
                        <Stack gap="xs">
                          <Text weight="medium">{device.displayName || device.hostname}</Text>
                          <Mono size="label" tone="muted">{device.deviceId}</Mono>
                        </Stack>
                      </DataCell>
                      <DataCell label={t('control.content.colSite')}>{device.siteId}</DataCell>
                      <DataCell label={t('control.content.colVersion')}><Mono size="body">v{device.appVersion}</Mono></DataCell>
                      <DataCell label={t('control.content.colAddress')}><Text size="label">{device.ipAddresses?.join(', ') || t('control.content.notReported')}</Text></DataCell>
                      <DataCell label={t('control.content.colLastSeen')}><Text size="label" tone="muted">{device.lastSeenAt ? formatRelativeTime(t, device.lastSeenAt) : t('control.content.never')}</Text></DataCell>
                      <DataCell label={t('control.content.colContentSync')}>
                        <Badge tone={supportsContentSync ? 'success' : 'warning'}>
                          {supportsContentSync ? t('control.content.syncReady') : t('control.content.syncUpdateRequired')}
                        </Badge>
                      </DataCell>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}

          {devices.length > 0 && compatibleOnlineDevices.length === 0 && (
            <Alert tone="warning" title={t('control.content.noTargetTitle')}>
              {t('control.content.noTargetBody')}
            </Alert>
          )}

          <Inline gap="md">
            <Button
              variant="primary"
              disabled={isPublishing || !selectedContent || selectedDeviceIds.length === 0}
              onClick={() => void publish()}
            >
              {isPublishing ? t('control.content.publishing') : t(selectedDeviceIds.length === 1 ? 'control.content.publishOne' : 'control.content.publishMany').replace('{count}', String(selectedDeviceIds.length))}
            </Button>
            {publishError && <Text size="label" tone="danger">{publishError}</Text>}
          </Inline>
        </Stack>

        {deployment && (
          <Stack gap="sm">
            <Text size="title" weight="semibold">{t('control.content.latestDistribution')}</Text>
            <Text size="label" tone="muted">{deployment.contentKey} · {deployment.deploymentId}</Text>
            <DataTable label={t('control.content.distributionStatus')} responsive>
              <thead>
                <tr><DataHead>{t('control.content.colClient')}</DataHead><DataHead>{t('control.content.colStatus')}</DataHead><DataHead>{t('control.content.colProgress')}</DataHead><DataHead>{t('control.content.colResult')}</DataHead></tr>
              </thead>
              <tbody>
                {deployment.deployments.map((target) => {
                  const device = deploymentDevice(target.deviceId);
                  const tone = target.status === 'COMPLETED' ? 'success' : target.status === 'REJECTED' || target.status === 'FAILED' ? 'danger' : 'warning';
                  const progress = target.progress ?? (['PENDING', 'DELIVERED', 'ACCEPTED'].includes(target.status)
                    ? { current: 0, total: 1, percent: 0, mode: 'steps' as const, phase: 'queued' as const }
                    : undefined);
                  return (
                    <tr key={target.deviceId}>
                      <DataCell label={t('control.content.colClient')}>{device?.displayName || device?.hostname || target.deviceId}</DataCell>
                      <DataCell label={t('control.content.colStatus')}><Badge tone={tone}>{target.terminalState || target.status}</Badge></DataCell>
                      <DataCell label={t('control.content.colProgress')}>
                        <RemoteCommandProgress
                          progress={progress}
                          commandType="CONTENT_SYNC"
                          status={target.status}
                          compact
                        />
                      </DataCell>
                      <DataCell label={t('control.content.colResult')}><Text size="label" tone={target.errorMessage || target.failureReason ? 'danger' : 'muted'}>{target.errorMessage || target.failureReason || target.commandId || t('control.content.notSent')}</Text></DataCell>
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
