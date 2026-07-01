import * as cheerio from 'cheerio';
import { BROWSER_HEADERS, fetchHtml } from './gallery-site-scraper.util';
import { TtlCache } from './ttl-cache.util';
import { isLikelyRealImage } from './download-image.util';

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

export interface DdgImageResult {
  imageUrl: string;
  pageUrl: string;
  title: string;
  width: number;
  height: number;
}

// Short TTL — long enough to absorb a double-click/dedupe race or a quick
// retry, short enough that results stay reasonably fresh.
const searchCache = new TtlCache<WebSearchResult[]>(5 * 60_000);
const pageTextCache = new TtlCache<string | null>(10 * 60_000);
const ddgImageCache = new TtlCache<DdgImageResult[]>(10 * 60_000);

/**
 * DDG image search — unofficial but key-less and free.
 * Step 1: fetch the DDG search page to extract the vqd session token.
 * Step 2: call the image JSON endpoint with that token.
 * Returns validated image URLs (HEAD-checked). Never throws — returns [] on any failure.
 * Cached 10 min per query.
 */
export async function ddgImageSearch(query: string, limit = 6): Promise<DdgImageResult[]> {
  const key = `${query.trim().toLowerCase()}::${limit}`;
  return ddgImageCache.wrap(key, () => ddgImageSearchUncached(query, limit));
}

