import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { parseDimensions } from '../../common/dimensions-parser.util';
import { findWorkOnArtistSite } from '../../common/artist-website-scraper.util';
import { searchAuctionLots } from '../../common/auction-scraper.util';
import type { Env } from '../../core/config/configuration';
import type { ArtworkAutofillResult } from './ai.types';

export interface ArtworkObjectHit {
  source: 'drouot' | 'interencheres' | 'met' | 'aic' | 'cleveland' | 'vam' | 'rijksmuseum' | 'harvard' | 'smithsonian' | 'artist-website';
  matchedTitle: string;
  sourceUrl?: string;
  result: Partial<ArtworkAutofillResult>;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** True when the searched title's significant words all appear in the candidate title — same token-overlap approach used elsewhere (artist name matching) so a homonym/different-edition title isn't trusted by accident. */
function titleMatches(searched: string, candidate: string | undefined): boolean {
  if (!candidate) return false;
  const candidateNorm = normalize(candidate);
  const tokens = normalize(searched).split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return false;
  return tokens.every((t) => candidateNorm.includes(t));
}

/**
 * Object-level (title + artist) lookup across the same museum APIs the
 * artist-enrichment fallback chain already uses at the artist-identity
 * level (artist-enrichment.service.ts) — here every source is queried for
 * the SPECIFIC NAMED WORK instead, returning structured technique/dimensions/
 * image data when there's a confident title match. This is the highest-trust
 * source for artwork autofill: official, documented, stable JSON APIs, no
 * scraping and no LLM guesswork involved. Tried in order, first confident
 * hit wins — never throws, returns null on any failure.
 */
@Injectable()
export class StructuredLookupService {
  private readonly logger = new Logger(StructuredLookupService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async searchArtworkByTitle(artistName: string | undefined, title: string | undefined, organizationId?: string): Promise<ArtworkObjectHit | null> {
    if (!title?.trim()) return null;
    const keys = await this.resolveKeys(organizationId);

    const providers: Array<[ArtworkObjectHit['source'], () => Promise<ArtworkObjectHit | null>]> = [
      // A real auction lot for THIS exact piece beats an authoritative museum
      // record that may describe a different copy/edition — tried first.
      ['drouot', () => this.fetchFromAuction(artistName, title)],
      ['aic', () => this.fetchFromAic(artistName, title)],
      ['met', () => this.fetchFromMet(artistName, title)],
      ['cleveland', () => this.fetchFromCleveland(artistName, title)],
      ['vam', () => this.fetchFromVam(artistName, title)],
      ['rijksmuseum', () => this.fetchFromRijksmuseum(artistName, title, keys.rijksmuseum)],
      ['harvard', () => this.fetchFromHarvard(artistName, title, keys.harvard)],
      ['smithsonian', () => this.fetchFromSmithsonian(artistName, title, keys.smithsonian)],
      // Lowest-trust source: an arbitrary personal website's markup, only
      // tried once every official museum API has come up empty.
      ['artist-website', () => this.fetchFromArtistWebsite(artistName, title, organizationId)],
    ];

    for (const [source, provider] of providers) {
      try {
        const hit = await provider();
        if (hit) {
          // hit.source (not the tuple's `source`) is the accurate label — the
          // auction entry's tuple key is a placeholder since it may resolve
          // to either drouot or interencheres internally.
          this.logger.log(`Recherche structurée d'œuvre — HIT "${title}" via ${hit.source}`);
          return hit;
        }
      } catch (err) {
        this.logger.warn(`Recherche structurée d'œuvre — échec ${source} pour "${title}": ${String(err)}`);
      }
    }
    return null;
  }

  private async fetchFromAuction(artistName: string | undefined, title: string): Promise<ArtworkObjectHit | null> {
    const hit = await searchAuctionLots(artistName, title);
    if (!hit) return null;
    return {
      source: hit.source,
      matchedTitle: hit.title,
      sourceUrl: hit.matchedUrl,
      result: {
        techniqueName: hit.techniqueName,
        dateText: hit.dateText,
        dimensionsNote: hit.dimensionsNote,
        heightCm: hit.heightCm,
        widthCm: hit.widthCm,
        signatureDescription: hit.signatureDescription,
        imageUrl: hit.imageUrl,
      },
    };
  }

  /** Looks up the artist's official website (stored on the Artist record from Wikidata P856 — see artist-enrichment.service.ts) and tries to find this specific title on it. */
  private async fetchFromArtistWebsite(artistName: string | undefined, title: string, organizationId?: string): Promise<ArtworkObjectHit | null> {
    if (!artistName?.trim() || !organizationId) return null;
    const artist = await this.prisma.artist.findFirst({
      where: { organizationId, fullName: artistName },
      select: { externalIds: true },
    });
    const websiteUrl = (artist?.externalIds as Record<string, string> | null)?.officialWebsite;
    if (!websiteUrl) return null;

    const hit = await findWorkOnArtistSite(websiteUrl, title);
    if (!hit) return null;
    return {
      source: 'artist-website',
      matchedTitle: title,
      sourceUrl: hit.sourceUrl,
      result: {
        techniqueName: hit.techniqueName,
        dateText: hit.dateText,
        dimensionsNote: hit.dimensionsNote,
        heightCm: hit.heightCm,
        widthCm: hit.widthCm,
        signatureDescription: hit.signatureDescription,
        imageUrl: hit.imageUrl,
      },
    };
  }

  private async resolveKeys(organizationId?: string): Promise<Record<'rijksmuseum' | 'harvard' | 'smithsonian', string | undefined>> {
    const envKeys = {
      rijksmuseum: this.config.get('RIJKSMUSEUM_API_KEY', { infer: true }),
      harvard: this.config.get('HARVARD_API_KEY', { infer: true }),
      smithsonian: this.config.get('SMITHSONIAN_API_KEY', { infer: true }),
    };
    if (!organizationId) return envKeys;
    try {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      const stored = ((org?.settings as Record<string, unknown>)?.externalSources as Record<string, string>) ?? {};
      const decrypt = (v: string | undefined) => (v ? this.crypto.decrypt(v) : undefined);
      return {
        rijksmuseum: decrypt(stored.rijksmuseum) ?? envKeys.rijksmuseum,
        harvard: decrypt(stored.harvard) ?? envKeys.harvard,
        smithsonian: decrypt(stored.smithsonian) ?? envKeys.smithsonian,
      };
    } catch {
      return envKeys;
    }
  }

  private query(artistName: string | undefined, title: string): string {
    return `${artistName ?? ''} ${title}`.trim();
  }

  private async fetchFromAic(artistName: string | undefined, title: string): Promise<ArtworkObjectHit | null> {
    const res = await fetch(
      `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(this.query(artistName, title))}&fields=id,title,artist_display,medium_display,dimensions,image_id,date_display&limit=5`,
      { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ title?: string; medium_display?: string; dimensions?: string; date_display?: string; image_id?: string; id: number }>;
    };
    const hit = data.data?.find((d) => titleMatches(title, d.title));
    if (!hit) return null;
    const dims = parseDimensions(hit.dimensions);
    return {
      source: 'aic',
      matchedTitle: hit.title ?? title,
      sourceUrl: `https://www.artic.edu/artworks/${hit.id}`,
      result: {
        techniqueName: hit.medium_display || undefined,
        dateText: hit.date_display || undefined,
        dimensionsNote: hit.dimensions || undefined,
        heightCm: dims?.heightCm,
        widthCm: dims?.widthCm,
        imageUrl: hit.image_id ? `https://www.artic.edu/iiif/2/${hit.image_id}/full/843,/0/default.jpg` : undefined,
      },
    };
  }

  private async fetchFromMet(artistName: string | undefined, title: string): Promise<ArtworkObjectHit | null> {
    const searchRes = await fetch(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(this.query(artistName, title))}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!searchRes.ok) return null;
    const { objectIDs } = (await searchRes.json()) as { objectIDs?: number[] };
    if (!objectIDs?.length) return null;

    for (const id of objectIDs.slice(0, 5)) {
      const objRes = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!objRes.ok) continue;
      const obj = (await objRes.json()) as {
        title?: string;
        medium?: string;
        dimensions?: string;
        objectDate?: string;
        primaryImageSmall?: string;
        primaryImage?: string;
        objectURL?: string;
      };
      if (!titleMatches(title, obj.title)) continue;
      const dims = parseDimensions(obj.dimensions);
      return {
        source: 'met',
        matchedTitle: obj.title ?? title,
        sourceUrl: obj.objectURL,
        result: {
          techniqueName: obj.medium || undefined,
          dateText: obj.objectDate || undefined,
          dimensionsNote: obj.dimensions || undefined,
          heightCm: dims?.heightCm,
          widthCm: dims?.widthCm,
          imageUrl: obj.primaryImageSmall || obj.primaryImage || undefined,
        },
      };
    }
    return null;
  }

