import * as cheerio from 'cheerio';

/**
 * Last-resort biography scrapers for contemporary/regional artists who have
 * no Wikidata entry and are absent from museum collection APIs.
 *
 * Scraped sources:
 *  - Singulart: curated contemporary art platform (~100k artists), accessible
 *  - i-CAC: French painter cotation site, accessible but slug format varies
 *  - Artmajeur: large gallery marketplace; tries browser-like headers to work
 *    around their bot-detection (returns 403 to bare bot User-Agents)
 *
 * Each function returns null on any miss/error — never throws.
 * Results are sanity-checked against the searched name (pageMentionsName)
 * before being trusted.
 */

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
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

function pageMentionsName(pageText: string, fullName: string): boolean {
  const lower = pageText.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return nameTokens(fullName).every((t) => lower.includes(t));
}

export async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
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

/**
 * Singulart — curated contemporary art marketplace (~100k artists worldwide).
 * URL pattern: /en/artist/{firstname-lastname}
 * Bio is in a <p> or <div> inside the artist description section.
 */
export async function scrapeSingulart(fullName: string): Promise<ScrapedBio | null> {
  const tokens = nameTokens(fullName);
  if (tokens.length < 1) return null;
  const slug = tokens.join('-');

  // Try both name orders
  const [first, ...rest] = tokens;
  const reversed = rest.length ? `${rest.join('-')}-${first}` : slug;
  const candidates = Array.from(new Set([slug, reversed]));

  for (const s of candidates) {
    const url = `https://www.singulart.com/en/artist/${s}`;
    const html = await fetchHtml(url);
    if (!html) continue;
    try {
      const $ = cheerio.load(html);
      if (!pageMentionsName($('body').text(), fullName)) continue;

      // Bio is usually in a section with class containing "biography" or "description"
      const bioSelectors = [
        '[class*="biography"] p',
        '[class*="description"] p',
        '[class*="about"] p',
        'article p',
      ];
      for (const sel of bioSelectors) {
        const parts = $(sel)
          .map((_, el) => $(el).text().trim())
          .get()
          .filter((t) => t.length > 50);
        if (parts.length) {
          const biography = parts.join('\n\n').trim();
          if (biography.length > 80) return { biography, sourceUrl: url };
        }
      }
    } catch {
      // malformed page
    }
  }
  return null;
}

/**
 * i-CAC — French painter cotation/listing site.
 * URL pattern: /artiste/{lastname}-{firstname}.html (various orders tried).
 */
export async function scrapeICAC(fullName: string): Promise<ScrapedBio | null> {
  const tokens = nameTokens(fullName);
  if (tokens.length < 2) return null;

  const [first, ...rest] = tokens;
  const last = rest.join('-');
  // Try both orders and the full-slug variant
  const slugCandidates = Array.from(new Set([
    `${last}-${first}`,
    `${first}-${last}`,
    slugify(fullName),
  ]));

  for (const slug of slugCandidates) {
    const url = `https://www.i-cac.fr/artiste/${slug}.html`;
    const html = await fetchHtml(url);
    if (!html) continue;
    try {
      const $ = cheerio.load(html);
      if (!pageMentionsName($('body').text(), fullName)) continue;

      const bioHeading = $('h2, h3').filter((_, el) => /biographie/i.test($(el).text())).first();
      const parts: string[] = [];
      if (bioHeading.length) {
        let node = bioHeading.next();
        while (node.length && node.is('p')) {
          const text = node.text().trim();
          if (text) parts.push(text);
          node = node.next();
        }
      }
      if (!parts.length) {
        // Fallback: take any substantial paragraph on the page
        $('p').each((_, el) => {
          const t = $(el).text().trim();
          if (t.length > 80) parts.push(t);
        });
      }
      const biography = parts.join('\n\n').trim();
      if (biography.length > 40) return { biography, sourceUrl: url };
    } catch {
      // malformed page
    }
  }
  return null;
}

/**
 * Artmajeur — large international gallery marketplace.
 * Uses browser-like headers to bypass basic bot-detection.
 * URL pattern: /{firstname-lastname}/en (or /en/{firstname-lastname})
 */
export async function scrapeArtmajeur(fullName: string): Promise<ScrapedBio | null> {
  const tokens = nameTokens(fullName);
  if (tokens.length < 2) return null;
  const slug = tokens.join('-');

  const [first, ...rest] = tokens;
  const reversed = `${rest.join('-')}-${first}`;
  const candidates = Array.from(new Set([slug, reversed]));

  const locales = ['en', 'fr'];
  for (const s of candidates) {
    for (const locale of locales) {
      const url = `https://www.artmajeur.com/${s}/${locale}`;
      const html = await fetchHtml(url);
      if (!html) continue;
      try {
        const $ = cheerio.load(html);
        if (!pageMentionsName($('body').text(), fullName)) continue;

        const bioSelectors = [
          '[class*="bio"] p',
          '[class*="description"] p',
          '[class*="about"] p',
          'article p',
        ];
        for (const sel of bioSelectors) {
          const parts = $(sel)
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length > 50);
          if (parts.length) {
            const biography = parts.join('\n\n').trim();
            if (biography.length > 60) return { biography, sourceUrl: url };
          }
        }
        // Last resort: longest paragraph
        const paragraphs = $('p')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter((t) => t.length > 60);
        if (paragraphs.length) {
          const biography = paragraphs.sort((a, b) => b.length - a.length)[0]!;
          if (biography.length > 80) return { biography, sourceUrl: url };
        }
      } catch {
        // malformed page — try next URL
      }
    }
  }
  return null;
}
