import { useAuthStore } from '@/stores/auth-store';

/** localStorage key for a manually-configured API host — see lib/api/setup-host.ts. */
export const API_HOST_OVERRIDE_KEY = 'arterio_api_host';

/**
 * Resolve the API base URL.
 *
 * Priority order:
 *   1. `NEXT_PUBLIC_API_URL` (baked at build time) — pins a fixed public domain.
 *   2. A manual override saved to localStorage during first-run setup — for
 *      the split-deployment case where the API genuinely runs on a different
 *      host than the web app (see the "same server?" question in SetupForm).
 *   3. Same-origin under `/api/v1`, on whatever host/port served the page —
 *      `next.config.mjs`'s `rewrites()` forwards that path server-side to the
 *      actual API (localhost in the combined image, `API_INTERNAL_URL`
 *      elsewhere), so the browser never needs to know or guess the API's
 *      real host/port. This is why no port-guessing logic lives here anymore.
 */
function resolveApiBaseUrl(): string {
  const baked = process.env.NEXT_PUBLIC_API_URL;
  if (baked) return baked;

  if (typeof window !== 'undefined') {
    const override = window.localStorage?.getItem(API_HOST_OVERRIDE_KEY);
    if (override) return override;

    const { protocol, hostname, port } = window.location;
    return `${protocol}//${hostname}${port ? `:${port}` : ''}/api/v1`;
  }

  return 'http://localhost:4000/api/v1';
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Origin (no /api/v1 suffix) — uploaded media is served from here, not under /api. */
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

/**
 * Resolves a relative media path (e.g. `/uploads/xyz.jpg`, returned by the API
 * to avoid baking in a meaningless server-side host) against the origin the
 * browser actually used. Absolute URLs (external Wikipedia/Wikidata portraits)
 * are left untouched.
 */
export function toMediaUrl<T extends string | null | undefined>(path: T): T | string {
  if (!path) return path;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_ORIGIN}${path}`;
}

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

// Refresh tokens are one-time-use (rotating) with reuse-detection on the server:
// presenting an already-rotated token kills the whole token family and forces a
// real logout. A page that fires several requests at once (e.g. multiple
// react-query queries) can get several 401s back-to-back when the access token
// expires — each one independently calling tryRefresh() would send the SAME
// (soon-to-be-stale) refresh token to the server in parallel, and the server
// honestly can't tell that apart from a stolen-token replay. Sharing one
// in-flight refresh promise across all concurrent 401s means only the first
// caller actually hits /auth/refresh; everyone else just awaits its result.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function doRefresh(): Promise<boolean> {
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
