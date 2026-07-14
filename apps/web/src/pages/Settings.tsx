import { useCallback, useEffect, useState } from 'react';
import { useLocale, type Locale } from '../i18n/index.js';

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

// ----- theme persistence -----

type Theme = 'light' | 'dark' | 'system';
const THEME_KEY = 'printops-theme';

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'light';
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

// ----- settings page -----

export default function Settings() {
  const { t, locale, setLocale } = useLocale();

  // Language
  const [lang, setLang] = useState<Locale>(locale);

  // Theme
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [themeApplied, setThemeApplied] = useState(false);

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

  // Clear message after delay
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  // Apply theme on mount
  useEffect(() => {
    if (!themeApplied) {
      applyTheme(theme);
      setThemeApplied(true);
    }
  }, [theme, themeApplied]);

  // Watch system preference when theme is 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange() {
      applyTheme('system');
    }
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // ---- handlers ----

  const handleLangChange = useCallback(
    (next: Locale) => {
      setLang(next);
      setLocale(next);
      setMessage({ text: t('settings.saved'), kind: 'success' });
    },
    [setLocale, t],
  );

  const handleThemeChange = useCallback(
    (next: Theme) => {
      setTheme(next);
      saveTheme(next);
      applyTheme(next);
      setMessage({ text: t('settings.saved'), kind: 'success' });
    },
    [t],
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
      setTheme('light');
      saveTheme('light');
      applyTheme('light');
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

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>

      {message && (
        <div className={`settings-message settings-message--${message.kind}`}>
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

      {/* Appearance */}
      <section
        className="settings-section"
        aria-labelledby="settings-appearance-heading"
      >
        <h2 id="settings-appearance-heading">
          {t('settings.appearance')}
        </h2>
        <div className="settings-field">
          <label htmlFor="settings-theme">
            {t('settings.appearance.theme')}
          </label>
          <select
            id="settings-theme"
            value={theme}
            onChange={(e) => handleThemeChange(e.target.value as Theme)}
          >
            <option value="light">{t('settings.appearance.theme.light')}</option>
            <option value="dark">{t('settings.appearance.theme.dark')}</option>
            <option value="system">{t('settings.appearance.theme.system')}</option>
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
    </div>
  );
}
