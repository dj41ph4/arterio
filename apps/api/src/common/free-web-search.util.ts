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
