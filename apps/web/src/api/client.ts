import { ApiError, apiErrorFromResponse, networkApiError } from './errors.js';
import { logError } from '../lib/logError.js';

export { ApiError, errorMessage, errorTechnicalSummary } from './errors.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
}

const API_KEY_STORAGE_KEY = 'printops-api-key';

export function getApiKey(): string {
  const stored = storageGet(API_KEY_STORAGE_KEY);
  if (stored !== null && stored.trim() !== '') {
    return stored.trim();
  }
  return (import.meta.env.VITE_API_KEY as string | undefined) ??
         (import.meta.env.VITE_DEV_API_KEY as string | undefined) ??
         'printops-dev-apikey-2026';
}

export function saveApiKey(key: string): void {
  if (key.trim()) {
    storageSet(API_KEY_STORAGE_KEY, key.trim());
  } else {
    storageRemove(API_KEY_STORAGE_KEY);
  }
}

/**
 * `localStorage` is not guaranteed: it throws in private-mode/partitioned
 * contexts and does not exist at all outside a browser (SSR-style rendering,
 * tests). `getApiKey` already guarded it; `token()` did not, so a single
 * unavailable store turned every API call into an unrelated
 * `ReferenceError: localStorage is not defined` before the request was even
 * built. Guard both directions in one place.
 */
function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the session simply does not survive a reload
  }
}

function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

function token(): string {
  return storageGet('token') ?? '';
}

/**
 * Session-expiry notification (FE-01.1).
 *
 * A token that expired mid-session used to produce a 401 on every subsequent
 * call, which each page rendered as its own "could not load" error. The
 * operator was left on a shell that could not load anything, with no hint that
 * signing in again was the fix.
 *
 * Only **401** unwinds the session. A **403** is a permission decision about a
 * valid session — logging the user out on 403 would kick a VIEWER out of the
 * app for clicking an admin action.
 */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorized(): void {
  storageRemove('token');
  for (const listener of [...unauthorizedListeners]) {
    try {
      listener();
    } catch {
      // a broken listener must not swallow the session reset for the others
    }
  }
}

function authHeaders(): HeadersInit {
  const authToken = token();
  const apiKey = getApiKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }
  return headers;
}

// API base — empty string means same-origin relative (dev Vite proxy or prod .exe)
export function apiBase(): string {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE as string;
  return '';
}
export function healthUrl(): string {
  return apiBase() + '/health';
}

function apiUrl(path: string): string {
  // v1 routes: /api/v1/... (dev proxy strips /api, so double prefix needed)
  if (path.startsWith('/v1/')) {
    const prefix = import.meta.env.DEV ? '/api/api' : '/api';
    return apiBase() + prefix + path;
  }
  // Legacy routes: /jobs, /me, /runners, etc. — no prefix in production
  return apiBase() + path;
}

/**
 * Performs an authenticated API call. Always rejects with an {@link ApiError}
 * carrying the status, the server's own message/code and any trace id, so
 * callers can show the operator something actionable instead of
 * "API /jobs -> 500". A fetch-level rejection (server down, offline) becomes an
 * ApiError with `status === 0` and `code === 'NETWORK_ERROR'`.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(authHeaders());
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const url = apiUrl(path);

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (cause) {
    const error = networkApiError(path, cause);
    logError('apiFetch', error);
    throw error;
  }

  if (!res.ok) {
    const error = await apiErrorFromResponse(res, path);
    logError('apiFetch', error);
    if (res.status === 401) notifyUnauthorized();
    throw error;
  }

  try {
    return (await res.json()) as T;
  } catch (cause) {
    const error = new ApiError({
      status: res.status,
      path,
      message: 'The server returned a malformed response.',
      code: 'INVALID_JSON',
      cause,
    });
    logError('apiFetch', error);
    throw error;
  }
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const url = apiBase() + '/auth/login';
  const path = '/auth/login';

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (cause) {
    const error = networkApiError(path, cause);
    logError('login', error);
    throw error;
  }

  if (!res.ok) {
    const parsed = await apiErrorFromResponse(res, path);
    // A rejected credential is the expected case and must not leak the server's
    // wording; anything else (server down, misconfigured gateway) is a real
    // fault the operator has to see verbatim.
    const error =
      res.status === 401
        ? new ApiError({
            status: parsed.status,
            path,
            message: 'Invalid email or password',
            code: parsed.code,
            traceId: parsed.traceId,
          })
        : parsed;
    logError('login', error);
    throw error;
  }

  const data = await res.json() as { token: string; user: SessionUser };
  storageSet('token', data.token);
  return data.user;
}

export async function getCurrentUser(): Promise<SessionUser> {
  return apiFetch<SessionUser>('/me');
}

export function logout(): void {
  storageRemove('token');
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const authToken = token();
  const apiKey = getApiKey();
  const a = document.createElement('a');
  a.href = apiUrl(path);
  a.download = filename;
  a.setAttribute('data-auth', authToken);
  // Trigger via fetch + blob to attach auth header
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  if (apiKey) headers['X-Api-Key'] = apiKey;
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { headers: Object.keys(headers).length ? headers : undefined });
  } catch (cause) {
    const error = networkApiError(path, cause);
    logError('apiDownload', error);
    throw error;
  }
  if (!res.ok) {
    const error = await apiErrorFromResponse(res, path);
    logError('apiDownload', error);
    throw error;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Safely read a File as a base64 data URI string. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return a string'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}
