export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
}

function token(): string {
  return localStorage.getItem('token') ?? '';
}

function authHeaders(): HeadersInit {
  const authToken = token();
  return authToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }
    : { 'Content-Type': 'application/json' };
}

// API base: dev=Vite-proxy, prod/Tauri=http://127.0.0.1:3001
export function apiBase(): string {
  if (import.meta.env.DEV) return '';
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE as string;
  return 'http://127.0.0.1:3001';
}
export function healthUrl(): string {
  var base = apiBase();
  return base ? base + '/health' : '/api/health';
}


function apiUrl(path: string): string {
  var base = apiBase();
  var rel = path.startsWith('/v1/') ? '/api/api' + path : '/api' + path;
  return base ? base + rel.replace(/^\/api/, '') : rel;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(authHeaders());
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  var base = apiBase();
  var url = base ? base + '/auth/login' : '/api/auth/login';
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
  const a = document.createElement('a');
  a.href = apiUrl(path);
  a.download = filename;
  a.setAttribute('data-auth', authToken);
  // Trigger via fetch + blob to attach auth header
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
  const res = await fetch(apiUrl(path), { headers });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
