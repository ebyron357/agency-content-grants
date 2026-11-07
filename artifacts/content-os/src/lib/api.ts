/** Direct API call helpers for operations not covered by generated hooks */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export function resolveApiAssetUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized.startsWith('/api/')
    ? `${BASE}${normalized}`
    : `${BASE}/api${normalized}`;
}

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

const STATUS_MESSAGES: Record<number, string> = {
  401: 'Your session has ended. Sign in again.',
  403: 'Your role cannot do this. Ask an owner or admin of your workspace.',
  404: 'We could not find that. It may have been moved or removed.',
  409: 'Someone changed this at the same time. Reload the page and try again.',
  413: 'That file is too large.',
  429: 'Too many requests. Wait a minute, then try again.',
};

/** The wording for a status code when the server sent no readable message. */
function statusMessage(status: number): string {
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status >= 500) return 'Something went wrong on our side. Try again in a minute.';
  return 'That did not work. Check what you entered and try again.';
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field : null;
}

/**
 * Turn any error from an API call into one plain-language sentence for the
 * screen: the server's own message when it sent one, otherwise wording for the
 * kind of failure. Never shows a method, path, status code or HTML page.
 */
export function friendlyError(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error == null) return fallback;
  const data = (error as { data?: unknown }).data;
  const fromData = stringField(data, 'error') ?? stringField(data, 'message');
  if (fromData) return fromData;
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!text) return fallback;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
    return 'Could not reach GrantCrest. Check your internet connection and try again.';
  }
  const prefixed = /^(GET|POST|PATCH|PUT|DELETE) \S+ failed: (\d{3}) ?([\s\S]*)$/.exec(text);
  const rawStatus = (error as { status?: unknown }).status;
  const status = prefixed ? Number(prefixed[2]) : typeof rawStatus === 'number' ? rawStatus : null;
  const body = prefixed ? prefixed[3] : text;
  const brace = body.indexOf('{');
  if (brace >= 0) {
    try {
      const parsed: unknown = JSON.parse(body.slice(brace));
      const message = stringField(parsed, 'error') ?? stringField(parsed, 'message');
      if (message) return message;
    } catch {
      // not JSON
    }
  }
  const technical = !body.trim() || /^\s*</.test(body) || /^HTTP \d{3}/.test(body) || /Failed to parse response/.test(body);
  if (status !== null && (prefixed || technical)) return statusMessage(status);
  if (technical) return fallback;
  return body.trim();
}
