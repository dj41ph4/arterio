import * as cheerio from 'cheerio';

/**
 * Last-resort biography sources for contemporary/regional artists who have
 * no Wikidata entry and never show up in any museum collection API (the
 * existing fallback chain in artist-enrichment.service.ts) — small gallery
 * marketplace sites that list working artists with a bio page, but expose
 * no public read API (Artmajeur's API is seller-side gallery management
 * only; Artsper blocks plain HTTP requests with a 403). i-CAC and Artmajeur
 * were verified by hand to be reachable and to have a predictable URL slug
 * for a given name — but a guessed slug is inherently best-effort, so every
 * function here only ever returns null on a miss, never throws.
 *
 * Each result is sanity-checked against the searched name before being
 * trusted, since a guessed slug landing on an unrelated/wrong page is worse
 * than finding nothing.
 */

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ArterioBot/1.0; +self-hosted art collection catalogue)',
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** True only if every significant token of the searched name appears in the page text — guards against a guessed slug landing on a homonym or an unrelated page. */
function pageMentionsName(pageText: string, fullName: string): boolean {
  const lower = pageText.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return nameTokens(fullName).every((t) => lower.includes(t));
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface ScrapedBio {
  biography: string;
  sourceUrl: string;
}

/** i-CAC ("Cotation Artiste Peintre") — URL pattern verified by hand: /artiste/{lastname}-{firstname}.html, bio under an "<h2>Ma biographie…" heading. */
export async function scrapeICAC(fullName: string): Promise<ScrapedBio | null> {
  const tokens = nameTokens(fullName);
  if (tokens.length < 2) return null;
  const [first, ...rest] = tokens;
  const last = rest.join('-');
  const slugCandidates = [`${last}-${first}`, `${first}-${last}`];

  for (const slug of slugCandidates) {
    const url = `https://www.i-cac.fr/artiste/${slug}.html`;
    const html = await fetchHtml(url);
    if (!html) continue;
    try {
      const $ = cheerio.load(html);
      if (!pageMentionsName($('body').text(), fullName)) continue;

      const bioHeading = $('h2').filter((_, el) => /biographie/i.test($(el).text())).first();
      if (!bioHeading.length) continue;

      const parts: string[] = [];
      let node = bioHeading.next();
      while (node.length && node.is('p')) {
        const text = node.text().trim();
        if (text) parts.push(text);
        node = node.next();
      }
      const biography = parts.join('\n\n').trim();
      if (biography.length > 40) return { biography, sourceUrl: url };
    } catch {
      // malformed page — try the next slug candidate
    }
  }
  return null;
}

/** Artmajeur — URL pattern verified by hand: /{firstname-lastname}/{locale}, bio under a "biography" section. */
export async function scrapeArtmajeur(fullName: string): Promise<ScrapedBio | null> {
  const tokens = nameTokens(fullName);
  if (tokens.length < 2) return null;
  const slug = tokens.join('-');

  for (const url of [`https://www.artmajeur.com/${slug}/en`, `https://www.artmajeur.com/en/${slug}`]) {
    const html = await fetchHtml(url);
    if (!html) continue;
    try {
      const $ = cheerio.load(html);
      if (!pageMentionsName($('body').text(), fullName)) continue;

      // No stable class name to rely on — take the longest contiguous run of
      // <p> text on the page, which in practice is the biography block (lot
      // descriptions and navigation are short fragments by comparison).
      const paragraphs = $('p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter((t) => t.length > 30);
      if (!paragraphs.length) continue;

      const biography = paragraphs.sort((a, b) => b.length - a.length)[0]!;
      if (biography.length > 60) return { biography, sourceUrl: url };
    } catch {
      // malformed page — try the next URL candidate
    }
  }
  return null;
}
