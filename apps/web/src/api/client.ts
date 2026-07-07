function token(): string {
  return localStorage.getItem('token') ?? '';
}

function authHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token()}`,
  };
}

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export function apiDownload(path: string, filename: string): void {
  const a = document.createElement('a');
  a.href = `/api${path}`;
  a.download = filename;
  a.setAttribute('data-auth', token());
  // Trigger via fetch + blob to attach auth header
  fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token()}` } })
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    })
    .catch(console.error);
}
