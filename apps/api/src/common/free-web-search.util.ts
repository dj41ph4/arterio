import * as cheerio from 'cheerio';
import { BROWSER_HEADERS, fetchHtml } from './gallery-site-scraper.util';
import { TtlCache } from './ttl-cache.util';

/**
 * Free, key-less web search + page-text extraction — gives ANY AI provider
 * real search grounding without depending on OpenRouter's paid "web" plugin
 * (which bills per search even on :free models, the recurring 402 source)
 * or a provider's own native search tool. Scrapes DuckDuckGo's HTML-only
 * results page (no API key, no JS rendering required), then fetches and
 * strips the top few result pages to plain text.
 *
 * Unofficial endpoint: DuckDuckGo can change markup or rate-limit without
 * notice. Every function here returns null/empty on any failure — this is
 * pure best-effort context enrichment, never a hard dependency. A caller
 * that gets nothing back should proceed exactly as if this util didn't
 * exist (no search context, same behavior as before this was added).
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

// Short TTL — long enough to absorb a double-click/dedupe race or a quick
// retry, short enough that results stay reasonably fresh.
const searchCache = new TtlCache<WebSearchResult[]>(5 * 60_000);
const pageTextCache = new TtlCache<string | null>(10 * 60_000);

export async function searchWeb(query: string, limit = 5): Promise<WebSearchResult[]> {
  return searchCache.wrap(`${query.trim().toLowerCase()}::${limit}`, () => searchWebUncached(query, limit));
}

async function searchWebUncached(query: string, limit: number): Promise<WebSearchResult[]> {
  try {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: WebSearchResult[] = [];
    $('.result').each((_, el) => {
      if (results.length >= limit) return;
      const linkEl = $(el).find('.result__a').first();
      const href = linkEl.attr('href');
      const title = linkEl.text().trim();
      const snippet = $(el).find('.result__snippet').first().text().trim();
      if (href && title) results.push({ title, url: cleanDuckDuckGoUrl(href), snippet });
    });
    return results;
  } catch {
    return [];
  }
}

/** DuckDuckGo's HTML results wrap real URLs in a redirect (`//duckduckgo.com/l/?uddg=<encoded>&...`) — unwrap it so callers get the actual target. */
function cleanDuckDuckGoUrl(href: string): string {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const real = url.searchParams.get('uddg');
    return real ? decodeURIComponent(real) : href;
  } catch {
    return href;
  }
}

/** Fetches a page and reduces it to plain, whitespace-collapsed text — script/style/nav/footer stripped, capped at maxChars. */
export async function fetchPageText(url: string, maxChars = 4000): Promise<string | null> {
  return pageTextCache.wrap(`${url}::${maxChars}`, () => fetchPageTextUncached(url, maxChars));
}

async function fetchPageTextUncached(url: string, maxChars: number): Promise<string | null> {
  const html = await fetchHtml(url);
  if (!html) return null;
  try {
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, noscript').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

/**
 * Orchestrates search + page-fetch into one bounded context block, ready to
 * append to an AI prompt's user message. Returns null if the search itself
 * yields nothing usable — callers should treat that exactly like "no search
 * context available" rather than retrying or failing.
 */
export async function buildSearchContext(
  query: string,
  opts?: { resultLimit?: number; pagesToFetch?: number; maxTotalChars?: number },
): Promise<string | null> {
  try {
    const resultLimit = opts?.resultLimit ?? 5;
    const pagesToFetch = opts?.pagesToFetch ?? 3;
    const maxTotalChars = opts?.maxTotalChars ?? 6000;

    const results = await searchWeb(query, resultLimit);
    if (!results.length) return null;

    const resultsBlock = results
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})${r.snippet ? `: ${r.snippet}` : ''}`)
      .join('\n');

    const pages = await Promise.all(
      results.slice(0, pagesToFetch).map(async (r, i) => {
        const text = await fetchPageText(r.url, Math.floor(maxTotalChars / pagesToFetch));
        return text ? `[${i + 1}] ${r.url}:\n${text}` : null;
      }),
    );
    const pagesBlock = pages.filter((p): p is string => Boolean(p)).join('\n\n');

    let context = `Search results for "${query}":\n${resultsBlock}`;
    if (pagesBlock) context += `\n\nPage excerpts:\n${pagesBlock}`;
    return context.slice(0, maxTotalChars + 1000);
  } catch {
    return null;
  }
}

/**
 * Queries Wikipedia's search API in the given locales (FR first, then EN) for a
 * person/artwork name and returns the plaintext extract of the best matching page.
 * Never throws — returns null on any failure so callers can use it as optional context.
 */
async function fetchWikipediaExtract(name: string, locales = ['fr', 'en'], maxChars = 2500): Promise<string | null> {
  for (const lang of locales) {
    try {
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json&origin=*`;
      const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });
      if (!searchRes.ok) continue;
      const searchJson = await searchRes.json() as { query?: { search?: Array<{ title: string }> } };
      const pageTitle = searchJson.query?.search?.[0]?.title;
      if (!pageTitle) continue;

      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
      const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(6000) });
      if (!summaryRes.ok) continue;
      const summary = await summaryRes.json() as { extract?: string; title?: string };
      if (summary.extract && summary.extract.length > 80) {
        return `Wikipedia (${lang}) — ${summary.title}:\n${summary.extract.slice(0, maxChars)}`;
      }
    } catch {
      // try next locale
    }
  }
  return null;
}

