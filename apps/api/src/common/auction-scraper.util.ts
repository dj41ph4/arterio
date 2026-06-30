import * as cheerio from 'cheerio';
import { fetchHtml } from './gallery-site-scraper.util';
import { searchWeb } from './free-web-search.util';
import { parseDimensions } from './dimensions-parser.util';

/**
 * Auction-lot scraper — the highest-uncertainty source in the autofill
 * pipeline (these sites are the most likely to add bot-protection or change
 * markup). Scoped to 1-2 French regional auction networks for v1, matching
 * the "regional/niche, not just Artnet/Invaluable" brief: Drouot (drouot.com)
 * and Interencheres aggregate many small French auction houses and are
 * largely server-rendered, unlike Invaluable/Artnet's heavier JS/anti-bot.
 *
 * Unlike the gallery-site-scraper.util.ts artist scrapers (which guess a
 * slug from a name), an artwork title is too variable to guess a URL for —
 * instead this reuses the free web search (free-web-search.util.ts) scoped
 * with a `site:` operator to find the actual lot page, then scrapes that
 * specific page. Each house gets its own extractor (extractDrouotLot,
 * extractInterencheresLot) so one can be fixed or dropped independently.
 * Returns null on any failure, including "house probably blocked us" —
 * never throws, degrades silently like every other fallback source here.
 */

export interface AuctionLotHit {
  source: 'drouot' | 'interencheres';
  title: string;
  matchedUrl: string;
  techniqueName?: string;
  dimensionsNote?: string;
  heightCm?: number;
  widthCm?: number;
  signatureDescription?: string;
  dateText?: string;
  imageUrl?: string;
  priceRealized?: string;
}

const SIGNATURE_HINT = /sign[ée]e?\s+(en\s+)?(bas|haut)[^.]{0,40}/i;
const DIMENSION_HINT = /\d+[.,]?\d*\s*[x×]\s*\d+[.,]?\d*\s*cm/i;
const PRICE_HINT = /(\d[\d\s.,]*\s*(€|EUR|\$))/i;

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
}

function titleAndArtistMentioned(pageText: string, artistName: string | undefined, title: string): boolean {
  const norm = normalize(pageText);
  const titleTokens = normalize(title).split(/\s+/).filter((t) => t.length > 2);
  if (!titleTokens.length || !titleTokens.every((t) => norm.includes(t))) return false;
  if (artistName) {
    const artistTokens = normalize(artistName).split(/\s+/).filter((t) => t.length > 1);
    if (artistTokens.length && !artistTokens.some((t) => norm.includes(t))) return false;
  }
  return true;
}

async function extractLot(url: string, artistName: string | undefined, title: string): Promise<Omit<AuctionLotHit, 'source' | 'title' | 'matchedUrl'> | null> {
  const html = await fetchHtml(url);
  if (!html) return null;
  try {
    const $ = cheerio.load(html);
    const pageText = $('body').text();
    if (!titleAndArtistMentioned(pageText, artistName, title)) return null;

    const techniqueSelectors = ['[class*="technique"]', '[class*="medium"]', '[class*="materiau"]'];
    const techniqueName = techniqueSelectors
      .map((sel) => $(sel).first().text().trim())
      .find((t) => t.length > 2);

    const dimMatch = pageText.match(DIMENSION_HINT);
    const dims = dimMatch ? parseDimensions(dimMatch[0]) : null;
    const sigMatch = pageText.match(SIGNATURE_HINT);
    const priceMatch = pageText.match(PRICE_HINT);
    const imageUrl = $('meta[property="og:image"]').attr('content') ?? $('img').first().attr('src');

    return {
      techniqueName,
      dimensionsNote: dimMatch?.[0],
      heightCm: dims?.heightCm,
      widthCm: dims?.widthCm,
      signatureDescription: sigMatch?.[0]?.trim(),
      priceRealized: priceMatch?.[0]?.trim(),
      imageUrl: imageUrl ? new URL(imageUrl, url).toString() : undefined,
    };
  } catch {
    return null;
  }
}

async function searchHouse(
  source: 'drouot' | 'interencheres',
  site: string,
  artistName: string | undefined,
  title: string,
): Promise<AuctionLotHit | null> {
  const results = await searchWeb(`${artistName ?? ''} "${title}" site:${site}`.trim(), 3);
  for (const result of results) {
    const extracted = await extractLot(result.url, artistName, title);
    if (extracted) return { source, title, matchedUrl: result.url, ...extracted };
  }
  return null;
}

export async function searchAuctionLots(artistName: string | undefined, title: string): Promise<AuctionLotHit | null> {
  if (!title?.trim()) return null;
  return (await searchHouse('drouot', 'drouot.com', artistName, title)) ?? (await searchHouse('interencheres', 'interencheres.com', artistName, title));
}
