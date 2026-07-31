import { useCallback, useEffect, useState } from 'react';
import { useLocale, type Locale } from '../i18n/index.js';
import { errorMessage } from '../api/errors.js';
import { getNatsRuntimeStatus, testNatsConnection, type NatsRuntimeStatus } from '../api/client.js';
import { useApiAction } from '../hooks/useApiAction.js';
import { Alert } from '../components/Alert.js';
import {
  type NatsSettings,
  DEFAULT_NATS_SETTINGS,
  getNatsSettings,
  saveNatsSettings,
  isTauriAvailable,
} from '../tauri.js';

// ----- workspace profile persistence -----

const WS_PROJECT_KEY = 'printops-workspace-project';
const WS_PATH_KEY = 'printops-workspace-path';
const API_KEY_STORAGE_KEY = 'printops-api-key';

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

  // NATS client configuration (desktop only)
  const [nats, setNats] = useState<NatsSettings>(DEFAULT_NATS_SETTINGS);
  const [natsDraft, setNatsDraft] = useState<NatsSettings>(DEFAULT_NATS_SETTINGS);
  const [natsDirty, setNatsDirty] = useState(false);
  const [natsLoading, setNatsLoading] = useState(true);
  const [natsSupported, setNatsSupported] = useState(false);
  const [natsStatus, setNatsStatus] = useState<NatsRuntimeStatus | null>(null);
  const [natsTesting, setNatsTesting] = useState(false);

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

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      {message && (
        <Alert
          tone={message.kind === 'success' ? 'success' : 'error'}
          onDismiss={() => setMessage(null)}
          dismissLabel={t('error.dismiss')}
        >
          {message.text}
        </Alert>
      )}

      {/* Language */}
      <section className="settings-section" aria-labelledby="settings-lang-heading">
        <h2 id="settings-lang-heading">{t('settings.language')}</h2>
        <div className="settings-field">
          <label htmlFor="settings-lang">
            {t('settings.language')}
          </label>
          <select
            id="settings-lang"
            value={lang}
            onChange={(e) => handleLangChange(e.target.value as Locale)}
            disabled={false}
          >
            <option value="en">{t('settings.language.en')}</option>
            <option value="th">{t('settings.language.th')}</option>
          </select>
        </div>
      </section>

      {/* Workspace Profile */}
      <section
        className="settings-section"
        aria-labelledby="settings-ws-heading"
      >
        <h2 id="settings-ws-heading">{t('settings.workspace')}</h2>
        <div className="settings-field">
          <label htmlFor="settings-ws-project">
            {t('settings.workspace.projectName')}
          </label>
          <input
            id="settings-ws-project"
            type="text"
            value={wsDraft.projectName}
            placeholder={t('settings.workspace.projectNamePlaceholder')}
            onChange={(e) => handleWsChange('projectName', e.target.value)}
            disabled={saving || resetting}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="settings-ws-path">
            {t('settings.workspace.workspacePath')}
          </label>
          <input
            id="settings-ws-path"
            type="text"
            value={wsDraft.workspacePath}
            placeholder={t('settings.workspace.workspacePathPlaceholder')}
            onChange={(e) => handleWsChange('workspacePath', e.target.value)}
            disabled={saving || resetting}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="settings-ws-apikey">
            {t('settings.workspace.apiKey')}
          </label>
          <input
            id="settings-ws-apikey"
            type="text"
            value={wsDraft.apiKey}
            placeholder={t('settings.workspace.apiKeyPlaceholder')}
            onChange={(e) => handleWsChange('apiKey', e.target.value)}
            disabled={saving || resetting}
          />
          <p className="settings-hint">
            {t('settings.workspace.apiKeyHint')}
          </p>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="settings-btn-primary"
            disabled={!wsDirty || saving || resetting}
            onClick={handleWsSave}
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
          <button
            type="button"
            className="settings-btn-secondary"
            disabled={!wsDirty || saving || resetting}
            onClick={handleWsCancel}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="settings-btn-danger"
            disabled={saving}
            onClick={handleReset}
          >
            {resetting ? t('common.loading') : t('common.reset')}
          </button>
        </div>
      </section>

      {/* NATS client configuration (desktop only) */}
      <section className="settings-section" aria-labelledby="settings-nats-heading">
        <h2 id="settings-nats-heading">{t('settings.nats.title')}</h2>

        {natsLoading && <p className="settings-hint">{t('common.loading')}</p>}

        {!natsLoading && !natsSupported && (
          <p className="settings-hint">{t('settings.nats.desktopOnly')}</p>
        )}

        {!natsLoading && natsSupported && (
          <>
            <p className="settings-hint">{t('settings.nats.description')}</p>
            {natsStatus && (
              <div className="settings-hint settings-hint--mono" role="status">
                NATS: {natsStatus.state} | server: {natsStatus.server ?? 'not configured'} | intake: {natsStatus.intakeReady ? 'ready' : 'not ready'}
                {natsStatus.lastErrorMessage && <><br />Last error: {natsStatus.lastErrorMessage}</>}
              </div>
            )}
            <div className="settings-actions">
              <button type="button" className="settings-btn-secondary" disabled={natsTesting} onClick={() => void handleNatsTest()}>
                {natsTesting ? 'Testing...' : 'Test connection'}
              </button>
            </div>
            <div className="settings-field settings-field--checkbox">
              <label htmlFor="settings-nats-enabled">
                <input
                  id="settings-nats-enabled"
                  type="checkbox"
                  checked={natsDraft.enabled}
                  onChange={(e) => handleNatsChange('enabled', e.target.checked)}
                  disabled={natsSaving}
                />
                {t('settings.nats.enabled')}
              </label>
            </div>
            <div className="settings-field">
              <label htmlFor="settings-nats-url">{t('settings.nats.url')}</label>
              <input
                id="settings-nats-url"
                type="text"
                value={natsDraft.url}
                placeholder="nats://nats.example:4222"
                onChange={(e) => handleNatsChange('url', e.target.value)}
                disabled={natsSaving || !natsDraft.enabled}
              />
            </div>
            {/^(nats:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(natsDraft.url.trim()) && (
              <p className="settings-hint">Warning: localhost and 127.0.0.1 mean this PrintOps workstation, not a remote broker.</p>
            )}
            <div className="settings-field">
              <label htmlFor="settings-nats-client">
                {t('settings.nats.clientId')}
              </label>
              <input
                id="settings-nats-client"
                type="text"
                value={natsDraft.clientId}
                placeholder="pharmacy-counter-01"
                onChange={(e) => handleNatsChange('clientId', e.target.value)}
                disabled={natsSaving || !natsDraft.enabled}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="settings-nats-prefix">
                {t('settings.nats.subjectPrefix')}
              </label>
              <input
                id="settings-nats-prefix"
                type="text"
                value={natsDraft.subjectPrefix}
                placeholder="medisync.print.intake"
                onChange={(e) => handleNatsChange('subjectPrefix', e.target.value)}
                disabled={natsSaving || !natsDraft.enabled}
              />
            </div>
            <p className="settings-hint settings-hint--mono">
              {natsDraft.enabled && natsDraft.clientId
                ? `${natsDraft.subjectPrefix || 'medisync.print.intake'}.${natsDraft.clientId}`
                : t('settings.nats.subjectPreviewDisabled')}
            </p>
            <div className="settings-actions">
              <button
                type="button"
                className="settings-btn-primary"
                disabled={!natsDirty || natsSaving}
                onClick={() => void handleNatsSave()}
              >
                {natsSaving ? t('common.loading') : t('settings.nats.applyAndRestart')}
              </button>
              <button
                type="button"
                className="settings-btn-secondary"
                disabled={!natsDirty || natsSaving}
                onClick={handleNatsCancel}
              >
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
