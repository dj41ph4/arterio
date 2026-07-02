/**
 * Real, keyless image search via Wikimedia Commons — used wherever the app
 * needs an actual photo URL (artwork autofill, artist portraits) instead of
 * trusting an LLM to recall one from memory. A chat model with no web-search
 * tool can only ever hallucinate a plausible-looking URL; Commons actually
 * hosts the file and can resolve a real, stable, public URL for it.
 */

import { wikimediaFetch } from './free-web-search.util';

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

/**
 * Returns up to `limit` real image URLs for a query, best-matching titles
 * first — used by the "more images" search so the user gets a gallery of
 * candidates to pick from instead of a single auto-picked photo.
 */
export async function searchCommonsImages(query: string, limit = 6): Promise<string[]> {
  try {
    const searchRes = await wikimediaFetch(
      `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=20&format=json&origin=*&srsearch=${encodeURIComponent(query)}`,
      8_000,
    );
    if (!searchRes || !searchRes.ok) return [];
    const searchData = (await searchRes.json()) as { query?: { search?: Array<{ title: string }> } };
    const candidates = (searchData.query?.search ?? []).filter((r) => IMAGE_EXT.test(r.title));
    if (!candidates.length) return [];

    // Best textual matches first, then whatever's left, capped at `limit`.
    const ranked = [
      ...candidates.filter((c) => matchesAnyToken(query, c.title)),
      ...candidates.filter((c) => !matchesAnyToken(query, c.title)),
    ].slice(0, limit);

    const titles = ranked.map((c) => c.title).join('|');
    const infoRes = await wikimediaFetch(
      `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&format=json&origin=*`,
      8_000,
    );
    if (!infoRes || !infoRes.ok) return [];
    const infoData = (await infoRes.json()) as {
      query?: { pages?: Record<string, { imageinfo?: Array<{ url?: string }> }> };
    };
    const pages = Object.values(infoData.query?.pages ?? {});
    return pages.map((p) => p.imageinfo?.[0]?.url).filter((u): u is string => Boolean(u));
  } catch {
    return [];
  }
}

/** Single-best-result convenience wrapper for callers that only ever attach one photo. */
export async function searchCommonsImage(query: string): Promise<string | null> {
  const [first] = await searchCommonsImages(query, 1);
  return first ?? null;
}
