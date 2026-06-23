import { API_HOST_OVERRIDE_KEY } from './client';

/**
 * Builds a full API base URL from a bare host/IP the operator typed in the
 * setup wizard (e.g. "192.168.1.50" or "api.example.com:4000"). Mirrors the
 * same direct-port convention used everywhere else in the app: default to
 * port 4000 unless the operator already included one.
 */
export function buildApiBaseFromHost(host: string): string {
  const trimmed = host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const hasPort = /:\d+$/.test(trimmed);
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
  return `${protocol}//${trimmed}${hasPort ? '' : ':4000'}/api/v1`;
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
