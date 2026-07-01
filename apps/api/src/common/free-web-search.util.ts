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
 * Artist-specific multi-query context builder.
 *
 * Strategy: for well-known artists, biography/encyclopaedia sites dominate.
 * For regional or lesser-known artists, auction catalogues are often the only
 * machine-readable source. We run five complementary DDG queries in parallel,
 * also try the name inverted (Lastname Firstname → Firstname Lastname), fetch
 * the full text of the most promising pages, and inject Wikidata + Wikipedia
 * as authoritative anchors so the AI doesn't have to guess from thin context.
 *
 * If officialWebsite is provided (from DB or discovered by findArtistOfficialWebsite),
 * it is fetched first with a large budget and injected as the top-priority source —
 * the artist's own site contains the most authoritative biography.
 */
export async function buildArtistSearchContext(fullName: string, officialWebsite?: string, maxTotalChars = 12000): Promise<string | null> {
  try {
    const name = fullName.trim();
    if (!name) return null;
    const q = (s: string) => `"${s.replace(/"/g, '')}"`;
    const inverted = reverseTokens(name);
    // Both name orders: DB often stores "LASTNAME Firstname", web uses "Firstname Lastname"
    const nameA = q(name);
    const nameB = inverted !== name ? q(inverted) : null;

    // Run queries sequentially with a small gap to avoid DDG rate-limiting.
    // Parallel blasts (5 queries at once × N artists in bulk) reliably trigger
    // DDG's bot-detection — sequential with 300 ms gap stays well under the limit.
    //
    // Query strategy — informed by testing across 4 artist categories:
    //  - Famous/classical: any query works (Wikipedia/museum pages rank high)
    //  - Contemporary regional: artsper/kazoart/artmajeur are the primary source;
    //    NOT covered by generic "artiste peintre" or auction queries
    //  - Photographers: magnumphotos/delpire rank high; avoid "peintre" qualifier
    //  - Street art: street-art-avenue/bewaremag; avoid "peintre" qualifier
    //  - Aboriginal: artsdaustralie/aborigene.fr; covered by bare name query
    //
    // Key lessons:
    //  1. Query 1 uses bare name only (no genre suffix) — works for ALL artist types
    //  2. Query 2 targets contemporary art marketplaces — critical for regional artists
    //  3. Auction/photo/street art queries are separate so genre labels don't pollute
    const bothNames = `${nameA}${nameB ? ` OR ${nameB}` : ''}`;
    const queries = [
      // 1. Bare name — no genre qualifier, highest hit rate across ALL artist types
      //    (photographers, street artists, Aboriginal artists all lose results with "peintre")
      bothNames,
      // 2. Contemporary art marketplaces — critical for regional/living artists not in auctions
      `${bothNames} site:artsper.com OR site:kazoart.com OR site:artmajeur.com`,
      // 3. Auction/market — most reliable for confirmed dates/nationality in lot descriptions
      `${bothNames} site:artprice.com OR site:interencheres.com OR site:drouot.com`,
      // 4. Authority databases + encyclopaedia sites
      `${bothNames} site:data.bnf.fr OR site:wikiart.org OR site:magnumphotos.com`,
      // 5. Galleries, press, specialty arts media (covers street art, photography, catalogues)
      `${bothNames} galerie exposition artiste biographie`,
    ];

    const allResultSets: WebSearchResult[][] = [];
    for (const query of queries) {
      allResultSets.push(await searchWeb(query, 5));
      await new Promise((r) => setTimeout(r, 300));
    }

    // Merge and deduplicate — auction results first (they usually have the best data).
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
      .slice(0, 12)
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})${r.snippet ? `: ${r.snippet}` : ''}`)
      .join('\n');

    // Fetch full page text for the top 7 results — auction pages get a larger
    // budget because lot descriptions are dense with exactly the facts we need.
    const auctionDomains = ['interencheres.com', 'drouot.com', 'artprice.com', 'invaluable.com', 'liveauctioneers.com', 'mutualart.com', 'artnet.com'];
    const pages = await Promise.all(
      merged.slice(0, 7).map(async (r, i) => {
        const isAuction = auctionDomains.some((d) => r.url.includes(d));
        const charBudget = isAuction ? Math.floor(maxTotalChars / 4) : Math.floor(maxTotalChars / 7);
        const text = await fetchPageText(r.url, charBudget);
        return text ? `[${i + 1}] ${r.url}:\n${text}` : null;
      }),
    );
    const pagesBlock = pages.filter((p): p is string => Boolean(p)).join('\n\n');

    // Wikipedia — try all 6 app locales, take the longest extract found.
    const wikiExtract = await fetchWikipediaFull(name);

    // Wikidata structured facts — injected FIRST as the highest-priority anchor.
    const wikidataFacts = await fetchWikidataArtistFacts(name);

    // Official website — fetched with a large budget (5 000 chars) and injected
    // just after Wikidata as the most authoritative biographical source: the
    // artist's own site contains the raw bio, CV, and statements that the AI
    // then cleans up and structures. Excluded from the DDG page-fetch above to
    // guarantee it always gets its own generous budget regardless of rank.
    let officialSiteBlock: string | null = null;
    if (officialWebsite) {
      const siteText = await fetchPageText(officialWebsite, 5000);
      if (siteText) officialSiteBlock = `[SITE OFFICIEL — ${officialWebsite}]\n${siteText}`;
      // Mark as seen so it doesn't get double-fetched in the pages loop
      seen.add(officialWebsite);
    }

    let context = `Web search results for artist "${name}":\n${resultsBlock}`;
    if (pagesBlock) context += `\n\nPage excerpts:\n${pagesBlock}`;
    if (wikiExtract) context += `\n\n${wikiExtract}`;
    if (officialSiteBlock) context = `${officialSiteBlock}\n\n${context}`;
    if (wikidataFacts) context = `${wikidataFacts}\n\n${context}`;
    return context.slice(0, maxTotalChars + 2000);
  } catch {
    return null;
  }
}

/**
 * Fetches the full Wikipedia article text (not just the REST summary) for an
 * artist name, trying all 6 app locales. Prefers longer articles. Capped at
 * 4 000 chars so one Wikipedia page can't crowd out other sources.
 */
async function fetchWikipediaFull(name: string, maxChars = 4000): Promise<string | null> {
  const locales = ['fr', 'en', 'nl', 'de', 'it', 'es'];
  const candidates: Array<{ lang: string; title: string; text: string }> = [];

  await Promise.all(locales.map(async (lang) => {
    try {
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json&origin=*`;
      const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });
      if (!searchRes.ok) return;
      const searchJson = await searchRes.json() as { query?: { search?: Array<{ title: string }> } };
      const pageTitle = searchJson.query?.search?.[0]?.title;
      if (!pageTitle) return;

      // Fetch the full article via the extract API (more than the REST summary)
      const extractUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=extracts&exintro=false&explaintext=true&exsectionformat=plain&format=json&origin=*`;
      const extractRes = await fetch(extractUrl, { signal: AbortSignal.timeout(8000) });
      if (!extractRes.ok) return;
      const extractJson = await extractRes.json() as { query?: { pages?: Record<string, { extract?: string; title?: string }> } };
      const pages = extractJson.query?.pages ?? {};
      const page = Object.values(pages)[0];
      if (page?.extract && page.extract.length > 100) {
        candidates.push({ lang, title: page.title ?? pageTitle, text: page.extract });
      }
    } catch { /* try next locale */ }
  }));

  if (!candidates.length) return null;
  // Prefer the longest article (usually the most complete)
  candidates.sort((a, b) => b.text.length - a.text.length);
  const best = candidates[0]!;
  return `Wikipedia (${best.lang}) — ${best.title}:\n${best.text.slice(0, maxChars)}`;
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

// ---------------------------------------------------------------------------
// Official website discovery
// ---------------------------------------------------------------------------

// Domains that are never an artist's own site
const EXCLUDED_DOMAINS = [
  'wikipedia.org', 'wikidata.org', 'wikiart.org', 'artprice.com', 'artnet.com',
  'interencheres.com', 'drouot.com', 'invaluable.com', 'liveauctioneers.com',
  'mutualart.com', 'findartinfo.com', 'askart.com', 'rkd.nl', 'data.bnf.fr',
  'viaf.org', 'facebook.com', 'instagram.com', 'twitter.com', 'youtube.com',
  'amazon.com', 'amazon.fr', 'ebay.com', 'etsy.com', 'pinterest.com',
  // Contemporary art marketplaces — great search sources but not official artist sites
  'artsper.com', 'kazoart.com', 'artmajeur.com', 'lilleartup.com',
  'saatchiart.com', 'artsy.net',
];

const officialWebsiteCache = new TtlCache<string | null>(60 * 60_000); // 1 h

/**
 * Tries to discover an artist's official website via DDG.
 * Returns the validated URL (artist's name found on the page) or null.
 * Cached 1 hour — run once per artist, result stored in DB by the caller.
 */
export async function findArtistOfficialWebsite(fullName: string): Promise<string | null> {
  return officialWebsiteCache.wrap(fullName.trim().toLowerCase(), () => findArtistOfficialWebsiteUncached(fullName));
}

async function findArtistOfficialWebsiteUncached(fullName: string): Promise<string | null> {
  try {
    const name = fullName.trim();
    const q = `"${name}" site officiel OR "official website" OR artiste peintre`;
    const results = await searchWeb(q, 8);

    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const nameParts = normalize(name).split(/\s+/);

    for (const r of results) {
      try {
        const domain = new URL(r.url).hostname.replace(/^www\./, '');
        // Skip known aggregator/social/auction domains
        if (EXCLUDED_DOMAINS.some((d) => domain.includes(d))) continue;

        // Validate: fetch the page and check the artist's name appears in it
        const text = await fetchPageText(r.url, 3000);
        if (!text) continue;
        const normalizedText = normalize(text);
        // Both first name and last name must appear on the page
        const allPartsFound = nameParts.every((part) => part.length > 2 && normalizedText.includes(part));
        if (allPartsFound) return r.url;
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}
