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
  // Restarts only the backend API process in-place (not the whole desktop
  // app) and waits for it to become healthy with the new settings before
  // resolving. Throws if the server fails to start or doesn't come back
  // healthy in time, so the caller can show a real success/failure result.
  await invoke('save_nats_settings', { settings });
}

let saveDialogFn: ((options: Record<string, unknown>) => Promise<string | null>) | null = null;

async function getSaveDialog(): Promise<((options: Record<string, unknown>) => Promise<string | null>) | null> {
  if (saveDialogFn !== null) return saveDialogFn;
  try {
    const mod = await import('@tauri-apps/plugin-dialog');
    saveDialogFn = (options: Record<string, unknown>) => mod.save(options);
  } catch {
    saveDialogFn = null;
  }
  return saveDialogFn;
}

/**
 * Saves text content to disk via the native Save As dialog. `suggestedDir`
 * (the configured workspace path, if any) pre-fills the dialog's starting
 * folder so accepting the default just works; the user can still browse
 * elsewhere. Returns the chosen path, or `null` if the dialog isn't
 * available (plain browser) or the user cancelled.
 */
export async function saveExportFile(
  filename: string,
  content: string,
  suggestedDir?: string,
): Promise<string | null> {
  const save = await getSaveDialog();
  const invoke = await getInvoke();
  if (!save || !invoke) return null;
  const defaultPath = suggestedDir ? `${suggestedDir.replace(/[\\/]+$/, '')}/${filename}` : filename;
  const path = await save({ defaultPath, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path) return null;
  await invoke('write_export_file', { path, content });
  return path;
}

/**
 * Universal export function that:
 * 1. Uses Tauri desktop dialog if available.
 * 2. Uses Web File System Access API (showSaveFilePicker) in browser so user can select directory location.
 * 3. Uses configured workspace path from Settings or fallback download link.
 */
export async function exportJsonFile(
  filename: string,
  content: string,
  suggestedDir?: string,
): Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }> {
  const workspacePath = suggestedDir || (typeof localStorage !== 'undefined' ? localStorage.getItem('printops-workspace-path') : '') || '';

  // 1. Desktop Tauri shell. A cancelled Tauri dialog must NOT fall through to
  // the browser-only paths below — those would silently blob-download the
  // file with no visible feedback, which is the exact bug this replaces.
  if (await isTauriAvailable()) {
    try {
      const tauriPath = await saveExportFile(filename, content, workspacePath || undefined);
      if (tauriPath) {
        return { success: true, path: tauriPath, message: `บันทึกไฟล์เรียบร้อยแล้ว: ${tauriPath}` };
      }
      return { success: false, cancelled: true };
    } catch (err: any) {
      // Surface the real failure instead of leaving the button looking dead —
      // a rejected invoke() here previously vanished as an unhandled promise
      // rejection with zero visible feedback.
      return { success: false, message: `บันทึกไฟล์ไม่สำเร็จ: ${err?.message ?? String(err)}` };
    }
  }

  // 2. Web Browser File System Access API (showSaveFilePicker)
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'JSON File (*.json)',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return {
        success: true,
        path: handle.name,
        message: `บันทึกไฟล์ "${handle.name}" เรียบร้อยแล้ว`,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, cancelled: true };
      }
    }
  }

  // 3. Browser blob download fallback
  try {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);

    const msg = workspacePath
      ? `ส่งออกไฟล์ "${filename}" เรียบร้อยแล้ว (โปรไฟล์พื้นที่ทำงาน: ${workspacePath})`
      : `ส่งออกไฟล์ "${filename}" เรียบร้อยแล้ว`;

    return {
      success: true,
      path: workspacePath || filename,
      message: msg,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'ไม่สามารถส่งออกไฟล์ได้',
    };
  }
}
