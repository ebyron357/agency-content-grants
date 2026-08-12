/** Direct API call helpers for operations not covered by generated hooks */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Redirect to login when the session has expired */
function handleUnauthorized(res: Response): void {
  if (res.status === 401) {
    window.location.href = `${BASE}/login`;
  }
}

export async function apiPost(path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    handleUnauthorized(res);
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

export async function apiPatch(path: string, body: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    handleUnauthorized(res);
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH ${path} failed: ${res.status} ${text}`);
  }
  return res.json().catch(() => null);
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { credentials: 'include' });
  if (!res.ok) {
    handleUnauthorized(res);
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return null as T;
  return res.json().catch(() => null) as T;
}

export async function apiDelete(path: string) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    handleUnauthorized(res);
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE ${path} failed: ${res.status} ${text}`);
  }
  return null;
}
