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
         (import.meta.env.DEV
           ? (import.meta.env.VITE_DEV_API_KEY as string | undefined) ?? 'printops-dev-apikey-2026'
           : '');
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
 * tests). Guard both directions in one place.
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

/** Session-expiry notification. Only 401 unwinds the session; 403 does not. */
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

function authHeaders(hasBody: boolean): HeadersInit {
  const authToken = token();
  const apiKey = getApiKey();
  const headers: Record<string, string> = {};
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (apiKey) headers['X-Api-Key'] = apiKey;
  return headers;
}

// API base — empty string means same-origin relative (dev Vite proxy or prod .exe)
export function apiBase(): string {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE as string;
  return '';
}

export interface NatsRuntimeStatus {
  enabled: boolean; state: string; connected: boolean; intakeReady: boolean; callbackPublishReady: boolean; streamReady: boolean; consumerReady: boolean; clientId?: string; subject?: string; stream?: string; durable?: string; server?: string; lastConnectedAt?: string; lastDisconnectedAt?: string; lastAttemptAt?: string; nextRetryAt?: string; lastErrorCode?: string; lastErrorStage?: string; lastErrorMessage?: string;
}

export function getNatsRuntimeStatus(): Promise<NatsRuntimeStatus> { return apiFetch<NatsRuntimeStatus>('/v1/print-flow/nats-status'); }
export function testNatsConnection(): Promise<{ ok: boolean; stage: string; code?: string; message: string; durationMs: number }> { return apiFetch('/v1/print-flow/nats-test', { method: 'POST' }); }

export interface RuntimeArchitecture {
  runtimeMode: 'packaged-windows-desktop' | 'server';
  executor: {
    owner: 'api-local-worker' | 'external-runner';
    mode: 'typescript-windows-spooler' | 'external-runner';
    enabled: boolean;
  };
  discovery: {
    owner: 'go-runner';
    mode: 'windows-installed-printers' | 'platform-configured';
    jobsEnabled: boolean;
  };
  invariant: { ok: true; code: 'SINGLE_EXECUTOR' };
  supportedProductionProtocols: string[];
  deferredProtocols: string[];
}

export function getRuntimeArchitecture(): Promise<RuntimeArchitecture> {
  return apiFetch<RuntimeArchitecture>('/v1/print-flow/runtime-architecture');
}

export type ReadinessState = 'READY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
export interface ReadinessComponent {
  state: ReadinessState;
  message: string;
  action?: string;
  details?: Record<string, unknown>;
}
export interface ReadinessSnapshot {
  status: 'READY' | 'DEGRADED';
  checkedAt: string;
  components: Record<string, ReadinessComponent>;
}

export function getReadiness(): Promise<ReadinessSnapshot> {
  return apiFetch<ReadinessSnapshot>('/v1/system/readiness');
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

async function authenticatedResponse(path: string, init: RequestInit, scope: string): Promise<Response> {
  const headers = new Headers(authHeaders(init.body != null));
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const url = apiUrl(path);

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (cause) {
    const error = networkApiError(path, cause);
    logError(scope, error);
    throw error;
  }

  if (!res.ok) {
    const error = await apiErrorFromResponse(res, path);
    logError(scope, error);
    if (res.status === 401) notifyUnauthorized();
    throw error;
  }

  return res;
}

/** A DELETE command has no response-body contract, even when called via apiFetch. */
type DeleteRequestInit = RequestInit & { method: 'DELETE' | 'delete' | 'Delete' };

function isDeleteRequest(init: RequestInit): boolean {
  return init.method?.toUpperCase() === 'DELETE';
}

/**
 * Performs an authenticated API call.
 *
 * JSON remains mandatory for normal data requests. DELETE is deliberately
 * treated as an explicit command response: APIs commonly return 204 or an empty
 * 200 after a successful deletion, and attempting `res.json()` made the UI show
 * `INVALID_JSON` after the record had already been deleted. The overload keeps
 * DELETE call sites typed as Promise<void> while preserving strict JSON handling
 * for GET/POST/PUT requests.
 */
export function apiFetch(path: string, init: DeleteRequestInit): Promise<void>;
export function apiFetch<T>(path: string, init?: RequestInit): Promise<T>;
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T | void> {
  const res = await authenticatedResponse(path, init, 'apiFetch');

  if (isDeleteRequest(init)) {
    // Drain any compatibility body without making it part of the frontend
    // contract. This accepts both 204 and empty/non-empty 200 responses.
    await res.text();
    return;
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

/**
 * Explicit success-without-data variant for non-DELETE commands whose response
 * body is not part of the frontend contract. It accepts 204 and empty 200
 * responses, and also drains a body when a server returns one for backward
 * compatibility.
 */
export async function apiFetchVoid(path: string, init: RequestInit = {}): Promise<void> {
  const res = await authenticatedResponse(path, init, 'apiFetchVoid');
  await res.text();
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

export type BootstrapState = 'READY' | 'REQUIRED_NEW' | 'MIGRATION_REQUIRED';

export async function getBootstrapState(): Promise<BootstrapState> {
  const res = await fetch(apiBase() + '/auth/bootstrap');
  if (!res.ok) throw await apiErrorFromResponse(res, '/auth/bootstrap');
  return ((await res.json()) as { state: BootstrapState }).state;
}

export async function bootstrapOwner(input: {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}): Promise<SessionUser> {
  const path = '/auth/bootstrap';
  const res = await fetch(apiBase() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiErrorFromResponse(res, path);
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
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
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
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
