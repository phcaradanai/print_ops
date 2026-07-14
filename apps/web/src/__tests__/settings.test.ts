import { describe, it, expect, beforeEach } from 'vitest';

// Test the workspace settings persistence logic from Settings.tsx
// (replicated for unit testing without React/DOM)

const WS_PROJECT_KEY = 'printops-workspace-project';
const WS_PATH_KEY = 'printops-workspace-path';
const LOCALE_KEY = 'printops-locale';

interface WorkspaceData {
  projectName: string;
  workspacePath: string;
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
    };
  }

  function saveWorkspace(projectName: string, workspacePath: string): void {
    store[WS_PROJECT_KEY] = projectName;
    store[WS_PATH_KEY] = workspacePath;
  }

  it('loads empty defaults when nothing is stored', () => {
    const ws = loadWorkspace();
    expect(ws.projectName).toBe('');
    expect(ws.workspacePath).toBe('');
  });

  it('saves and loads workspace data', () => {
    saveWorkspace('MyProject', 'C:\\workspace');
    const ws = loadWorkspace();
    expect(ws.projectName).toBe('MyProject');
    expect(ws.workspacePath).toBe('C:\\workspace');
  });

  it('handles empty project name', () => {
    saveWorkspace('', 'C:\\path');
    const ws = loadWorkspace();
    expect(ws.projectName).toBe('');
    expect(ws.workspacePath).toBe('C:\\path');
  });

  it('overwrites previous values', () => {
    saveWorkspace('Old', '/old/path');
    saveWorkspace('New', '/new/path');
    const ws = loadWorkspace();
    expect(ws.projectName).toBe('New');
    expect(ws.workspacePath).toBe('/new/path');
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