/**
 * Art-specific multi-query search context builder. Runs several targeted DDG
 * queries in parallel — one aimed at auction/market sites (most reliable for
 * dimensions and technique, especially for lesser-known artists), one at museum
 * sites, and the original broad query. Deduplicates URLs, fetches the most
 * relevant pages, and returns a single merged context block.
 *
 * Why multiple queries: a single generic query works for famous artists
 * (Wikipedia/museum pages rank high) but fails for regional or private-collection
 * works where the only factual data lives on auction catalogues or niche
 * databases. Targeting those domains explicitly with site: operators surfaces
 * results a generic query never would.
 */
export async function buildArtworkSearchContext(artistName: string, title: string, maxTotalChars = 8000): Promise<string | null> {
  try {
    const quoted = (s: string) => `"${s.replace(/"/g, '')}"`;
    const a = artistName.trim();
    const t = title.trim();
    if (!a && !t) return null;

    // Three complementary queries run in parallel:
    // 1. Auction/market sites — most reliable source for dimensions, technique,
    //    and signature info, even for obscure artists (lot descriptions are
    //    verified by professionals before each sale).
    // 2. Museum sites — authoritative for works in public collections.
    // 3. Broad art-specific query — catches catalogues raisonnés, monographies,
    //    gallery pages, and artist websites.
    const queries = [
      `${a ? quoted(a) : ''} ${t ? quoted(t) : ''} site:interencheres.com OR site:drouot.com OR site:artprice.com OR site:invaluable.com OR site:liveauctioneers.com OR site:mutualart.com`.trim(),
      `${a ? quoted(a) : ''} ${t ? quoted(t) : ''} site:metmuseum.org OR site:artic.edu OR site:vam.ac.uk OR site:rkd.nl OR site:joconde.fr OR site:wikiart.org`.trim(),
      `${a ? quoted(a) : ''} ${t ? quoted(t) : ''} catalogue raisonné dimensions technique signature`.trim(),
    ];

    const allResultSets = await Promise.all(queries.map((q) => searchWeb(q, 4)));

    // Merge and deduplicate by URL, preserving order (auction results first).
    const seen = new Set<string>();
    const merged: WebSearchResult[] = [];
    for (const set of allResultSets) {
      for (const r of set) {
        if (!seen.has(r.url)) {
          seen.add(r.url);
          merged.push(r);
        }
      }
    }
    if (!merged.length) return null;

    const resultsBlock = merged
      .slice(0, 8)
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})${r.snippet ? `: ${r.snippet}` : ''}`)
      .join('\n');

    // Fetch page text for the top results. Auction pages tend to be dense with
    // exactly the data we need, so give them a larger per-page budget.
    const auctionDomains = ['interencheres.com', 'drouot.com', 'artprice.com', 'invaluable.com', 'liveauctioneers.com', 'mutualart.com'];
    const pages = await Promise.all(
      merged.slice(0, 5).map(async (r, i) => {
        const isAuction = auctionDomains.some((d) => r.url.includes(d));
        const charBudget = isAuction ? Math.floor(maxTotalChars / 3) : Math.floor(maxTotalChars / 5);
        const text = await fetchPageText(r.url, charBudget);
        return text ? `[${i + 1}] ${r.url}:\n${text}` : null;
      }),
    );
    const pagesBlock = pages.filter((p): p is string => Boolean(p)).join('\n\n');

    // Wikipedia lookup for the artist — gives the AI artist identity context
    // even when the specific artwork has no auction/museum record.
    const wikiExtract = a ? await fetchWikipediaExtract(a) : null;

    let context = `Web search results for "${[a, t].filter(Boolean).join(' ')}":\n${resultsBlock}`;
    if (pagesBlock) context += `\n\nPage excerpts:\n${pagesBlock}`;
    if (wikiExtract) context += `\n\n${wikiExtract}`;
    return context.slice(0, maxTotalChars + 1000);
  } catch {
    return null;
  }
}

/**
 * Artist-specific multi-query context builder. For well-known artists, the first
 * query (biography sites) will dominate. For regional or lesser-known artists,
 * the auction/market query is the main fallback — auction catalogue bios are
 * often the only existing machine-readable biography for an obscure painter.
 */
export async function buildArtistSearchContext(fullName: string, maxTotalChars = 6000): Promise<string | null> {
  try {
    const name = fullName.trim();
    if (!name) return null;
    const quoted = `"${name.replace(/"/g, '')}"`;

    const queries = [
      // 1. Encyclopaedia/biography sites
      `${quoted} (biographie OR biography OR "date de naissance" OR "né à" OR "born") (peintre OR sculpteur OR artiste OR painter)`,
      // 2. Auction/market sites — the only digital trace for many regional artists
      `${quoted} site:artprice.com OR site:interencheres.com OR site:mutualart.com OR site:liveauctioneers.com`,
      // 3. Authority databases
      `${quoted} site:rkd.nl OR site:data.bnf.fr OR site:viaf.org OR site:wikiart.org`,
    ];

    const allResultSets = await Promise.all(queries.map((q) => searchWeb(q, 3)));

    const seen = new Set<string>();
    const merged: WebSearchResult[] = [];
    for (const set of allResultSets) {
      for (const r of set) {
        if (!seen.has(r.url)) {
          seen.add(r.url);
          merged.push(r);
        }
      }
    }
    if (!merged.length) return null;

    const resultsBlock = merged
      .slice(0, 6)
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})${r.snippet ? `: ${r.snippet}` : ''}`)
      .join('\n');

    const pages = await Promise.all(
      merged.slice(0, 4).map(async (r, i) => {
        const text = await fetchPageText(r.url, Math.floor(maxTotalChars / 4));
        return text ? `[${i + 1}] ${r.url}:\n${text}` : null;
      }),
    );
    const pagesBlock = pages.filter((p): p is string => Boolean(p)).join('\n\n');

    // Direct Wikipedia lookup — more reliable than DDG→Wikipedia for lesser-known
    // artists whose pages don't rank high enough in general search results.
    const wikiExtract = await fetchWikipediaExtract(name);

    // Wikidata structured facts — the most reliable source for dates/nationality/
    // movement when the artist has a Wikidata entry. Injected FIRST in the block
    // so the AI sees it as the highest-priority source and doesn't override it
    // with DDG snippets that may be wrong or about a different person.
    const wikidataFacts = await fetchWikidataArtistFacts(name);

    let context = `Web search results for artist "${name}":\n${resultsBlock}`;
    if (pagesBlock) context += `\n\nPage excerpts:\n${pagesBlock}`;
    if (wikiExtract) context += `\n\n${wikiExtract}`;
    if (wikidataFacts) context = `${wikidataFacts}\n\n${context}`;
    return context.slice(0, maxTotalChars + 1000);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Wikidata structured facts — key-less, always free
// ---------------------------------------------------------------------------

const wikidataFactsCache = new TtlCache<string | null>(30 * 60_000);

const WIKIDATA_ART_TERMS: string[] = [
  'painter', 'sculptor', 'artist', 'printmaker', 'photographer', 'illustrator',
  'peintre', 'sculpteur', 'artiste', 'graveur', 'photographe', 'illustrateur',
  'pittore', 'scultore', 'schilder', 'beeldhouwer', 'Maler', 'Bildhauer',
];

/**
 * Queries Wikidata for structured artist facts (birthDate, deathDate, nationality,
 * movement, portrait). Returns a compact text block for injection into AI context,
 * or null if the artist isn't found. Cached 30 minutes — Wikidata data doesn't
 * change often and this is called for every autofill.
 *
 * Placed in this utility (not in ArtistEnrichmentService) to avoid a circular
 * NestJS module dependency: ArtistsModule → AiModule → ArtistsModule.
 */
export async function fetchWikidataArtistFacts(fullName: string): Promise<string | null> {
  const key = fullName.trim().toLowerCase();
  return wikidataFactsCache.wrap(key, () => fetchWikidataArtistFactsUncached(fullName));
}

async function fetchWikidataArtistFactsUncached(fullName: string): Promise<string | null> {
  try {
    const name = fullName.trim();
    const qid = await searchWikidataArtist(name) ?? await searchWikidataArtist(reverseTokens(name));
    if (!qid) return null;

    // SPARQL query for the scalar fields we care about
    const sparql = `
