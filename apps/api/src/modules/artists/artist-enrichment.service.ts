import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LOCALES, Locale } from '@arterio/shared';
import type { Env } from '../../core/config/configuration';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AI_PROVIDER, type AiProvider } from '../ai/ai.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WikipediaSummary {
  title: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  content_urls?: { desktop: { page: string } };
  description?: string;
}

export interface WikidataArtist {
  qid: string;
  labels: Partial<Record<Locale, string>>;
  descriptions: Partial<Record<Locale, string>>;
  birthDate?: string;
  deathDate?: string;
  nationality?: string;
  movement?: string;
  movementQid?: string;
  /** Movement name in every supported locale — the badge UI must never fall back to English-only. */
  movementLabels?: Partial<Record<Locale, string>>;
  ulanId?: string;
  viafId?: string;
  wikipediaSitelinks: Partial<Record<string, string>>; // lang → page title
  imageUrl?: string;
  signatureUrl?: string;
  notableWorkIds?: string[];
  influencedByLabels?: string[];
}

export type FallbackSource = 'met' | 'aic' | 'europeana' | 'rijksmuseum' | 'harvard' | 'smithsonian';

/** A hit from a museum collection API — used when Wikidata has no match. */
export interface FallbackHit {
  source: FallbackSource;
  matchedName: string;
  nationality?: string;
  birthDate?: string;
  deathDate?: string;
  imageUrl?: string;
  sourceUrl?: string;
  biography?: string;
}

export interface ArtistEnrichmentResult {
  wikidata: WikidataArtist | null;
  biographies: Partial<Record<Locale, string>>; // one per language from Wikipedia
  thumbnail?: string;
  externalUrls: {
    wikipedia?: string;
    wikidata?: string;
    ulan?: string;
    viaf?: string;
  };
  /** Set only when Wikidata found nothing and a museum collection API confirmed the artist instead. */
  fallback?: FallbackHit;
  /** Wikidata's canonical label for the matched entity — should win over a manually typed name. */
  matchedName?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANG_MAP: Record<string, string> = {
  en: 'en', fr: 'fr', it: 'it', es: 'es', de: 'de', nl: 'nl',
};

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const WIKIPEDIA_REST = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** Wikidata description keywords that mean "this person is an art-world figure". */
const ART_TERMS = [
  'painter', 'sculptor', 'artist', 'photographer', 'printmaker', 'engraver',
  'draughtsman', 'illustrator', 'designer', 'architect', 'ceramicist',
  'art collector', 'art dealer', 'curator', 'muralist', 'visual artist',
  'graphic artist', 'art critic',
];

// Wikidata properties
const P_BIRTH = 'P569';
const P_DEATH = 'P570';
const P_NATIONALITY = 'P27';
const P_MOVEMENT = 'P135';
const P_ULAN = 'P245';
const P_VIAF = 'P214';
const P_IMAGE = 'P18';
const P_SIGNATURE = 'P109';
const P_INFLUENCED_BY = 'P737';
const P_NOTABLE_WORK = 'P800';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

// Each enrich() call fans out into up to ~15 outbound HTTP requests (Wikidata
// search/SPARQL/entities, Wikipedia per-locale, then the museum fallback
// chain). Artist creation triggers this fire-and-forget, so a bulk spreadsheet
// import that creates hundreds of artists in seconds used to fire hundreds of
// these chains concurrently — exhausting the container's outbound sockets and,
// because the API process shares the same fd pool, starving the actual import
// requests still in flight (they'd start failing/timing out, which surfaced to
// users as "import stops after a few rows and skips the rest"). This queue
// caps how many enrich() calls run at once; the rest wait their turn instead
// of all firing immediately.
const MAX_CONCURRENT_ENRICHMENTS = 3;
let activeEnrichments = 0;
const enrichmentQueue: Array<() => void> = [];

function acquireEnrichmentSlot(): Promise<void> {
  if (activeEnrichments < MAX_CONCURRENT_ENRICHMENTS) {
    activeEnrichments++;
    return Promise.resolve();
  }
  return new Promise((resolve) => enrichmentQueue.push(resolve));
}

function releaseEnrichmentSlot(): void {
  const next = enrichmentQueue.shift();
  if (next) next();
  else activeEnrichments--;
}

@Injectable()
export class ArtistEnrichmentService {
  private readonly logger = new Logger(ArtistEnrichmentService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
  ) {}

