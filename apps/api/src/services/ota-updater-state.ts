import { readFile } from 'node:fs/promises';

export type ExternalUpdaterTerminalPhase = 'COMPLETED' | 'ROLLED_BACK' | 'ROLLBACK_FAILED' | 'FAILED';

export interface ExternalUpdaterStateSnapshot {
  operationId: string;
  version: string;
  phase: string;
  error?: string;
}

export async function readExternalUpdaterState(path: string): Promise<ExternalUpdaterStateSnapshot | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const operationId = value['operation_id'];
    const version = value['version'];
    const phase = value['phase'];
    const error = value['error'];
    if (typeof operationId !== 'string' || !operationId
      || typeof version !== 'string' || !version
      || typeof phase !== 'string' || !phase) return null;
    return {
      operationId,
      version,
      phase,
      ...(typeof error === 'string' && error ? { error: error.slice(0, 500) } : {}),
    };
  } catch {
    return null;
  }
}

export function isExternalUpdaterTerminalPhase(
  phase: string,
): phase is ExternalUpdaterTerminalPhase {
  return phase === 'COMPLETED'
    || phase === 'ROLLED_BACK'
    || phase === 'ROLLBACK_FAILED'
    || phase === 'FAILED';
}