SELECT ?birthDate ?deathDate ?nationalityLabel ?movementLabel ?image WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item wdt:P569 ?birthDate }
  OPTIONAL { ?item wdt:P570 ?deathDate }
  OPTIONAL { ?item wdt:P27 ?nat . ?nat rdfs:label ?nationalityLabel FILTER(LANG(?nationalityLabel) = "en") }
  OPTIONAL { ?item wdt:P135 ?mov . ?mov rdfs:label ?movementLabel FILTER(LANG(?movementLabel) = "en") }
  OPTIONAL { ?item wdt:P18 ?image }
} LIMIT 1`;

    const sparqlRes = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(8_000) },
    );
    if (!sparqlRes.ok) return null;
    const sparqlJson = await sparqlRes.json() as { results?: { bindings?: Array<Record<string, { value: string }>> } };
    const binding = sparqlJson.results?.bindings?.[0];
    if (!binding) return null;

    const formatDate = (iso?: string) => iso ? iso.slice(0, 10).replace(/^-/, '') : undefined;
    const birthDate = formatDate(binding['birthDate']?.value);
    const deathDate = formatDate(binding['deathDate']?.value);
    const nationality = binding['nationalityLabel']?.value;
    const movement = binding['movementLabel']?.value;
    const imageUrl = binding['image']?.value
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(binding['image'].value.split('/').pop() ?? '')}?width=400`
      : undefined;

    const lines = [`[WIKIDATA VERIFIED — ${qid}] Facts for "${name}" — trust these above all other sources:`];
    if (birthDate) lines.push(`  birthDate: ${birthDate}`);
    if (deathDate) lines.push(`  deathDate: ${deathDate}`);
    if (nationality) lines.push(`  nationality: ${nationality}`);
    if (movement) lines.push(`  movement: ${movement}`);
    if (imageUrl) lines.push(`  imageUrl: ${imageUrl}`);
    if (lines.length === 1) return null; // found the entity but no useful fields
    return lines.join('\n');
  } catch {
    return null;
  }
}

async function searchWikidataArtist(name: string): Promise<string | null> {
  try {
    for (const lang of ['en', 'fr', 'nl', 'de', 'it', 'es']) {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&limit=8&format=json&type=item&origin=*`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(6_000) });
      if (!res.ok) continue;
      const data = await res.json() as { search?: Array<{ id: string; description?: string; label: string }> };
      const artHit = data.search?.find((r) =>
        WIKIDATA_ART_TERMS.some((t) => r.description?.toLowerCase().includes(t)),
      );
      if (artHit) return artHit.id;
    }
    return null;
  } catch {
    return null;
  }
}

function reverseTokens(name: string): string {
  const tokens = name.trim().split(/\s+/);
  return tokens.length === 2 ? `${tokens[1]} ${tokens[0]}` : name;
}