  /**
   * Main entry point: search Wikidata for the artist, then fetch Wikipedia bios.
   * When Wikidata has no unambiguous art-world match, falls through to a chain
   * of museum collection APIs (Met, AIC keyless; Europeana/Rijksmuseum/Harvard/
   * Smithsonian when their API keys are configured) — these are curated art
   * catalogs, so a name hit there carries far less homonym risk than a general
   * Wikidata search.
   */
  async enrich(fullName: string, organizationId?: string): Promise<ArtistEnrichmentResult> {
    await acquireEnrichmentSlot();
    try {
    const result = await this.doEnrich(fullName, organizationId);

    // If AI is enabled and provides a description, use it to fill missing biography.
    // This is a best‑effort enrichment; failures are logged but do not abort the flow.
    if (result && this.aiProvider && this.aiProvider.enabled) {
      try {
        // Prefer using the thumbnail image if available; otherwise omit imageUrl.
        const aiInput = {
          imageUrl: result.thumbnail,
          locale: 'en', // default to English for AI‑generated text
        } as const;
        const aiResult = await this.aiProvider.describe(aiInput);
        if (aiResult?.description) {
          // Merge AI‑generated description into biographies if not already present.
          if (!result.biographies['en']) {
            result.biographies['en'] = aiResult.description;
          }
        }
      } catch (e) {
        this.logger.warn(`AI enrichment failed for "${fullName}": ${String(e)}`);
      }
    }
    } finally {
      releaseEnrichmentSlot();
    }
  }

