/**
 * One NATS settings code path for both builds.
 *
 * The panel used to be gated on `isTauriAvailable()`, so a Linux server install
 * showed "NATS settings are only available in the PrintOps desktop app" — even
 * though the API it talks to owns the connection. The API now exposes
 * GET/PUT /v1/print-flow/nats-settings, so the dashboard asks the API first and
 * only falls back to the desktop shell's bridge when the API cannot answer
 * (a bundle whose sidecar is still starting, or a server too old to have the
 * endpoint). One form, one behaviour, no "desktop only" wording.
 */
import {
  ApiError,
  fetchNatsSettings,
  updateNatsSettings,
  type ApiNatsSettingsSource,
  type NatsRuntimeStatus,
} from './api/client.js';
import {
  DEFAULT_NATS_SETTINGS,
  getNatsSettings as getDesktopNatsSettings,
  isTauriAvailable,
  saveNatsSettings as saveDesktopNatsSettings,
  type NatsSettings,
} from './tauri.js';

export type NatsSettingsBackend = 'api' | 'desktop' | 'unavailable';

export interface LoadedNatsSettings {
  settings: NatsSettings;
  source: ApiNatsSettingsSource;
}

/**
 * Decides where the panel's data comes from.
 *
 * A refusal (401/403/400) still proves the API answered, so it stays on the API
 * path and the save button surfaces the server's own message; only a transport
 * failure or a missing endpoint (404) counts as "the API cannot do this".
 */
export async function resolveNatsSettingsBackend(): Promise<NatsSettingsBackend> {
  try {
    await fetchNatsSettings();
    return 'api';
  } catch (error) {
    if (error instanceof ApiError && !error.isNetwork && error.status !== 404) return 'api';
    return (await isTauriAvailable()) ? 'desktop' : 'unavailable';
  }
}

/** A settings payload from a real endpoint, not an unrelated JSON body. */
function isNatsSettingsView(value: unknown): value is { settings: Partial<NatsSettings>; source?: ApiNatsSettingsSource } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const settings = (value as { settings?: unknown }).settings;
  return typeof settings === 'object' && settings !== null && !Array.isArray(settings);
}

export async function loadNatsSettings(backend: NatsSettingsBackend): Promise<LoadedNatsSettings | null> {
  if (backend === 'api') {
    const view = await fetchNatsSettings();
    // Never render a form from a payload that is not a settings view: a proxy or
    // an older API answering with something else must not look like
    // "NATS is disabled with empty fields".
    if (!isNatsSettingsView(view)) return null;
    return { settings: { ...DEFAULT_NATS_SETTINGS, ...view.settings }, source: view.source ?? 'default' };
  }
  if (backend === 'desktop') {
    const settings = await getDesktopNatsSettings();
    return settings ? { settings: { ...DEFAULT_NATS_SETTINGS, ...settings }, source: 'file' } : null;
  }
  return null;
}

/**
 * Persists the settings. Resolves with the manager status the API applied when it
 * answered, or `null` on the desktop bridge (which restarts its server, so the
 * caller re-reads the status endpoint instead).
 */
export async function persistNatsSettings(
  backend: NatsSettingsBackend,
  settings: NatsSettings,
): Promise<NatsRuntimeStatus | null> {
  if (backend === 'api') {
    const applied = await updateNatsSettings(settings);
    return applied.status;
  }
  if (backend === 'desktop') {
    await saveDesktopNatsSettings(settings);
    return null;
  }
  throw new Error('NATS settings are unavailable: the local API did not respond');
}
