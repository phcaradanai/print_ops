import { useCallback, useEffect, useState } from 'react';
import { useLocale, type Locale } from '../i18n/index.js';
import { errorMessage } from '../api/errors.js';
import {
  apiDownload,
  getReadiness,
  getNatsRuntimeStatus,
  getRuntimeArchitecture,
  testNatsConnection,
  type NatsRuntimeStatus,
  type ReadinessState,
} from '../api/client.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { useApiResource } from '../hooks/useApiResource.js';
import {
  type NatsSettings,
  DEFAULT_NATS_SETTINGS,
  getNatsSettings,
  saveNatsSettings,
  isTauriAvailable,
} from '../tauri.js';
import { ServiceAccountSettings } from '../components/ServiceAccountSettings.js';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ErrorBanner,
  Fact,
  FactList,
  FormField,
  Freshness,
  Inline,
  Input,
  LoadingState,
  Mono,
  PageLayout,
  Panel,
  RecordCard,
  RecordHeader,
  RecordList,
  Select,
  SectionHeading,
  Stack,
  StatusIndicator,
  Text,
  type BadgeTone,
  type StatusTone,
} from '../components/ui/index.js';

// ----- workspace profile persistence -----

const WS_PROJECT_KEY = 'printops-workspace-project';
const WS_PATH_KEY = 'printops-workspace-path';
const API_KEY_STORAGE_KEY = 'printops-api-key';

/**
 * Readiness maps onto the shared device tones so the dot beside a component
 * means the same thing it means on Printers and Diagnostics. `NOT_CONFIGURED`
 * is deliberately not `down`: nothing is broken, the site simply has not set it
 * up, and painting that red sends operators looking for a fault that isn't there.
 */
const READINESS_TONE: Record<ReadinessState, StatusTone> = {
  READY: 'ok',
  DEGRADED: 'busy',
  NOT_CONFIGURED: 'unknown',
  UNAVAILABLE: 'down',
};

const READINESS_BADGE: Record<ReadinessState, BadgeTone> = {
  READY: 'success',
  DEGRADED: 'warning',
  NOT_CONFIGURED: 'neutral',
  UNAVAILABLE: 'danger',
};

function loadWorkspace(): { projectName: string; workspacePath: string; apiKey: string } {
  try {
    return {
      projectName: localStorage.getItem(WS_PROJECT_KEY) ?? '',
      workspacePath: localStorage.getItem(WS_PATH_KEY) ?? '',
      apiKey: localStorage.getItem(API_KEY_STORAGE_KEY) ?? '',
    };
  } catch {
    return { projectName: '', workspacePath: '', apiKey: '' };
  }
}

/**
 * Returns false when the browser refused to persist (private/partitioned mode).
 *
 * The guard itself is deliberate and stays — `localStorage` genuinely can throw
 * here. What changed is that it no longer lies: it used to swallow the failure
 * and return void, so the caller's own catch could never fire and the page
 * reported "Saved" over a write that never happened.
 */