  private async doEnrich(fullName: string, organizationId?: string): Promise<ArtistEnrichmentResult> {
    const match = await this.searchWikidata(fullName);
    if (!match) {
      const fallback = await this.fetchFallbackChain(fullName, organizationId);
      return {
        wikidata: null,
        // 'web' is the only fallback source that yields actual bio text —
        // museum APIs only confirm identity (name/dates/nationality).
        biographies: fallback?.biography ? { en: fallback.biography } : {},
        thumbnail: fallback?.imageUrl,
        externalUrls: {},
        fallback: fallback ?? undefined,
      };
    }
    const { qid, matchedName } = match;
    // Fetch the Wikidata entity FIRST so its per-language sitelinks (exact page
    // titles tied to this specific QID) are available before touching Wikipedia.
    // Searching Wikipedia by name independently — the previous approach — can
    // land on a different, more-famous person who shares the name (e.g. a local
    // painter named "Carrey Georges" resolving to actor Jim Carrey's page).
    const wikidata = await this.fetchWikidataEntity(qid);
    const biographies = await this.fetchWikipediaBiographies(wikidata?.wikipediaSitelinks ?? {});

    const thumbnail =
      biographies['en']?.thumbnail ??
      Object.values(biographies).find((b) => b?.thumbnail)?.thumbnail;

    return {
      wikidata,
      matchedName,
      biographies: Object.fromEntries(
        Object.entries(biographies)
          .filter(([, v]) => v?.extract)
          .map(([lang, v]) => [lang, v!.extract]),
      ) as Partial<Record<Locale, string>>,
      thumbnail,
      externalUrls: {
        wikipedia: biographies['en']?.url,
        wikidata: `https://www.wikidata.org/wiki/${qid}`,
        ulan: wikidata?.ulanId
          ? `https://vocab.getty.edu/ulan/${wikidata.ulanId}`
          : undefined,
        viaf: wikidata?.viafId
          ? `https://viaf.org/viaf/${wikidata.viafId}`
          : undefined,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Wikidata search — find the QID for an artist name
  // ---------------------------------------------------------------------------

  /**
   * Finds the Wikidata QID for an artist by name — but only ever returns a
   * candidate whose Wikidata description identifies them as an art-world
   * figure. Many artist names collide with athletes, politicians, etc.
   * (homonyms); rather than guessing and attaching a stranger's biography,
   * we return null so the caller can surface "not found" and let a human
   * fix the spelling and retry.
   *
   * Inventory data is often stored "LASTNAME Firstname" while Wikidata's
   * search index is word-order sensitive and expects "Firstname Lastname"
   * — so a reversed two-token name is tried as a fallback before giving up.
   */
  private async searchWikidata(name: string): Promise<{ qid: string; matchedName: string } | null> {
    const direct = await this.searchWikidataOnce(name);
    if (direct) return { qid: direct.qid, matchedName: name };

    const tokens = name.trim().split(/\s+/);
    if (tokens.length === 2) {
      const reversed = `${tokens[1]} ${tokens[0]}`;
      const swapped = await this.searchWikidataOnce(reversed);
      if (swapped) return { qid: swapped.qid, matchedName: reversed };
    }
    return null;
  }

  /**
   * Public, lightweight art-world lookup used by artist de-duplication: tells
   * the caller whether a name resolves to exactly one unambiguous art figure
   * (safe to auto-merge variants under), to more than one distinct person
   * (ambiguous — different homonyms, never auto-merge), or to none at all
   * (no online corroboration — merge decision falls back to name similarity alone).
   */
  async checkArtMatch(name: string): Promise<{
    qid: string;
    label: string;
    matchedName: string;
    exact: boolean;
    ambiguous: boolean;
  } | null> {
    const direct = await this.searchWikidataOnce(name);
    if (direct) return { ...direct, matchedName: name };

    const tokens = name.trim().split(/\s+/);
    if (tokens.length === 2) {
      const reversed = `${tokens[1]} ${tokens[0]}`;
      const swapped = await this.searchWikidataOnce(reversed);
      if (swapped) return { ...swapped, matchedName: reversed };
    }
    return null;
  }

  private async searchWikidataOnce(
    name: string,
  ): Promise<{ qid: string; label: string; exact: boolean; ambiguous: boolean } | null> {
    const url =
      `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
      `&search=${encodeURIComponent(name)}&language=en&limit=8&format=json&type=item&origin=*`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        search: Array<{ id: string; description?: string; label: string }>;
      };

      const artCandidates = data.search.filter((r) =>
        ART_TERMS.some((t) => r.description?.toLowerCase().includes(t)),
      );
      if (!artCandidates.length) {
        this.logger.warn(`No art-related Wikidata match for "${name}" — skipping to avoid a homonym mismatch.`);
        return null;
      }

      const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const exactMatch = artCandidates.find((r) => normalize(r.label) === normalize(name));
      // Ambiguous: several *distinct* art-world people share this name, and the
      // query didn't land exactly on one of their labels — too risky to pick one.
      const distinctQids = new Set(artCandidates.map((c) => c.id));
      const ambiguous = !exactMatch && distinctQids.size > 1;
      const chosen = exactMatch ?? artCandidates[0]!;
      return { qid: chosen.id, label: chosen.label, exact: Boolean(exactMatch), ambiguous };
    } catch (err) {
      this.logger.warn(`Wikidata search failed for "${name}": ${String(err)}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Wikidata SPARQL — structured artist data
  // ---------------------------------------------------------------------------

  private async fetchWikidataEntity(qid: string): Promise<WikidataArtist | null> {
    const langs = Object.keys(LANG_MAP).join('|');
    // Two separate queries on purpose: mixing GROUP_CONCAT (for the list fields
    // below) with single-valued OPTIONAL joins under one GROUP BY caused a
    // cartesian blow-up whenever an artist had >1 notable work — SPARQL then
    // grouped into several rows and LIMIT 1 picked one arbitrarily, so
    // nationality/movement randomly came back unbound (silently falling back
    // to the raw QID, e.g. "Q31" instead of "Belgium"). Splitting removes the
    // aggregation entirely from the scalar-field query, making it deterministic.
    const scalarSparql = `
SELECT ?birthDate ?deathDate ?nationalityLabel ?movementLabel ?movement ?ulanId ?viafId ?image ?signature
WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item wdt:${P_BIRTH} ?birthDate }
  OPTIONAL { ?item wdt:${P_DEATH} ?deathDate }
  OPTIONAL { ?item wdt:${P_NATIONALITY} ?nationality . ?nationality rdfs:label ?nationalityLabel FILTER(LANG(?nationalityLabel) = "en") }
  OPTIONAL { ?item wdt:${P_MOVEMENT} ?movement . ?movement rdfs:label ?movementLabel FILTER(LANG(?movementLabel) = "en") }
  OPTIONAL { ?item wdt:${P_ULAN} ?ulanId }
  OPTIONAL { ?item wdt:${P_VIAF} ?viafId }
  OPTIONAL { ?item wdt:${P_IMAGE} ?image }
  OPTIONAL { ?item wdt:${P_SIGNATURE} ?signature }
}
LIMIT 1
`.trim();

    const listsSparql = `
SELECT
  (GROUP_CONCAT(DISTINCT ?influencedLabel; separator="|") AS ?influenced)
  (GROUP_CONCAT(DISTINCT ?notableWork; separator="|") AS ?notableWorks)
WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item wdt:${P_INFLUENCED_BY} ?influenced_item . ?influenced_item rdfs:label ?influencedLabel FILTER(LANG(?influencedLabel) = "en") }
  OPTIONAL { ?item wdt:${P_NOTABLE_WORK} ?notableWork_item . ?notableWork_item rdfs:label ?notableWork FILTER(LANG(?notableWork) = "en") }
}
`.trim();

    // Also fetch labels/descriptions separately (simpler)
    const entityUrl =
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}` +
      `&languages=${encodeURIComponent(langs)}&props=labels|descriptions|sitelinks&format=json&origin=*`;

    try {
      const [scalarRes, listsRes, entityRes] = await Promise.all([
        fetch(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(scalarSparql)}&format=json`, {
          headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'Arterio/1.0' },
          signal: AbortSignal.timeout(8_000),
        }),
        fetch(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(listsSparql)}&format=json`, {
          headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'Arterio/1.0' },
          signal: AbortSignal.timeout(8_000),
        }),
        fetch(entityUrl, { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(8_000) }),
      ]);

      const scalarData = scalarRes.ok
        ? ((await scalarRes.json()) as { results: { bindings: Record<string, { value: string }>[] } })
        : null;
      const listsData = listsRes.ok
        ? ((await listsRes.json()) as { results: { bindings: Record<string, { value: string }>[] } })
        : null;
      const entityData = entityRes.ok
        ? ((await entityRes.json()) as { entities: Record<string, { labels: Record<string, { value: string }>; descriptions: Record<string, { value: string }>; sitelinks: Record<string, { title: string }> }> })
        : null;

      const binding = {
        ...(scalarData?.results.bindings[0] ?? {}),
        ...(listsData?.results.bindings[0] ?? {}),
      };
      const entity = entityData?.entities[qid];
      const movementQid = binding['movement']?.value?.split('/').pop();
      const movementLabels = movementQid ? await this.fetchEntityLabels(movementQid, langs) : {};

      const labels: Partial<Record<Locale, string>> = {};
      const descriptions: Partial<Record<Locale, string>> = {};
      const sitelinks: Record<string, string> = {};

      if (entity) {
        for (const [lang] of Object.entries(LANG_MAP)) {
          if (entity.labels[lang]) labels[lang as Locale] = entity.labels[lang].value;
          if (entity.descriptions[lang]) descriptions[lang as Locale] = entity.descriptions[lang].value;
        }
        for (const [key, sl] of Object.entries(entity.sitelinks ?? {})) {
          const langMatch = key.match(/^(\w+)wiki$/);
          if (langMatch) sitelinks[langMatch[1]!] = sl.title;
        }
      }

      const formatDate = (v: string | undefined) =>
        v ? v.replace('T00:00:00Z', '').replace(/^\+/, '') : undefined;

      const wikimediaImage = (url: string | undefined) =>
        url?.startsWith('http') ? url : undefined;

      return {
        qid,
        labels,
        descriptions,
        birthDate: formatDate(binding[P_BIRTH]?.value ?? binding['birthDate']?.value),
        deathDate: formatDate(binding[P_DEATH]?.value ?? binding['deathDate']?.value),
        nationality: binding['nationalityLabel']?.value,
        movement: binding['movementLabel']?.value,
        movementQid,
        movementLabels,
        ulanId: binding['ulanId']?.value,
        viafId: binding['viafId']?.value,
        imageUrl: wikimediaImage(binding['image']?.value),
        signatureUrl: wikimediaImage(binding['signature']?.value),
        notableWorkIds: binding['notableWorks']?.value?.split('|').filter(Boolean),
        influencedByLabels: binding['influenced']?.value?.split('|').filter(Boolean),
        wikipediaSitelinks: sitelinks,
      };
    } catch (err) {
      this.logger.warn(`Wikidata entity fetch failed for ${qid}: ${String(err)}`);
      return null;
    }
  }

  /** Fetches an entity's label in every supported locale (used for the movement record). */
  private async fetchEntityLabels(qid: string, langs: string): Promise<Partial<Record<Locale, string>>> {
    try {
      const res = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&languages=${encodeURIComponent(langs)}&props=labels&format=json&origin=*`,
        { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) return {};
      const data = (await res.json()) as { entities?: Record<string, { labels?: Record<string, { value: string }> }> };
      const entityLabels = data.entities?.[qid]?.labels ?? {};
      const result: Partial<Record<Locale, string>> = {};
      for (const lang of Object.keys(LANG_MAP)) {
        if (entityLabels[lang]) result[lang as Locale] = entityLabels[lang].value;
      }
      return result;
    } catch {
      return {};
    }
  }

