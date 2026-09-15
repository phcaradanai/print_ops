import { describe, it, expect, beforeEach } from 'vitest';

// Test the workspace settings persistence logic from Settings.tsx
// (replicated for unit testing without React/DOM)

const WS_PROJECT_KEY = 'printops-workspace-project';
const WS_PATH_KEY = 'printops-workspace-path';
const API_KEY_STORAGE_KEY = 'printops-api-key';
const LOCALE_KEY = 'printops-locale';

interface WorkspaceData {
  projectName: string;
  workspacePath: string;
  apiKey: string;
}

type Locale = 'en' | 'th';

// Simulated localStorage
function createStore(): Record<string, string> {
  return {};
}

describe('workspace settings persistence', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = createStore();
  });

  function loadWorkspace(): WorkspaceData {
    return {
      projectName: store[WS_PROJECT_KEY] ?? '',
      workspacePath: store[WS_PATH_KEY] ?? '',
      apiKey: store[API_KEY_STORAGE_KEY] ?? '',
    };
  }

  function saveWorkspace(projectName: string, workspacePath: string, apiKey: string): void {
    store[WS_PROJECT_KEY] = projectName;
    store[WS_PATH_KEY] = workspacePath;
    if (apiKey.trim()) {
      store[API_KEY_STORAGE_KEY] = apiKey.trim();
    } else {
      delete store[API_KEY_STORAGE_KEY];
    }
  }

  function getApiKeyWithFallback(envFallback = 'printops-dev-apikey-2026'): string {
    const stored = store[API_KEY_STORAGE_KEY];
    if (stored !== undefined && stored.trim() !== '') {
      return stored.trim();
    }
    return envFallback;
  }

  it('loads empty defaults when nothing is stored', () => {
    const ws = loadWorkspace();
    expect(ws.projectName).toBe('');
    expect(ws.workspacePath).toBe('');
    expect(ws.apiKey).toBe('');
    expect(getApiKeyWithFallback()).toBe('printops-dev-apikey-2026');
  });

  it('saves and loads workspace data including API key', () => {
    saveWorkspace('MyProject', 'C:\\workspace', 'custom-api-key-123');
    const ws = loadWorkspace();
    expect(ws.projectName).toBe('MyProject');
    expect(ws.workspacePath).toBe('C:\\workspace');
    expect(ws.apiKey).toBe('custom-api-key-123');
    expect(getApiKeyWithFallback()).toBe('custom-api-key-123');
  });

  it('removes API key when saved as empty string and falls back to env', () => {
    saveWorkspace('MyProject', 'C:\\workspace', 'custom-key');
    expect(getApiKeyWithFallback()).toBe('custom-key');

    saveWorkspace('MyProject', 'C:\\workspace', '  ');
    const ws = loadWorkspace();
    expect(ws.apiKey).toBe('');
    expect(store[API_KEY_STORAGE_KEY]).toBeUndefined();
    expect(getApiKeyWithFallback('env-key-456')).toBe('env-key-456');
  });

  it('handles empty project name', () => {
    saveWorkspace('', 'C:\\path', 'custom-key');
    const ws = loadWorkspace();
    expect(ws.projectName).toBe('');
    expect(ws.workspacePath).toBe('C:\\path');
    expect(ws.apiKey).toBe('custom-key');
  });

  it('overwrites previous values', () => {
    saveWorkspace('Old', '/old/path', 'old-key');
    saveWorkspace('New', '/new/path', 'new-key');
    const ws = loadWorkspace();
    expect(ws.projectName).toBe('New');
    expect(ws.workspacePath).toBe('/new/path');
    expect(ws.apiKey).toBe('new-key');
    expect(getApiKeyWithFallback()).toBe('new-key');
  });
});

describe('locale persistence', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = createStore();
  });

  it('defaults to th (Thai) for hospital environment', () => {
    // Thai is the default in detectLocale()
    // without any stored value, it should default to 'th'
    const stored = store[LOCALE_KEY];
    const locale: Locale = stored === 'th' || stored === 'en' ? stored : 'th';
    expect(locale).toBe('th');
  });

  it('loads stored en locale', () => {
    store[LOCALE_KEY] = 'en';
    const stored = store[LOCALE_KEY];
    const locale: Locale = stored === 'th' || stored === 'en' ? stored : 'th';
    expect(locale).toBe('en');
  });

  it('loads stored th locale', () => {
    store[LOCALE_KEY] = 'th';
    const stored = store[LOCALE_KEY];
    const locale: Locale = stored === 'th' || stored === 'en' ? stored : 'th';
    expect(locale).toBe('th');
  });

  it('rejects invalid locale values, falls back to th', () => {
    store[LOCALE_KEY] = 'fr';
    const stored = store[LOCALE_KEY];
    const locale: Locale = stored === 'th' || stored === 'en' ? stored : 'th';
    expect(locale).toBe('th');
  });
});