async function ddgImageSearchUncached(query: string, limit: number): Promise<DdgImageResult[]> {
  try {
    // Step 1 — get vqd token from the HTML search page
    const searchPageRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10_000) },
    );
    if (!searchPageRes.ok) return [];
    const html = await searchPageRes.text();

    // vqd token is embedded in a script block — format varies across DDG versions:
    // vqd='4-123...' or vqd="4-abc..." (alphanumeric + hyphens, not digits only)
    const vqdMatch = html.match(/vqd[=\s'"]+['"]?([^'"&\s]{4,})/);
    if (!vqdMatch?.[1]) return [];
    const vqd = vqdMatch[1];

    // Step 2 — fetch image results JSON
    const imgUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&o=json&p=-1&s=0&u=bing&f=,,,,,&l=fr-fr&vqd=${encodeURIComponent(vqd)}`;
    const imgRes = await fetch(imgUrl, {
      headers: { ...BROWSER_HEADERS, Referer: 'https://duckduckgo.com/' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!imgRes.ok) return [];

    const json = await imgRes.json() as {
      results?: Array<{ image: string; url: string; title: string; width: number; height: number }>;
    };
    const raw = (json.results ?? []).filter((r) => r.image?.startsWith('http'));

    // Validate in parallel (short timeout) — DDG results are generally real but
    // some are hotlink-blocked or dead. Cap at limit*2 candidates, return first `limit` valid.
    const checks = await Promise.all(
      raw.slice(0, limit * 2).map(async (r) => ({
        r,
        ok: await isLikelyRealImage(r.image),
      })),
    );
    return checks
      .filter((c) => c.ok)
      .slice(0, limit)
      .map((c) => ({ imageUrl: c.r.image, pageUrl: c.r.url, title: c.r.title, width: c.r.width ?? 0, height: c.r.height ?? 0 }));
  } catch {
    return [];
  }
}

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
    if (!res.ok) {
      console.error(`[DDG] HTTP ${res.status} pour: ${query.slice(0, 80)}`);
      return [];
    }
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
    console.log(`[DDG] status=${res.status} htmlLen=${html.length} .result=${(html.match(/class="result"/g)??[]).length} parsed=${results.length} q="${query.slice(0, 60)}"`);
    return results;
  } catch (err) {
    console.error(`[DDG] exception: ${String(err).slice(0, 120)} — q="${query.slice(0, 60)}"`);
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
 * Artwork-specific multi-query context builder.
 *
 * Strategy — informed by testing across the collection:
 *  - Famous artists with specific titles (Ensor, Alechinsky, Picasso): a bare
 *    "artist" "title" query immediately finds gazette-drouot, amorosart, devuyst,
 *    michelfillion, invaluable — far better than forcing site: operators that
 *    DDG may ignore or over-filter.
 *  - Print/estampe specialists (Alechinsky, Ensor, Picasso): amorosart.com,
 *    michelfillion.com, mchampetier.com hold lot descriptions with edition, size,
 *    technique, signature — essential and absent from the old query.
 *  - Regional Belgian artists with an official site (Dubail Berthe → berthe-dubail.be):
 *    the bare query surfaces it; the page fetch yields full catalogue data.
 *  - Contemporary artists (Bocage, Manche, Demaiter): galerie pages
 *    (galerie-com.com, galerie-container.com) are the only online source;
 *    the bare query finds them.
 *  - Generic titles (COMPOSITION, PAYSAGE, NU): title is almost useless for
 *    disambiguation — artist name is the real anchor.
 *
 * Key lesson: multi-site OR queries ("site:A OR site:B OR site:C OR ...") in DDG
 * are unreliable — the engine either ignores them or returns nothing. A bare query
 * finds the best matching page regardless of domain, then the auction/print
 * targeted queries add depth for well-catalogued works.
 *
 * Queries run sequentially with 300 ms gaps (same rate-limit reason as the
 * artist builder — parallel blasts trigger DDG bot detection in bulk mode).
 */
export async function buildArtworkSearchContext(artistName: string, title: string, maxTotalChars = 8000): Promise<string | null> {
  try {
    const quoted = (s: string) => `"${s.replace(/"/g, '')}"`;
    const a = artistName.trim();
    const t = title.trim();
    if (!a && !t) return null;

    const aQ = a ? quoted(a) : '';
    const tQ = t ? quoted(t) : '';
    const both = `${aQ} ${tQ}`.trim();

    // Query strategy (sequential, 300 ms gap):
    // 1. Bare artist + title — no site restriction, highest hit rate for ALL types.
    //    Finds official artist sites, gallery pages, auction records, museum pages.
    // 2. Auction + print gallery specialists — best for technical lot descriptions
    //    (dimensions, edition, signature); gazette-drouot + amorosart are excellent
    //    for French/Belgian estampes and consistently appear in manual searches.
    // 3. Artist-level databases — gives the AI artist identity context (nationality,
    //    dates, movement) even when the specific work has no auction record.
    const queries = [
      both,
      `${both} site:gazette-drouot.com OR site:interencheres.com OR site:amorosart.com OR site:michelfillion.com`,
      `${aQ} site:artprice.com OR site:artnet.com OR site:invaluable.com OR site:wikiart.org`,
    ];

    const allResultSets: WebSearchResult[][] = [];
    for (const query of queries) {
      allResultSets.push(await searchWeb(query, 5));
      await new Promise((r) => setTimeout(r, 300));
    }

    // Merge and deduplicate — bare query results first (most relevant).
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
      .slice(0, 10)
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})${r.snippet ? `: ${r.snippet}` : ''}`)
      .join('\n');

    // Fetch page text. Auction/print catalogue pages get a larger budget —
    // their lot descriptions are dense with exactly the facts we need.
    const richDomains = [
      'interencheres.com', 'drouot.com', 'gazette-drouot.com', 'artprice.com',
      'invaluable.com', 'liveauctioneers.com', 'mutualart.com', 'artnet.com',
      'amorosart.com', 'michelfillion.com', 'mchampetier.com',
    ];
    const pages = await Promise.all(
      merged.slice(0, 6).map(async (r, i) => {
        const isRich = richDomains.some((d) => r.url.includes(d));
        const charBudget = isRich ? Math.floor(maxTotalChars / 3) : Math.floor(maxTotalChars / 6);
        const text = await fetchPageText(r.url, charBudget);
        return text ? `[${i + 1}] ${r.url}:\n${text}` : null;
      }),
    );
    const pagesBlock = pages.filter((p): p is string => Boolean(p)).join('\n\n');

    // Wikipedia artist context — helps the AI identify the artist even when the
    // specific work has no online record (common for generic titles like PAYSAGE).
    const wikiExtract = a ? await fetchWikipediaExtract(a) : null;

    let context = `Web search results for "${[a, t].filter(Boolean).join(' ')}":\n${resultsBlock}`;
    if (pagesBlock) context += `\n\nPage excerpts:\n${pagesBlock}`;
    if (wikiExtract) context += `\n\n${wikiExtract}`;
    return context.slice(0, maxTotalChars + 1000);
  } catch {
    return null;
  }
}

export interface ArtistSearchDebug {
  /** One DDG query entry per query attempted, with the number of results returned. */
  queries: Array<{ q: string; hits: number }>;
  wikidataFound: boolean;
  wikipediaFound: boolean;
  officialSiteFound: boolean;
  /** One-sentence diagnosis of why context is empty, or what was found. */
  reason: string;
}

/**
 * Artist-specific multi-query context builder.
 * Returns both the context string (null if nothing useful found) and a debug
 * object with per-query hit counts and a one-sentence reason — surfaced in
 * the AI audit log so you can see exactly why a search failed.
 */
export async function buildArtistSearchContext(
  fullName: string,
  officialWebsite?: string,
  maxTotalChars = 12000,
): Promise<{ context: string | null; debug: ArtistSearchDebug }> {
  const debug: ArtistSearchDebug = {
    queries: [],
    wikidataFound: false,
    wikipediaFound: false,
    officialSiteFound: false,
    reason: '',
  };
  try {
    const name = fullName.trim();
    if (!name) {
      debug.reason = 'Nom vide — aucune recherche effectuée.';
      return { context: null, debug };
    }
    const q = (s: string) => `"${s.replace(/"/g, '')}"`;
    const inverted = reverseTokens(name);
    const nameA = q(name);
    const nameB = inverted !== name ? q(inverted) : null;

    const bothNames = `${nameA}${nameB ? ` OR ${nameB}` : ''}`;
    const queries = [
      bothNames,
      `${bothNames} site:artsper.com OR site:kazoart.com OR site:artmajeur.com`,
      `${bothNames} site:artprice.com OR site:interencheres.com OR site:drouot.com`,
      `${bothNames} site:data.bnf.fr OR site:wikiart.org OR site:magnumphotos.com`,
      `${bothNames} galerie exposition artiste biographie`,
    ];

    const allResultSets: WebSearchResult[][] = [];
    for (const query of queries) {
      const results = await searchWeb(query, 5);
      allResultSets.push(results);
      debug.queries.push({ q: query, hits: results.length });
      await new Promise((r) => setTimeout(r, 300));
    }

    const totalHits = debug.queries.reduce((s, q) => s + q.hits, 0);

    const seen = new Set<string>();
    const merged: WebSearchResult[] = [];
    for (const set of allResultSets) {
      for (const r of set) {
        if (!seen.has(r.url)) { seen.add(r.url); merged.push(r); }
      }
    }

    if (!merged.length) {
      const allZero = debug.queries.every((q) => q.hits === 0);
      debug.reason = allZero
        ? 'DDG rate-limité ou artiste inconnu du web : toutes les requêtes ont retourné 0 résultat.'
        : 'DDG a retourné des URLs mais toutes en double — contexte vide.';

      // Still try Wikidata + Wikipedia even if DDG failed
      const wikidataFacts = await fetchWikidataArtistFacts(name);
      const wikiExtract = await fetchWikipediaFull(name);
      debug.wikidataFound = !!wikidataFacts;
      debug.wikipediaFound = !!wikiExtract;
      if (wikidataFacts || wikiExtract) {
        let ctx = '';
        if (wikidataFacts) ctx += `${wikidataFacts}\n\n`;
        if (wikiExtract) ctx += wikiExtract;
        debug.reason += wikidataFacts
          ? ' Wikidata trouvé malgré l\'absence DDG.'
          : ' Wikipedia trouvé malgré l\'absence DDG.';
        return { context: ctx.trim().slice(0, maxTotalChars + 2000), debug };
      }
      return { context: null, debug };
    }

    const resultsBlock = merged
      .slice(0, 12)
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url})${r.snippet ? `: ${r.snippet}` : ''}`)
      .join('\n');

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
    const pagesFetched = pages.filter(Boolean).length;

    const wikiExtract = await fetchWikipediaFull(name);
    const wikidataFacts = await fetchWikidataArtistFacts(name);
    debug.wikidataFound = !!wikidataFacts;
    debug.wikipediaFound = !!wikiExtract;

    let officialSiteBlock: string | null = null;
    if (officialWebsite) {
      const siteText = await fetchPageText(officialWebsite, 5000);
      if (siteText) {
        officialSiteBlock = `[SITE OFFICIEL — ${officialWebsite}]\n${siteText}`;
        debug.officialSiteFound = true;
      }
      seen.add(officialWebsite);
    }

    let context = `Web search results for artist "${name}":\n${resultsBlock}`;
    if (pagesBlock) context += `\n\nPage excerpts:\n${pagesBlock}`;
    if (wikiExtract) context += `\n\n${wikiExtract}`;
    if (officialSiteBlock) context = `${officialSiteBlock}\n\n${context}`;
    if (wikidataFacts) context = `${wikidataFacts}\n\n${context}`;

    const sources: string[] = [];
    if (debug.officialSiteFound) sources.push('site officiel');
    if (debug.wikidataFound) sources.push('Wikidata');
    if (debug.wikipediaFound) sources.push('Wikipedia');
    if (totalHits > 0) sources.push(`${merged.length} URLs DDG (${pagesFetched} pages lues)`);
    debug.reason = sources.length
      ? `Contexte construit depuis : ${sources.join(', ')}.`
      : `DDG a trouvé ${totalHits} résultats mais aucune page lisible.`;

    return { context: context.slice(0, maxTotalChars + 2000), debug };
  } catch (err) {
    debug.reason = `Erreur inattendue : ${String(err).slice(0, 120)}`;
    return { context: null, debug };
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
