/**
 * Pure performance cache — NOT a business-logic change. Every AI call path
 * (the chain's per-provider isEnabled() check, then the provider's own
 * resolveOrgSettings() inside its actual completion call) independently
 * fetches the same Organization row from the database within the same request,
 * 2-3 times. This coalesces those into one DB round-trip for a few seconds,
 * cutting redundant reads without changing what any caller sees — a settings
 * change still takes effect within TTL_MS, and nothing about which provider
 * is called, what it returns, or the merge/fallback logic is touched.
 */
const TTL_MS = 5_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function getCachedOrg<T>(organizationId: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(organizationId);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fetcher();
  cache.set(organizationId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}
