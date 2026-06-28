/**
 * Real, keyless image search via Wikimedia Commons — used wherever the app
 * needs an actual photo URL (artwork autofill, artist portraits) instead of
 * trusting an LLM to recall one from memory. A chat model with no web-search
 * tool can only ever hallucinate a plausible-looking URL; Commons actually
 * hosts the file and can resolve a real, stable, public URL for it.
 */

function normalizeForMatch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function matchesAnyToken(query: string, candidate: string): boolean {
  const candidateNorm = normalizeForMatch(candidate);
  const tokens = normalizeForMatch(query).split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return false;
  return tokens.some((t) => candidateNorm.includes(t));
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

export async function searchCommonsImage(query: string): Promise<string | null> {
  try {
    const searchRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=8&format=json&origin=*&srsearch=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as { query?: { search?: Array<{ title: string }> } };
    const candidates = (searchData.query?.search ?? []).filter((r) => IMAGE_EXT.test(r.title));
    const best = candidates.find((c) => matchesAnyToken(query, c.title)) ?? candidates[0];
    if (!best) return null;

    const infoRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(best.title)}&prop=imageinfo&iiprop=url&format=json&origin=*`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!infoRes.ok) return null;
    const infoData = (await infoRes.json()) as {
      query?: { pages?: Record<string, { imageinfo?: Array<{ url?: string }> }> };
    };
    const pages = Object.values(infoData.query?.pages ?? {});
    return pages[0]?.imageinfo?.[0]?.url ?? null;
  } catch {
    return null;
  }
}