  // ---------------------------------------------------------------------------
  // Wikipedia REST API — biographical text per language
  // ---------------------------------------------------------------------------

  private async fetchWikipediaBiographies(
    sitelinks: Partial<Record<string, string>>,
  ): Promise<Partial<Record<string, { extract: string; thumbnail?: string; url?: string }>>> {
    // Only ever fetch the EXACT page tied to this Wikidata QID via its sitelinks.
    // The previous approach did a fresh fuzzy name search per language, which
    // could land on a different, more-famous person who shares the name (e.g. a
    // local painter "Carrey Georges" resolving to actor Jim Carrey's article) —
    // since the QID was already verified art-related, only this exact page may
    // be used; a language with no sitelink simply gets no biography rather than
    // risking a mismatched one.
    const results: Partial<Record<string, { extract: string; thumbnail?: string; url?: string }>> = {};

    await Promise.allSettled(
      Object.keys(LANG_MAP).map(async (lang) => {
        const pageTitle = sitelinks[lang];
        if (!pageTitle) return;
        try {
          const summaryRes = await fetch(WIKIPEDIA_REST(lang, pageTitle), {
            headers: { 'User-Agent': 'Arterio/1.0' },
            signal: AbortSignal.timeout(8_000),
          });
          if (!summaryRes.ok) return;
          const summary = (await summaryRes.json()) as WikipediaSummary;
          if (!summary.extract) return;

          results[lang] = {
            extract: summary.extract,
            thumbnail: summary.thumbnail?.source,
            url: summary.content_urls?.desktop.page,
          };
        } catch {
          // silently skip — enrichment is best-effort
        }
      }),
    );

    return results;
  }

