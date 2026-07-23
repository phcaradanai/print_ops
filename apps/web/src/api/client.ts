export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
}

const API_KEY_STORAGE_KEY = 'printops-api-key';

export function getApiKey(): string {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (stored !== null && stored.trim() !== '') {
      return stored.trim();
    }
  } catch {
    // localStorage unavailable
  }
  return (import.meta.env.VITE_API_KEY as string | undefined) ??
         (import.meta.env.VITE_DEV_API_KEY as string | undefined) ??
         'printops-dev-apikey-2026';
}

export function saveApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}

function token(): string {
  return localStorage.getItem('token') ?? '';
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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(authHeaders());
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const url = apiUrl(path);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    console.error('[apiFetch]', path, '->', res.status, '(', url, ')');
    throw new Error(`API ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const url = apiBase() + '/auth/login';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Invalid email or password');
  const data = await res.json() as { token: string; user: SessionUser };
  localStorage.setItem('token', data.token);
  return data.user;
}

export async function getCurrentUser(): Promise<SessionUser> {
  return apiFetch<SessionUser>('/me');
}

export function logout(): void {
  localStorage.removeItem('token');
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
  const res = await fetch(apiUrl(path), { headers: Object.keys(headers).length ? headers : undefined });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
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
