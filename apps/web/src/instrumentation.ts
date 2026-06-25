/**
 * Server bootstrap hook (Next.js calls `register()` once at startup).
 *
 * Node 25 ships an *experimental* global `localStorage` that is enabled by the
 * `--localstorage-file` flag. When that flag is present without a valid path
 * (as in some dev/preview launchers), the global exists but its methods are not
 * functions — so any library that touches `localStorage` during SSR throws
 * `localStorage.getItem is not a function`.
 *
 * We replace/repair that global with a safe in-memory Storage on the server so
 * SSR never crashes. In the browser the real Web Storage is used and this code
 * never runs.
 */
export async function register() {
  const g = globalThis as unknown as { localStorage?: unknown };
  const current = g.localStorage as { getItem?: unknown } | undefined;

  if (current && typeof current.getItem === 'function') return; // already valid

  const store = new Map<string, string>();
  const shim: Storage = {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };

  try {
    Object.defineProperty(globalThis, 'localStorage', {
      value: shim,
      configurable: true,
      writable: true,
    });
  } catch {
    try {
      (globalThis as unknown as { localStorage: Storage }).localStorage = shim;
    } catch {
      // Last resort: augment the existing broken object in place.
      Object.assign(current ?? {}, shim);
    }
  }
}