function saveWorkspace(projectName: string, workspacePath: string, apiKey: string): boolean {
  try {
    localStorage.setItem(WS_PROJECT_KEY, projectName);
    localStorage.setItem(WS_PATH_KEY, workspacePath);
    if (apiKey.trim()) {
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export default function Settings() {
  const { t, locale, setLocale } = useLocale();
  const fetchRuntimeArchitecture = useCallback(() => getRuntimeArchitecture(), []);
  const runtimeResource = useApiResource(fetchRuntimeArchitecture);
  const fetchReadiness = useCallback(() => getReadiness(), []);
  const readinessResource = useApiResource(fetchReadiness);

  // Language
  const [lang, setLang] = useState<Locale>(locale);

  // Workspace
  const [ws, setWs] = useState(loadWorkspace);
  const [wsDraft, setWsDraft] = useState(ws);
  const [wsDirty, setWsDirty] = useState(false);

  // Shared state
  const [message, setMessage] = useState<{
    text: string;
    kind: 'success' | 'error';
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [downloadingSupport, setDownloadingSupport] = useState(false);

  // NATS client configuration (desktop only)
  const [nats, setNats] = useState<NatsSettings>(DEFAULT_NATS_SETTINGS);
  const [natsDraft, setNatsDraft] = useState<NatsSettings>(DEFAULT_NATS_SETTINGS);
  const [natsDirty, setNatsDirty] = useState(false);
  const [natsLoading, setNatsLoading] = useState(true);
  const [natsSupported, setNatsSupported] = useState(false);
  const [natsStatus, setNatsStatus] = useState<NatsRuntimeStatus | null>(null);
  const [natsTesting, setNatsTesting] = useState(false);

  const readinessLabels: Record<string, string> = {
    desktopShell: t('settings.readiness.desktopShell'),
    localApi: t('settings.readiness.localApi'),
    database: t('settings.readiness.database'),
    localPrintWorker: t('settings.readiness.localPrintWorker'),
    discoveryRunner: t('settings.readiness.discoveryRunner'),
    selectedPrinter: t('settings.readiness.selectedPrinter'),
    natsCore: t('settings.readiness.natsCore'),
    jetStream: t('settings.readiness.jetStream'),
    stream: t('settings.readiness.stream'),
    durableConsumer: t('settings.readiness.durableConsumer'),
    httpCallback: t('settings.readiness.httpCallback'),
    natsCallback: t('settings.readiness.natsCallback'),
    callbackRetryQueue: t('settings.readiness.callbackRetryQueue'),
  };
  const readinessStateLabel = (state: ReadinessState) => t(`settings.readiness.state.${state}`);

  // Clear message after delay
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  // Load NATS settings when running inside the desktop shell.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = await isTauriAvailable();
      if (cancelled) return;
      setNatsSupported(supported);
      if (!supported) {
        setNatsLoading(false);
        return;
      }
      const loaded = await getNatsSettings();
      if (cancelled) return;
      const value = loaded ?? DEFAULT_NATS_SETTINGS;
      setNats(value);
      setNatsDraft(value);
      setNatsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!natsSupported) return;
    let cancelled = false;
    const refresh = () => { void getNatsRuntimeStatus().then((value) => { if (!cancelled) setNatsStatus(value); }).catch(() => {}); };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [natsSupported]);

  const handleNatsTest = useCallback(async () => {
    setNatsTesting(true);
    try {
      const result = await testNatsConnection();
      setMessage({ text: result.ok ? 'NATS ready (' + result.durationMs + 'ms)' : 'NATS ' + result.stage + ': ' + result.message, kind: result.ok ? 'success' : 'error' });
    } catch (error) { setMessage({ text: errorMessage(error), kind: 'error' }); }
    finally { setNatsTesting(false); }
  }, []);

  // ---- handlers ----

  const handleLangChange = useCallback(
    (next: Locale) => {
      setLang(next);
      setLocale(next);
      setMessage({ text: t('settings.saved'), kind: 'success' });
    },
    [setLocale, t],
  );

  const handleWsChange = useCallback(
    (field: 'projectName' | 'workspacePath' | 'apiKey', value: string) => {
      const next = { ...wsDraft, [field]: value };
      setWsDraft(next);
      setWsDirty(
        next.projectName !== ws.projectName ||
          next.workspacePath !== ws.workspacePath ||
          next.apiKey !== ws.apiKey,
      );
    },
    [ws, wsDraft],
  );

  const handleWsSave = useCallback(() => {
    setSaving(true);
    const persisted = saveWorkspace(wsDraft.projectName, wsDraft.workspacePath, wsDraft.apiKey);
    if (persisted) {
      setWs(wsDraft);
      setWsDirty(false);
      setMessage({ text: t('settings.saved'), kind: 'success' });
    } else {
      setMessage({ text: t('settings.storageUnavailable'), kind: 'error' });
    }
    setSaving(false);
  }, [wsDraft, t]);

  const handleWsCancel = useCallback(() => {
    setWsDraft(ws);
    setWsDirty(false);
  }, [ws]);

  const handleReset = useCallback(() => {
    setResetting(true);
    setLocale('th');
    setLang('th');
    const defaults = { projectName: '', workspacePath: '', apiKey: '' };
    const persisted = saveWorkspace('', '', '');
    setWs(defaults);
    setWsDraft(defaults);
    setWsDirty(false);
    setMessage(
      persisted
        ? { text: t('settings.resetDone'), kind: 'success' }
        : { text: t('settings.storageUnavailable'), kind: 'error' },
    );
    setResetting(false);
  }, [setLocale, t]);

  // ---- NATS handlers ----

  const handleNatsChange = useCallback(
    (field: keyof NatsSettings, value: string | boolean) => {
      const next = { ...natsDraft, [field]: value };
      setNatsDraft(next);
      setNatsDirty(
        next.enabled !== nats.enabled ||
          next.url !== nats.url ||
          next.clientId !== nats.clientId ||
          next.subjectPrefix !== nats.subjectPrefix,
      );
    },
    [nats, natsDraft],
  );

  // Saving restarts only the backend API process in-place and waits for a
  // health check before resolving — it does NOT restart the whole desktop app
  // (a prior version did, which raced with the single-instance guard and could
  // silently leave the old, unconfigured server running). A successful resolve
  // here means the new NATS settings are genuinely active, not just written to
  // disk — which is why the button must stay busy for the whole round trip.
  const saveNats = useApiAction(async (settings: NatsSettings) => {
    await saveNatsSettings(settings);
    return settings;
  });
  const natsSaving = saveNats.pending;

  const handleNatsSave = useCallback(async () => {
    const saved = await saveNats.run(natsDraft);
    if (saved) {
      setNats(saved);
      setNatsDirty(false);
      const live = await getNatsRuntimeStatus().catch(() => null);
      if (live) setNatsStatus(live);
      setMessage({ text: live && live.enabled && !live.connected ? 'Settings saved, but NATS is not connected.' : t('settings.saved'), kind: live && live.enabled && !live.connected ? 'error' : 'success' });
    } else {
      setMessage({
        text: `${t('settings.savedError')} ${errorMessage(saveNats.getError())}`,
        kind: 'error',
      });
    }
  }, [natsDraft, saveNats, t]);

  const handleNatsCancel = useCallback(() => {
    setNatsDraft(nats);
    setNatsDirty(false);
  }, [nats]);

  const localhostNats = /^(nats:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(natsDraft.url.trim());

  return (
    <PageLayout width="standard" title={t('settings.title')}>

      {message && (
        <Alert
          tone={message.kind === 'success' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('error.dismiss')}
        >
          {message.text}
        </Alert>
      )}

      <Stack gap="xl">
        <Panel title={t('settings.language')}>
          <FormField label={t('settings.language')}>
            {(control) => (
              <Select
                {...control}
                value={lang}
                onChange={(e) => handleLangChange(e.target.value as Locale)}
              >
                <option value="en">{t('settings.language.en')}</option>
                <option value="th">{t('settings.language.th')}</option>
              </Select>
            )}
          </FormField>
        </Panel>

        <Panel
          title={t('settings.system.title')}
          description={t('settings.system.description')}
          actions={
            <Freshness
              lastSuccessAt={runtimeResource.lastSuccessAt}
              stale={runtimeResource.stale}
              refreshing={runtimeResource.refreshing}
              paused={runtimeResource.paused}
              onRefresh={runtimeResource.refresh}
            />
          }
        >
          <Stack gap="lg">
            {runtimeResource.data === undefined && runtimeResource.error == null && <LoadingState />}
            {runtimeResource.error != null && (
              <ErrorBanner error={runtimeResource.error} onRetry={runtimeResource.refresh} />
            )}
            {runtimeResource.data && (
              <>
                {/* Was a bare '✓' glyph with no accessible name. The shared
                    indicator states the condition in words next to the dot. */}
                <Alert tone="success" title={t('settings.system.singleExecutor')}>
                  {t('settings.system.singleExecutorDetail')}
                </Alert>

                <FactList>
                  <Fact label={t('settings.system.runtime')}>
                    {runtimeResource.data.runtimeMode === 'packaged-windows-desktop'
                      ? t('settings.system.runtime.packaged')
                      : t('settings.system.runtime.server')}
                  </Fact>
                  <Fact label={t('settings.system.executorOwner')}>
                    {runtimeResource.data.executor.owner === 'api-local-worker'
                      ? t('settings.system.executor.api')
                      : t('settings.system.executor.external')}
                  </Fact>
                  <Fact label={t('settings.system.executorMode')}>
                    {runtimeResource.data.executor.mode === 'typescript-windows-spooler'
                      ? t('settings.system.executor.windowsSpooler')
                      : t('settings.system.executor.external')}
                  </Fact>
                  <Fact label={t('settings.system.discoveryOwner')}>
                    {t('settings.system.discovery.goRunner')}
                  </Fact>
                  <Fact label={t('settings.system.runnerClaims')}>
                    {runtimeResource.data.discovery.jobsEnabled
                      ? t('settings.system.runnerClaims.enabled')
                      : t('settings.system.runnerClaims.disabled')}
                  </Fact>
                  <Fact label={t('settings.system.protocolScope')}>
                    {runtimeResource.data.supportedProductionProtocols.length
                      ? runtimeResource.data.supportedProductionProtocols.join(', ')
                      : t('common.noData')}
                  </Fact>
                </FactList>

                <Text as="p" tone="muted">
                  {t('settings.system.deferred')}{' '}
                  <Mono tone="muted">{runtimeResource.data.deferredProtocols.join(', ')}</Mono>
                </Text>

                <SectionHeading
                  level={3}
                  title={t('settings.readiness.title')}
                  description={t('settings.readiness.description')}
                  actions={
                    <Freshness
                      lastSuccessAt={readinessResource.lastSuccessAt}
                      stale={readinessResource.stale}
                      refreshing={readinessResource.refreshing}
                      paused={readinessResource.paused}
                      onRefresh={readinessResource.refresh}
                    />
                  }
                />

                {readinessResource.data === undefined && readinessResource.error == null && <LoadingState />}
                {readinessResource.error != null && (
                  <ErrorBanner error={readinessResource.error} onRetry={readinessResource.refresh} />
                )}
                {readinessResource.data && (
                  <RecordList aria-label={t('settings.readiness.title')}>
                    {Object.entries(readinessResource.data.components).map(([key, item]) => (
                      <RecordCard key={key}>
                        <Stack gap="xs">
                          <RecordHeader>
                            <StatusIndicator condition={item.state} tone={READINESS_TONE[item.state]}>
                              {readinessLabels[key] ?? key}
                            </StatusIndicator>
                            <Badge tone={READINESS_BADGE[item.state]}>{readinessStateLabel(item.state)}</Badge>
                          </RecordHeader>
                          <Text tone="muted">{item.message}</Text>
                          {item.action && (
                            <Text size="label" tone="info">
                              {t('settings.readiness.action')} {item.action}
                            </Text>
                          )}
                        </Stack>
                      </RecordCard>
                    ))}
                  </RecordList>
                )}

                <Stack gap="sm">
                  <Inline gap="sm">
                    <Button
                      variant="secondary"
                      busy={backingUp}
                      busyLabel={t('common.loading')}
                      onClick={() => {
                        setBackingUp(true);
                        void apiDownload('/v1/system/database-backup', `printops-backup-${new Date().toISOString().slice(0, 10)}.db`)
                          .catch((cause) => setMessage({ text: errorMessage(cause), kind: 'error' }))
                          .finally(() => setBackingUp(false));
                      }}
                    >
                      {t('settings.database.backup')}
                    </Button>
                    <Button
                      variant="secondary"
                      busy={downloadingSupport}
                      busyLabel={t('common.loading')}
                      onClick={() => {
                        setDownloadingSupport(true);
                        void apiDownload('/v1/system/support-bundle', `printops-support-${new Date().toISOString().slice(0, 10)}.json`)
                          .catch((cause) => setMessage({ text: errorMessage(cause), kind: 'error' }))
                          .finally(() => setDownloadingSupport(false));
                      }}
                    >
                      {t('settings.support.download')}
                    </Button>
                  </Inline>
                  <Text as="p" size="label" tone="muted">{t('settings.database.backupHint')}</Text>
                  <Text as="p" size="label" tone="muted">{t('settings.support.hint')}</Text>
                </Stack>
              </>
            )}
          </Stack>
        </Panel>

        <Panel
          title={t('settings.workspace')}
          footer={
            <>
              <Button
                variant="danger"
                disabled={saving}
                busy={resetting}
                busyLabel={t('common.loading')}
                onClick={handleReset}
              >
                {t('common.reset')}
              </Button>
              <Button
                variant="secondary"
                disabled={!wsDirty || saving || resetting}
                onClick={handleWsCancel}
              >
                {t('common.cancel')}
              </Button>
              <Button
                disabled={!wsDirty || resetting}
                busy={saving}
                busyLabel={t('common.loading')}
                onClick={handleWsSave}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <Stack gap="lg">
            <FormField label={t('settings.workspace.projectName')}>
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={wsDraft.projectName}
                  placeholder={t('settings.workspace.projectNamePlaceholder')}
                  onChange={(e) => handleWsChange('projectName', e.target.value)}
                  disabled={saving || resetting}
                />
              )}
            </FormField>
            <FormField label={t('settings.workspace.workspacePath')}>
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={wsDraft.workspacePath}
                  placeholder={t('settings.workspace.workspacePathPlaceholder')}
                  onChange={(e) => handleWsChange('workspacePath', e.target.value)}
                  disabled={saving || resetting}
                />
              )}
            </FormField>
            <FormField label={t('settings.workspace.apiKey')} hint={t('settings.workspace.apiKeyHint')}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="off"
                  value={wsDraft.apiKey}
                  placeholder={t('settings.workspace.apiKeyPlaceholder')}
                  onChange={(e) => handleWsChange('apiKey', e.target.value)}
                  disabled={saving || resetting}
                />
              )}
            </FormField>
          </Stack>
        </Panel>

        {/* NATS client configuration (desktop only) */}
        <Panel title={t('settings.nats.title')}>
          {natsLoading && <LoadingState />}

          {!natsLoading && !natsSupported && (
            <Text as="p" tone="muted">{t('settings.nats.desktopOnly')}</Text>
          )}

          {!natsLoading && natsSupported && (
            <Stack gap="lg">
              <Text as="p" tone="muted">{t('settings.nats.description')}</Text>

              {natsStatus && (
                <FactList aria-label={t('settings.nats.diagnostics')}>
                  <Fact label={t('settings.nats.state')}>{natsStatus.state}</Fact>
                  <Fact label={t('settings.nats.server')}>{natsStatus.server ?? t('common.noData')}</Fact>
                  <Fact label={t('settings.nats.intake')}>
                    {natsStatus.intakeReady ? t('settings.readiness.state.READY') : t('settings.readiness.state.UNAVAILABLE')}
                  </Fact>
                  <Fact label={t('settings.nats.callback')}>
                    {natsStatus.callbackPublishReady ? t('settings.readiness.state.READY') : t('settings.readiness.state.UNAVAILABLE')}
                  </Fact>
                  <Fact label={t('settings.nats.lastConnected')}>{natsStatus.lastConnectedAt ?? t('common.noData')}</Fact>
                  <Fact label={t('settings.nats.lastAttempt')}>{natsStatus.lastAttemptAt ?? t('common.noData')}</Fact>
                  <Fact label={t('settings.nats.nextRetry')}>{natsStatus.nextRetryAt ?? t('common.noData')}</Fact>
                  {natsStatus.lastErrorCode && (
                    <Fact label={t('settings.nats.lastError')}>
                      <Stack gap="xs">
                        <Text>{natsStatus.lastErrorStage}: {natsStatus.lastErrorCode}</Text>
                        <Text tone="muted">{natsStatus.lastErrorMessage}</Text>
                      </Stack>
                    </Fact>
                  )}
                </FactList>
              )}

              <Inline gap="sm">
                <Button variant="secondary" busy={natsTesting} busyLabel="Testing…" onClick={() => void handleNatsTest()}>
                  Test connection
                </Button>
              </Inline>

              <Checkbox
                label={t('settings.nats.enabled')}
                checked={natsDraft.enabled}
                onChange={(e) => handleNatsChange('enabled', e.target.checked)}
                disabled={natsSaving}
              />

              <FormField label={t('settings.nats.url')}>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    value={natsDraft.url}
                    placeholder="nats://nats.example:4222"
                    onChange={(e) => handleNatsChange('url', e.target.value)}
                    disabled={natsSaving || !natsDraft.enabled}
                  />
                )}
              </FormField>

              {localhostNats && (
                <Alert tone="warning">
                  Warning: localhost and 127.0.0.1 mean this PrintOps workstation, not a remote broker.
                </Alert>
              )}

              <FormField label={t('settings.nats.clientId')}>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    value={natsDraft.clientId}
                    placeholder="pharmacy-counter-01"
                    onChange={(e) => handleNatsChange('clientId', e.target.value)}
                    disabled={natsSaving || !natsDraft.enabled}
                  />
                )}
              </FormField>

              <FormField label={t('settings.nats.subjectPrefix')}>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    value={natsDraft.subjectPrefix}
                    placeholder="medisync.print.intake"
                    onChange={(e) => handleNatsChange('subjectPrefix', e.target.value)}
                    disabled={natsSaving || !natsDraft.enabled}
                  />
                )}
              </FormField>

              <Mono tone="muted">
                {natsDraft.enabled && natsDraft.clientId
                  ? `${natsDraft.subjectPrefix || 'medisync.print.intake'}.${natsDraft.clientId}`
                  : t('settings.nats.subjectPreviewDisabled')}
              </Mono>

              <Inline gap="sm">
                <Button
                  disabled={!natsDirty}
                  busy={natsSaving}
                  busyLabel={t('common.loading')}
                  onClick={() => void handleNatsSave()}
                >
                  {t('settings.nats.applyAndRestart')}
                </Button>
                <Button variant="secondary" disabled={!natsDirty || natsSaving} onClick={handleNatsCancel}>
                  {t('common.cancel')}
                </Button>
              </Inline>
            </Stack>
          )}
        </Panel>

        <ServiceAccountSettings />
      </Stack>
    </PageLayout>
  );
}
