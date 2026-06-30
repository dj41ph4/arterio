import * as cheerio from 'cheerio';
import { fetchHtml } from './gallery-site-scraper.util';
import { parseDimensions } from './dimensions-parser.util';

/**
 * Best-effort scraper for an artist's own official website (URL sourced from
 * Wikidata P856, see artist-enrichment.service.ts) — tries to find a page
 * listing works ("œuvres"/"catalogue raisonné"/"portfolio") and, within it, a
 * specific named work. Personal artist sites have wildly inconsistent markup,
 * so this stays deliberately conservative: returns null liberally rather than
 * risk attaching wrong data, and only trusts a title match that's exact after
 * normalization (not the looser token-overlap used elsewhere).
 */

export interface ScrapedWorkMatch {
  sourceUrl: string;
  techniqueName?: string;
  dimensionsNote?: string;
  heightCm?: number;
  widthCm?: number;
  signatureDescription?: string;
  dateText?: string;
  imageUrl?: string;
}

const CATALOGUE_LINK_PATTERN = /œuvres|oeuvres|works|catalogue|portfolio|gallery|paintings|tableaux/i;
const DIMENSION_HINT = /\d+[.,]?\d*\s*[x×]\s*\d+[.,]?\d*\s*(cm|in)/i;
const SIGNATURE_HINT = /sign[ée]e?\s+(en\s+)?(bas|haut)|signed\s+(lower|upper)/i;

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
}

export async function findWorkOnArtistSite(websiteUrl: string, title: string): Promise<ScrapedWorkMatch | null> {
  try {
    const rootHtml = await fetchHtml(websiteUrl);
    if (!rootHtml) return null;
    const $root = cheerio.load(rootHtml);

    const catalogueLink = $root('a')
      .filter((_, el) => CATALOGUE_LINK_PATTERN.test($root(el).text()))
      .first()
      .attr('href');
    if (!catalogueLink) return null;

    const catalogueUrl = new URL(catalogueLink, websiteUrl).toString();
    const catalogueHtml = await fetchHtml(catalogueUrl);
    if (!catalogueHtml) return null;
    const $cat = cheerio.load(catalogueHtml);

    const titleNorm = normalize(title);
    if (!titleNorm) return null;

    const workLink = $cat('a')
      .filter((_, el) => normalize($cat(el).text()).includes(titleNorm))
      .first();
    if (!workLink.length) return null;

    const workHref = workLink.attr('href');
    const workUrl = workHref ? new URL(workHref, catalogueUrl).toString() : catalogueUrl;
    const workHtml = workHref ? await fetchHtml(workUrl) : catalogueHtml;
    if (!workHtml) return null;
    const $work = cheerio.load(workHtml);
    const pageText = $work('body').text();

    if (!normalize(pageText).includes(titleNorm)) return null;

    const dimMatch = pageText.match(DIMENSION_HINT);
    const dims = dimMatch ? parseDimensions(dimMatch[0]) : null;
    const sigMatch = pageText.match(SIGNATURE_HINT);
    const imageUrl = $work('img').first().attr('src');

    const hasAnyData = dims || sigMatch;
    if (!hasAnyData) return null;

    return {
      sourceUrl: workUrl,
      dimensionsNote: dimMatch?.[0],
      heightCm: dims?.heightCm,
      widthCm: dims?.widthCm,
      signatureDescription: sigMatch?.[0],
      imageUrl: imageUrl ? new URL(imageUrl, workUrl).toString() : undefined,
    };
  } catch {
    return null;
  }
}
