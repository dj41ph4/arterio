/**
 * Centre Pompidou (Musée national d'art moderne) — keyless access via the
 * Navigart API that powers collection.centrepompidou.fr (~92 000 works of
 * modern & contemporary art, curated metadata, photographed works).
 *
 * No official public API exists; this is the same JSON endpoint the
 * collection site itself calls (instance 14 = MNAM). Everything here is
 * best-effort: any failure returns empty results, never throws.
 */

const BASE = 'https://api.navigart.fr/14/artworks';
const UA = 'Arterio/1.0 (https://github.com/dj41ph4/arterio; art collection manager) node-fetch';

interface NavigartMedia {
  file_name?: string;
  url_template?: string;
  type?: string;
}

interface NavigartArtworkSource {
  artwork?: {
    _id?: string;
    title_notice?: string;
    title_list?: string;
    date_creation?: string;
    domain?: string;
    dimensions?: string;
    inventory?: string;
    acquisition?: string;
    authors_list?: string;
    recap_authors?: string;
    authors_nationality?: string;
    authors_birth_death?: string;
    live_and_work?: string;
    author_bibliography?: string;
    nb_images?: number;
  };
  medias?: NavigartMedia[];
}

export interface PompidouArtwork {
  id: string;
  title: string | null;
  authors: string | null;
  date: string | null;
  /** Domain doubles as a technique/category hint: "Peinture", "Sculpture", "Estampe", "Dessin"… */
  domain: string | null;
  dimensions: string | null;
  inventory: string | null;
  imageUrls: string[];
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function mediaUrls(medias: NavigartMedia[] | undefined, size = '800'): string[] {
  return (medias ?? [])
    .filter((m) => m.type === 'image' && m.file_name && m.url_template)
    .map((m) => m.url_template!.replace('{size}', size).replace('{file_name}', m.file_name!));
}

async function navigartSearch(q: string, size: number): Promise<NavigartArtworkSource[]> {
  const res = await fetch(`${BASE}?q=${encodeURIComponent(q)}&size=${size}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: Array<{ _source?: { ua?: NavigartArtworkSource } }> };
  return (data.results ?? []).map((r) => r._source?.ua).filter((u): u is NavigartArtworkSource => Boolean(u));
}

/**
 * Multi-token queries AND-match on Navigart and often return nothing —
 * retry with progressively fewer tokens (dropping short/leading words first)
 * so "Pablo Picasso Guitare" still finds the PICASSO records.
 */
async function searchWithRelaxation(query: string, size: number): Promise<NavigartArtworkSource[]> {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const attempts: string[] = [query.trim()];
  if (tokens.length > 1) {
    attempts.push(tokens.filter((t) => t.length > 3).join(' '));
    attempts.push(tokens[tokens.length - 1]!); // last name usually
  }
  for (const q of [...new Set(attempts)].filter(Boolean)) {
    try {
      const results = await navigartSearch(q, size);
      if (results.length) return results;
    } catch {
      // next attempt
    }
  }
  return [];
}

function toArtwork(src: NavigartArtworkSource): PompidouArtwork {
  const a = src.artwork ?? {};
  return {
    id: a._id ?? '',
    title: a.title_notice ?? a.title_list ?? null,
    authors: a.authors_list ?? a.recap_authors ?? null,
    date: a.date_creation ?? null,
    domain: a.domain ?? null,
    dimensions: a.dimensions ?? null,
    inventory: a.inventory ?? null,
    imageUrls: mediaUrls(src.medias),
  };
}

/** Artwork search — the metadata is museum-curated, ideal grounding for autofill. */
export async function searchPompidouArtworks(query: string, limit = 6): Promise<PompidouArtwork[]> {
  try {
    const results = await searchWithRelaxation(query, Math.min(limit * 3, 30));
    return results.map(toArtwork).filter((a) => a.title).slice(0, limit);
  } catch {
    return [];
  }
}

/** Single best image — for the autofill photo chain. */
export async function searchPompidouImage(query: string): Promise<string | null> {
  const urls = await searchPompidouImages(query, 1);
  return urls[0] ?? null;
}

/** Image URLs only — for the image-search chain (art-only index, photographed by the museum). */
export async function searchPompidouImages(query: string, limit = 6): Promise<string[]> {
  try {
    const results = await searchWithRelaxation(query, 30);
    const urls: string[] = [];
    for (const src of results) {
      for (const url of mediaUrls(src.medias)) {
        if (!urls.includes(url)) urls.push(url);
        if (urls.length >= limit) return urls;
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export interface PompidouArtistInfo {
  nationality: string | null;
  birthDeath: string | null;
  liveAndWork: string | null;
  bibliography: string | null;
  worksInCollection: number;
  sampleWorks: string[];
}

/**
 * Artist facts distilled from their records in the MNAM collection — the
 * enrichment fallback for modern/contemporary artists (especially French
 * ones) that Wikidata doesn't know.
 */
export async function searchPompidouArtist(fullName: string): Promise<PompidouArtistInfo | null> {
  try {
    const results = await searchWithRelaxation(fullName, 30);
    if (!results.length) return null;

    // Keep only records actually authored by this person — a token query can
    // match titles/descriptions of unrelated works.
    const nameTokens = normalize(fullName).split(/\s+/).filter((t) => t.length > 2);
    const byArtist = results.filter((src) => {
      const authors = normalize(src.artwork?.authors_list ?? src.artwork?.recap_authors ?? '');
      return nameTokens.length > 0 && nameTokens.every((t) => authors.includes(t));
    });
    if (!byArtist.length) return null;

    const first = byArtist[0]!.artwork!;
    return {
      nationality: first.authors_nationality ?? null,
      birthDeath: first.authors_birth_death ?? null,
      liveAndWork: first.live_and_work ?? null,
      bibliography: first.author_bibliography ?? null,
      worksInCollection: byArtist.length,
      sampleWorks: byArtist
        .map((s) => s.artwork?.title_notice ?? s.artwork?.title_list)
        .filter((t): t is string => Boolean(t))
        .slice(0, 5),
    };
  } catch {
    return null;
  }
}

/** Text block appended to AI autofill prompts — real museum facts beat model memory. */
export function buildPompidouContext(artworks: PompidouArtwork[]): string {
  if (!artworks.length) return '';
  const lines = artworks.map((a) => {
    const parts = [
      `"${a.title}"`,
      a.authors && `par ${a.authors}`,
      a.date && `(${a.date})`,
      a.domain,
      a.dimensions,
      a.inventory && `inv. ${a.inventory}`,
    ].filter(Boolean);
    return `- ${parts.join(', ')}`;
  });
  return `[CENTRE POMPIDOU / MNAM — collection officielle]\n${lines.join('\n')}`;
}
