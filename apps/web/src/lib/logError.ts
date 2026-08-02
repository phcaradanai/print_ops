/**
 * Single console channel for frontend failures (FE-01).
 *
 * Before this, failures were logged four different ways (`[apiFetch]`,
 * `[Printers] API failed`, `[Dashboard] /jobs failed`, `[PrintOps] React render
 * error`) and 29 `catch {}` blocks logged nothing at all. Support asking a
 * hospital operator to "open the console and read the errors" had no single
 * prefix to grep for.
 *
 * Everything now goes through `logError(scope, err)` and is tagged
 * `[PrintOps][<scope>]`. A bounded ring buffer keeps the last entries in memory
 * so a future diagnostics view can show them without a console; it deliberately
 * holds no payloads, only scope, message and technical summary.
 */

import { ApiError, errorMessage, errorTechnicalSummary } from '../api/errors.js';

export interface LoggedError {
  at: string;
  scope: string;
  message: string;
  technical: string | null;
  /** Consecutive identical occurrences collapsed into this entry (>= 1). */
  repeats: number;
}

const MAX_ENTRIES = 100;
const buffer: LoggedError[] = [];

/**
 * Consecutive identical failures collapse into the previous entry instead of
 * pushing a new one. JobQueue polls every 1.5s: without this, one API outage
 * emits ~40 console lines per minute and fills the whole buffer with the same
 * network error inside three minutes — destroying the diagnostic value of both
 * exactly when it is needed. The first occurrence is always logged in full.
 */
export function logError(scope: string, err: unknown): void {
  const entry: LoggedError = {
    at: new Date().toISOString(),
    scope,
    message: errorMessage(err),
    technical: errorTechnicalSummary(err),
    repeats: 1,
  };

  const previous = buffer[buffer.length - 1];
  if (previous && previous.scope === entry.scope && previous.message === entry.message) {
    previous.repeats += 1;
    previous.at = entry.at;
    return;
  }

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();

  const suffix = entry.technical ? ` (${entry.technical})` : '';
  console.error(`[PrintOps][${scope}] ${entry.message}${suffix}`);
  if (!(err instanceof ApiError) && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
}

/** Newest last. Copy, so callers cannot mutate the buffer. */
export function recentErrors(): LoggedError[] {
  return [...buffer];
}

export function clearRecentErrors(): void {
  buffer.length = 0;
}
