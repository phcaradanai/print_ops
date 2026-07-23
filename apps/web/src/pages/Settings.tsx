import { useCallback, useEffect, useState } from 'react';
import { useLocale, type Locale } from '../i18n/index.js';
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

function loadWorkspace(): { projectName: string; workspacePath: string } {
  try {
    return {
      projectName: localStorage.getItem(WS_PROJECT_KEY) ?? '',
      workspacePath: localStorage.getItem(WS_PATH_KEY) ?? '',
    };
  } catch {
    return { projectName: '', workspacePath: '' };
  }
}

function saveWorkspace(projectName: string, workspacePath: string): void {
  try {
    localStorage.setItem(WS_PROJECT_KEY, projectName);
    localStorage.setItem(WS_PATH_KEY, workspacePath);
  } catch {
    // localStorage unavailable
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
  const [natsSaving, setNatsSaving] = useState(false);

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
    (field: 'projectName' | 'workspacePath', value: string) => {
      const next = { ...wsDraft, [field]: value };
      setWsDraft(next);
      setWsDirty(
        next.projectName !== ws.projectName ||
          next.workspacePath !== ws.workspacePath,
      );
    },
    [ws, wsDraft],
  );

  const handleWsSave = useCallback(() => {
    setSaving(true);
    try {
      saveWorkspace(wsDraft.projectName, wsDraft.workspacePath);
      setWs(wsDraft);
      setWsDirty(false);
      setMessage({ text: t('settings.saved'), kind: 'success' });
    } catch {
      setMessage({ text: t('settings.savedError'), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }, [wsDraft, t]);

  const handleWsCancel = useCallback(() => {
    setWsDraft(ws);
    setWsDirty(false);
  }, [ws]);

  const handleReset = useCallback(() => {
    setResetting(true);
    try {
      setLocale('th');
      setLang('th');
      const defaults = { projectName: '', workspacePath: '' };
      saveWorkspace('', '');
      setWs(defaults);
      setWsDraft(defaults);
      setWsDirty(false);
      setMessage({ text: t('settings.resetDone'), kind: 'success' });
    } catch {
      setMessage({ text: t('settings.savedError'), kind: 'error' });
    } finally {
      setResetting(false);
    }
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

  const handleNatsSave = useCallback(() => {
    setNatsSaving(true);
    saveNatsSettings(natsDraft)
      .then(() => {
        // `saveNats_settings` restarts the desktop shell; this line only runs
        // if the command somehow returns without a restart.
        setNats(natsDraft);
        setNatsDirty(false);
        setMessage({ text: t('settings.saved'), kind: 'success' });
      })
      .catch((err: unknown) => {
        setMessage({
          text: err instanceof Error ? err.message : t('settings.savedError'),
          kind: 'error',
        });
      })
      .finally(() => setNatsSaving(false));
  }, [natsDraft, t]);

  const handleNatsCancel = useCallback(() => {
    setNatsDraft(nats);
    setNatsDirty(false);
  }, [nats]);

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      {message && (
        <div
          className={`settings-message settings-message--${message.kind}`}
          role="status"
          aria-live="polite"
        >
          {message.text}
        </div>
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
                onClick={handleNatsSave}
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
