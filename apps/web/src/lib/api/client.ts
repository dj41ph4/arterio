import { useAuthStore } from '@/stores/auth-store';

/**
 * Resolve the API base URL.
 *
 * `NEXT_PUBLIC_API_URL` (baked at build time) always wins when set — use it to
 * pin a fixed public domain. Otherwise we derive the URL **in the browser** from
 * the host that served the page, so a self-hosted install works on any IP /
 * hostname without rebuilding the image:
 *   - Behind nginx (port 80/443):      same origin, API under `/api/v1`.
 *   - Direct ports (web :3000):        same host, API on `:4000/api/v1`.
 *   - Local dev (localhost:3000):      localhost:4000/api/v1.
 */
function resolveApiBaseUrl(): string {
  const baked = process.env.NEXT_PUBLIC_API_URL;
  if (baked) return baked;

  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    // Served through nginx on the standard ports → API is same-origin under /api.
    if (port === '' || port === '80' || port === '443') {
      return `${protocol}//${hostname}${port ? `:${port}` : ''}/api/v1`;
    }
    // Direct-port deployment (web on :3000) → API on :4000 of the same host.
    return `${protocol}//${hostname}:4000/api/v1`;
  }

  return 'http://localhost:4000/api/v1';
}

export const API_BASE_URL = resolveApiBaseUrl();

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Thin fetch wrapper — attaches the bearer token and refreshes once on 401. */
export async function apiFetch<T>(path: string, init?: RequestInit, _retried = false): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401 && !_retried) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch<T>(path, init, true);
    // Session expired and refresh failed — bounce to login instead of hanging forever.
    if (typeof window !== 'undefined') {
      const locale = window.location.pathname.split('/')[1] || 'en';
      window.location.href = `/${locale}/login`;
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  const { refreshToken, setTokens, clear } = useAuthStore.getState();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clear();
      return false;
    }
    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clear();
    return false;
  }
}
