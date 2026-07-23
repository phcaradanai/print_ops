// Thin bridge to the Tauri desktop shell commands. The same web bundle runs
// inside the desktop webview (where `@tauri-apps/api` resolves) and in a plain
// browser during development (where it does not). Guard every call so the
// Settings page degrades gracefully to a clear message instead of crashing.

let invokeFn: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

async function getInvoke(): Promise<((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null> {
  if (invokeFn !== null) return invokeFn;
  try {
    const mod = await import('@tauri-apps/api/core');
    invokeFn = (cmd: string, args?: Record<string, unknown>) => mod.invoke(cmd, args);
  } catch {
    invokeFn = null;
  }
  return invokeFn;
}

export interface NatsSettings {
  enabled: boolean;
  url: string;
  clientId: string;
  subjectPrefix: string;
}

export const DEFAULT_NATS_SETTINGS: NatsSettings = {
  enabled: false,
  url: '',
  clientId: '',
  subjectPrefix: 'medisync.print.intake',
};

export async function isTauriAvailable(): Promise<boolean> {
  return (await getInvoke()) !== null;
}

export async function getNatsSettings(): Promise<NatsSettings | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    const result = (await invoke('get_nats_settings')) as NatsSettings;
    return { ...DEFAULT_NATS_SETTINGS, ...result };
  } catch {
    return null;
  }
}

export async function saveNatsSettings(settings: NatsSettings): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error('NATS settings are only available in the desktop app');
  // This call does not return: the desktop shell restarts itself to apply.
  await invoke('save_nats_settings', { settings });
}