  private async fetchFromCleveland(artistName: string | undefined, title: string): Promise<ArtworkObjectHit | null> {
    const res = await fetch(
      `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(this.query(artistName, title))}&limit=5`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ title?: string; technique?: string; measurements?: string; creation_date?: string; images?: { web?: { url?: string } }; url?: string }>;
    };
    const hit = data.data?.find((d) => titleMatches(title, d.title));
    if (!hit) return null;
    const dims = parseDimensions(hit.measurements);
    return {
      source: 'cleveland',
      matchedTitle: hit.title ?? title,
      sourceUrl: hit.url,
      result: {
        techniqueName: hit.technique || undefined,
        dateText: hit.creation_date || undefined,
        dimensionsNote: hit.measurements || undefined,
        heightCm: dims?.heightCm,
        widthCm: dims?.widthCm,
        imageUrl: hit.images?.web?.url,
      },
    };
  }

  private async fetchFromVam(artistName: string | undefined, title: string): Promise<ArtworkObjectHit | null> {
    const res = await fetch(
      `https://api.vam.ac.uk/v2/objects/search?q=${encodeURIComponent(this.query(artistName, title))}&page_size=5`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      records?: Array<{ _primaryTitle?: string; objectType?: string; _primaryDate?: string; _primaryImageId?: string; systemNumber?: string }>;
    };
    const hit = data.records?.find((r) => titleMatches(title, r._primaryTitle));
    if (!hit) return null;
    return {
      source: 'vam',
      matchedTitle: hit._primaryTitle ?? title,
      sourceUrl: hit.systemNumber ? `https://collections.vam.ac.uk/item/${hit.systemNumber}` : undefined,
      result: {
        techniqueName: hit.objectType || undefined,
        dateText: hit._primaryDate || undefined,
        imageUrl: hit._primaryImageId
          ? `https://framemark.vam.ac.uk/collections/${hit._primaryImageId}/full/full/0/default.jpg`
          : undefined,
      },
    };
  }

  private async fetchFromRijksmuseum(artistName: string | undefined, title: string, key: string | undefined): Promise<ArtworkObjectHit | null> {
    if (!key) return null;
    const res = await fetch(
      `https://www.rijksmuseum.nl/api/en/collection?key=${key}&q=${encodeURIComponent(this.query(artistName, title))}&ps=5&format=json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      artObjects?: Array<{ title?: string; longTitle?: string; webImage?: { url?: string }; links?: { web?: string } }>;
    };
    const hit = data.artObjects?.find((o) => titleMatches(title, o.title));
    if (!hit) return null;
    return {
      source: 'rijksmuseum',
      matchedTitle: hit.title ?? title,
      sourceUrl: hit.links?.web,
      result: { dateText: hit.longTitle || undefined, imageUrl: hit.webImage?.url },
    };
  }

  private async fetchFromHarvard(artistName: string | undefined, title: string, key: string | undefined): Promise<ArtworkObjectHit | null> {
    if (!key) return null;
    const res = await fetch(
      `https://api.harvardartmuseums.org/object?apikey=${key}&keyword=${encodeURIComponent(this.query(artistName, title))}&size=5`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      records?: Array<{ title?: string; medium?: string; dimensions?: string; dated?: string; primaryimageurl?: string; url?: string }>;
    };
    const hit = data.records?.find((r) => titleMatches(title, r.title));
    if (!hit) return null;
    const dims = parseDimensions(hit.dimensions);
    return {
      source: 'harvard',
      matchedTitle: hit.title ?? title,
      sourceUrl: hit.url,
      result: {
        techniqueName: hit.medium || undefined,
        dateText: hit.dated || undefined,
        dimensionsNote: hit.dimensions || undefined,
        heightCm: dims?.heightCm,
        widthCm: dims?.widthCm,
        imageUrl: hit.primaryimageurl,
      },
    };
  }

  private async fetchFromSmithsonian(artistName: string | undefined, title: string, key: string | undefined): Promise<ArtworkObjectHit | null> {
    if (!key) return null;
    const res = await fetch(
      `https://api.si.edu/openaccess/api/v1.0/search?api_key=${key}&q=${encodeURIComponent(`"${this.query(artistName, title)}"`)}&rows=5`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      response?: {
        rows?: Array<{
          content?: {
            descriptiveNonRepeating?: { title?: { content?: string }; online_media?: { media?: Array<{ content?: string }> } };
            freetext?: { physicalDescription?: Array<{ content?: string }>; date?: Array<{ content?: string }> };
          };
        }>;
      };
    };
    const row = data.response?.rows?.find((r) => titleMatches(title, r.content?.descriptiveNonRepeating?.title?.content));
    const content = row?.content;
    if (!content) return null;
    const dimsText = content.freetext?.physicalDescription?.map((p) => p.content).find(Boolean);
    const dims = parseDimensions(dimsText);
    return {
      source: 'smithsonian',
      matchedTitle: content.descriptiveNonRepeating?.title?.content ?? title,
      sourceUrl: undefined,
      result: {
        dimensionsNote: dimsText || undefined,
        heightCm: dims?.heightCm,
        widthCm: dims?.widthCm,
        dateText: content.freetext?.date?.map((d) => d.content).find(Boolean) || undefined,
        imageUrl: content.descriptiveNonRepeating?.online_media?.media?.[0]?.content,
      },
    };
  }
}
