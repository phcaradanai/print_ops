import { exportJsonFile } from '../tauri.js';

/**
 * Helper to export data to a JSON file.
 * Uses Native File System Access API (showSaveFilePicker) when available
 * so the user can choose the exact directory location on their machine.
 * Pre-fills workspace path setting if configured in Settings.
 */
export async function saveOrDownloadJsonFile(
  filename: string,
  data: unknown
): Promise<{ success: boolean; path?: string; cancelled?: boolean; message?: string }> {
  const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const workspacePath = (typeof localStorage !== 'undefined' && localStorage.getItem('printops-workspace-path')) || '';

  return exportJsonFile(filename, jsonString, workspacePath || undefined);
}
