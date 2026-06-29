/**
 * Artsy API (developers.artsy.net/v2) — a curated art-world index, used as a
 * search source between WikiArt/Commons and the AI-grounded fallback.
 * Requires a free client_id/client_secret pair (Artsy → Getting Started),
 * stored as a single field formatted "clientId:clientSecret". Never throws —
 * any failure (bad key, Artsy downtime, network) falls through silently to
 * the next source in the chain, only ever returning null/[].
 */

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

function normalizeForMatch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function matchesAnyToken(query: string, candidate: string): boolean {
  const candidateNorm = normalizeForMatch(candidate);
  const tokens = normalizeForMatch(query).split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return false;
  return tokens.some((t) => candidateNorm.includes(t));
}

async function login(apiKey: string): Promise<string | null> {
  const [clientId, clientSecret] = apiKey.split(':');
  if (!clientId || !clientSecret) return null;

  if (cachedToken && cachedToken.key === apiKey && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  try {
    const res = await fetch('https://api.artsy.net/api/tokens/xapp_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string; expires_at?: string };
    if (!data.token) return null;
    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : Date.now() + 60 * 60 * 1000;
    cachedToken = { key: apiKey, token: data.token, expiresAt: expiresAt - 60_000 };
    return data.token;
  } catch {
    return null;
  }
}

/** Searches Artsy's artwork index by free-text query, best matches first. Returns up to `limit` real image URLs, or [] on any failure. */
export async function searchArtsyImages(apiKey: string, query: string, limit = 6): Promise<string[]> {
  const token = await login(apiKey);
  if (!token) return [];

  try {
    const q = `${query} more:pagemap:metatags-og_type:artwork`;
    const res = await fetch(`https://api.artsy.net/api/search?q=${encodeURIComponent(q)}&size=${Math.min(limit * 2, 20)}`, {
      headers: { 'X-Xapp-Token': token },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      _embedded?: {
        results?: Array<{ type?: string; og_type?: string; title?: string; _links?: { thumbnail?: { href?: string } } }>;
      };
    };
    const results = (data._embedded?.results ?? []).filter(
      (r) => (r.type === 'artwork' || r.og_type === 'artwork' || !r.type) && r._links?.thumbnail?.href,
    );
    const ranked = [
      ...results.filter((r) => matchesAnyToken(query, r.title ?? '')),
      ...results.filter((r) => !matchesAnyToken(query, r.title ?? '')),
    ];
    return ranked
      .map((r) => r._links?.thumbnail?.href)
      .filter((u): u is string => Boolean(u))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Single-best-result convenience wrapper for callers that only ever attach one photo. */
export async function searchArtsyImage(apiKey: string, query: string): Promise<string | null> {
  const [first] = await searchArtsyImages(apiKey, query, 1);
  return first ?? null;
}