  // ---------------------------------------------------------------------------
  // Fallback museum collection APIs — tried in order, first hit wins
  // ---------------------------------------------------------------------------

  private async fetchFallbackChain(name: string, organizationId?: string): Promise<FallbackHit | null> {
    const keys = await this.resolveSourceKeys(organizationId);
    const providers: Array<() => Promise<FallbackHit | null>> = [
      () => this.fetchFromAic(name),
      () => this.fetchFromMet(name),
      () => this.fetchFromEuropeana(name, keys.europeana),
      () => this.fetchFromRijksmuseum(name, keys.rijksmuseum),
      () => this.fetchFromHarvard(name, keys.harvard),
      () => this.fetchFromSmithsonian(name, keys.smithsonian),
    ];
    for (const provider of providers) {
      try {
        const hit = await provider();
        if (hit) return hit;
      } catch (err) {
        this.logger.warn(`Fallback provider failed for "${name}": ${String(err)}`);
      }
    }
    return null;
  }

  /** Org-configured keys (set via Settings → API externes) take priority over env vars. */
  private async resolveSourceKeys(
    organizationId?: string,
  ): Promise<Record<'europeana' | 'rijksmuseum' | 'harvard' | 'smithsonian', string | undefined>> {
    const envKeys = {
      europeana: this.config.get('EUROPEANA_API_KEY', { infer: true }),
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
        europeana: decrypt(stored.europeana) ?? envKeys.europeana,
        rijksmuseum: decrypt(stored.rijksmuseum) ?? envKeys.rijksmuseum,
        harvard: decrypt(stored.harvard) ?? envKeys.harvard,
        smithsonian: decrypt(stored.smithsonian) ?? envKeys.smithsonian,
      };
    } catch {
      return envKeys;
    }
  }

