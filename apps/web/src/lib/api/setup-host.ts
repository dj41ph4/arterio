import { API_HOST_OVERRIDE_KEY } from './client';

/**
 * Builds a full API base URL from whatever the operator typed — a bare host
 * ("192.168.1.50"), a bare domain, or a full URL with its own port — used by
 * both the first-run setup wizard's "different server?" question and the
 * login screen's "Modifier l'URL de l'API" link, so the two behave
 * identically. Deliberately does NOT force a protocol or a :4000 port onto
 * something already fully typed out: a split-domain reverse-proxy setup is
 * commonly on 443, not :4000, and forcing :4000 there silently breaks it.
 */
export function normalizeApiUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) {
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
    url = `${protocol}//${url}`;
  }
  return /\/api\/v1$/.test(url) ? url : `${url}/api/v1`;
}

/** Persists a manual API host override so every subsequent page load uses it — see client.ts. */
export function saveApiHostOverride(apiBaseUrl: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(API_HOST_OVERRIDE_KEY, apiBaseUrl);
}

export function clearApiHostOverride(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(API_HOST_OVERRIDE_KEY);
}

export function getApiHostOverride(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(API_HOST_OVERRIDE_KEY);
}
