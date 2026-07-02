/**
 * Generic in-memory TTL cache — the "any computed output is a cacheable
 * entity fragment" policy applied as one reusable primitive instead of each
 * module rolling its own ad-hoc Map. Process-local (no Redis): correct for a
 * single-container self-hosted appliance, and avoids adding an external
 * dependency just for memoization of cheap-to-recompute lookups.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Cache the resolved value of a promise-returning lookup, keyed by `key`. Never caches a rejection. */
  async wrap(key: string, fn: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await fn();
    this.set(key, value);
    return value;
  }
}
