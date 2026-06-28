/**
 * WikiArt's official API (v2) requires a registered accessCode/secretCode
 * pair (https://www.wikiart.org/en/App/GetApi) — unlike the keyless
 * SearchArtists-style endpoints assumed earlier, real painting search needs
 * an authenticated session. Stored in Settings → AI as a single field
 * formatted "accessCode:secretCode". If this fails for any reason (bad key,
 * WikiArt downtime, network), the caller falls through to Wikimedia
 * Commons — this never throws, only returns null on failure.
 */

let cachedSession: { key: string; sessionKey: string; expiresAt: number } | null = null;

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
  const [accessCode, secretCode] = apiKey.split(':');
  if (!accessCode || !secretCode) return null;

  if (cachedSession && cachedSession.key === apiKey && cachedSession.expiresAt > Date.now()) {
    return cachedSession.sessionKey;
  }

  try {
    const res = await fetch(
      `https://www.wikiart.org/en/Api/2/login?accessCode=${encodeURIComponent(accessCode)}&secretCode=${encodeURIComponent(secretCode)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { SessionKey?: string };
    if (!data.SessionKey) return null;
    // WikiArt sessions are valid for an hour; refresh a little early.
    cachedSession = { key: apiKey, sessionKey: data.SessionKey, expiresAt: Date.now() + 50 * 60 * 1000 };
    return data.SessionKey;
  } catch {
    return null;
  }
}

/** Searches WikiArt's painting index by free-text query (e.g. "Picasso The Old Guitarist"). Returns a real image URL, or null on any failure. */
export async function searchWikiArtImage(apiKey: string, query: string): Promise<string | null> {
  const sessionKey = await login(apiKey);
  if (!sessionKey) return null;

  try {
    const res = await fetch(
      `https://www.wikiart.org/en/Api/2/PaintingSearch?term=${encodeURIComponent(query)}&authSessionKey=${encodeURIComponent(sessionKey)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ title?: string; artistName?: string; image?: string }> } | Array<{ title?: string; artistName?: string; image?: string }>;
    const results = Array.isArray(data) ? data : data.data ?? [];
    const match = results.find((r) => matchesAnyToken(query, `${r.title ?? ''} ${r.artistName ?? ''}`)) ?? results[0];
    return match?.image || null;
  } catch {
    return null;
  }
}