  private normalizeForMatch(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  /**
   * True only if every significant token of `name` appears somewhere in
   * `candidate`. Checking just one token (e.g. a shared surname) is how an
   * obscure local painter "Carrey Georges" ended up resolving to the actor
   * Jim Carrey — both contain "Carrey", a single-token check can't tell them
   * apart. Requiring every token rejects that kind of partial-name collision.
   */
  private matchesAllTokens(name: string, candidate: string): boolean {
    const candidateNorm = this.normalizeForMatch(candidate);
    const tokens = this.normalizeForMatch(name).split(/\s+/).filter((t) => t.length > 1);
    if (!tokens.length) return false;
    return tokens.every((t) => candidateNorm.includes(t));
  }

  /** Art Institute of Chicago — dedicated, keyless artist-record search. */
  private async fetchFromAic(name: string): Promise<FallbackHit | null> {
    const searchRes = await fetch(
      `https://api.artic.edu/api/v1/artists/search?q=${encodeURIComponent(name)}&limit=3`,
      { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(8_000) },
    );
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as { data?: Array<{ id: number; title: string }> };
    const hit = searchData.data?.find((d) => this.normalizeForMatch(d.title) === this.normalizeForMatch(name));
    if (!hit) return null;

    const detailRes = await fetch(
      `https://api.artic.edu/api/v1/artists/${hit.id}?fields=id,title,birth_date,death_date`,
      { headers: { 'User-Agent': 'Arterio/1.0' }, signal: AbortSignal.timeout(8_000) },
    );
    if (!detailRes.ok) return null;
    const detail = ((await detailRes.json()) as { data?: { title: string; birth_date?: number; death_date?: number } }).data;
    if (!detail) return null;

    return {
      source: 'aic',
      matchedName: detail.title,
      birthDate: detail.birth_date ? String(detail.birth_date) : undefined,
      deathDate: detail.death_date ? String(detail.death_date) : undefined,
      sourceUrl: `https://www.artic.edu/artists/${hit.id}`,
    };
  }

  /** Metropolitan Museum of Art — keyless; matches the artist field on a held object. */
  private async fetchFromMet(name: string): Promise<FallbackHit | null> {
    const searchRes = await fetch(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(name)}&hasImages=true`,
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
        artistDisplayName?: string;
        artistNationality?: string;
        artistBeginDate?: string;
        artistEndDate?: string;
        primaryImageSmall?: string;
        primaryImage?: string;
        objectURL?: string;
      };
      if (!obj.artistDisplayName) continue;
      if (!this.matchesAllTokens(name, obj.artistDisplayName)) continue;

      return {
        source: 'met',
        matchedName: obj.artistDisplayName,
        nationality: obj.artistNationality || undefined,
        birthDate: obj.artistBeginDate || undefined,
        deathDate: obj.artistEndDate || undefined,
        imageUrl: obj.primaryImageSmall || obj.primaryImage || undefined,
        sourceUrl: obj.objectURL,
      };
    }
    return null;
  }

  /** Europeana — 50M+ objects aggregated from European institutions. Requires a free API key. */
  private async fetchFromEuropeana(name: string, key: string | undefined): Promise<FallbackHit | null> {
    if (!key) return null;
    const res = await fetch(
      `https://api.europeana.eu/record/v2/search.json?wskey=${key}&query=who%3A%22${encodeURIComponent(name)}%22&rows=5`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ edmAgentLabel?: Array<{ def?: string[] }>; edmIsShownBy?: string[]; guid?: string }> };
    const item = data.items?.find((i) => this.matchesAllTokens(name, i.edmAgentLabel?.[0]?.def?.[0] ?? ''));
    if (!item) return null;
    return {
      source: 'europeana',
      matchedName: item.edmAgentLabel?.[0]?.def?.[0] ?? name,
      imageUrl: item.edmIsShownBy?.[0],
      sourceUrl: item.guid,
    };
  }

  /** Rijksmuseum — strong for European painters. Requires a free API key. */
  private async fetchFromRijksmuseum(name: string, key: string | undefined): Promise<FallbackHit | null> {
    if (!key) return null;
    const res = await fetch(
      `https://www.rijksmuseum.nl/api/en/collection?key=${key}&involvedMaker=${encodeURIComponent(name)}&ps=5&format=json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { artObjects?: Array<{ principalOrFirstMaker?: string; webImage?: { url?: string }; links?: { web?: string } }> };
    const item = data.artObjects?.find((o) => this.matchesAllTokens(name, o.principalOrFirstMaker ?? ''));
    if (!item) return null;
    return {
      source: 'rijksmuseum',
      matchedName: item.principalOrFirstMaker ?? name,
      imageUrl: item.webImage?.url,
      sourceUrl: item.links?.web,
    };
  }

  /** Harvard Art Museums — rich metadata incl. artist display dates. Requires a free API key. */
  private async fetchFromHarvard(name: string, key: string | undefined): Promise<FallbackHit | null> {
    if (!key) return null;
    const res = await fetch(
      `https://api.harvardartmuseums.org/object?apikey=${key}&person=${encodeURIComponent(name)}&size=5`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      records?: Array<{ primaryimageurl?: string; url?: string; people?: Array<{ displayname?: string; displaydate?: string }> }>;
    };
    const record = data.records?.find((r) => r.people?.some((p) => this.matchesAllTokens(name, p.displayname ?? '')));
    const person = record?.people?.find((p) => this.matchesAllTokens(name, p.displayname ?? ''));
    if (!record || !person) return null;
    const [birthDate, deathDate] = (person.displaydate ?? '').split(/[-–]/).map((s) => s.trim());
    return {
      source: 'harvard',
      matchedName: person.displayname ?? name,
      birthDate: birthDate || undefined,
      deathDate: deathDate || undefined,
      imageUrl: record.primaryimageurl,
      sourceUrl: record.url,
    };
  }

  /** Smithsonian Open Access — millions of objects across 19 museums. Requires a free API key. */
  private async fetchFromSmithsonian(name: string, key: string | undefined): Promise<FallbackHit | null> {
    if (!key) return null;
    const res = await fetch(
      `https://api.si.edu/openaccess/api/v1.0/search?api_key=${key}&q=${encodeURIComponent(`"${name}"`)}&rows=5`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      response?: { rows?: Array<{ content?: { descriptiveNonRepeating?: { title?: { content?: string }; online_media?: { media?: Array<{ content?: string }> } }; indexedStructured?: { name?: string[] } } }> };
    };
    const row = data.response?.rows?.find((r) =>
      r.content?.indexedStructured?.name?.some((n) => this.matchesAllTokens(name, n)),
    );
    const content = row?.content?.descriptiveNonRepeating;
    if (!content) return null;
    return {
      source: 'smithsonian',
      matchedName: row?.content?.indexedStructured?.name?.[0] ?? name,
      imageUrl: content.online_media?.media?.[0]?.content,
      sourceUrl: content.title?.content,
    };
  }

}
