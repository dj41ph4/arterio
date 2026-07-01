import { BadRequestException, Body, Controller, Delete, Get, Inject, Logger, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Locale } from '@arterio/shared';
import { AI_PROVIDER, type AiProvider, type AiAttemptLog } from './ai.types';
import { AiProviderChain } from './ai-provider-chain';
import { searchCommonsImage, searchCommonsImages } from '../../common/commons-image-search.util';
import { searchWikiArtImage, searchWikiArtImages } from '../../common/wikiart-api.util';
import { searchArtsyImage, searchArtsyImages } from '../../common/artsy-api.util';
import { isLikelyRealImage } from '../../common/download-image.util';
import { buildSearchContext, buildArtworkSearchContext, buildArtistSearchContext } from '../../common/free-web-search.util';
import { StructuredLookupService } from './structured-lookup.service';
import { AiDebugLogService } from './ai-debug-log.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import type { AuthUser } from '../../common/types';

/** Lets the frontend show/hide "AI autocomplete" buttons without duplicating the enabled-check logic. */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly structuredLookup: StructuredLookupService,
    private readonly debugLog: AiDebugLogService,
  ) {
    this.logger.log(`AiController initialisé — debugLog injecté: ${!!debugLog}`);
  }

  /**
   * Coalesces identical concurrent calls into a single underlying AI call —
   * a double-click, a re-render firing the same effect twice, or two browser
   * tabs hitting the same query at once would otherwise each spend their own
   * Gemini/OpenRouter call for an identical question. Every caller awaits
   * the exact same promise, so the result is byte-identical to not deduping
   * at all — this only ever removes a wasted duplicate request, never
   * changes what's returned.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = fn().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Best-effort usage tracking — one row per model attempt, never lets a logging failure break the actual AI feature. */
  private logUsage(organizationId: string, operation: string, attempts: AiAttemptLog[]): void {
    if (!attempts.length) return;
    this.prisma.aiUsageLog
      .createMany({
        data: attempts.map((a) => ({
          organizationId,
          operation,
          provider: a.provider ?? this.ai.id,
          model: a.model,
          success: a.success,
        })),
      })
      .catch((e) => this.logger.warn(`Échec de l'enregistrement de l'usage IA : ${String(e)}`));
  }

  @Get('usage')
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: "Aggregated AI call volume for this org's Settings → AI usage panel" })
  async usage(@CurrentUser() user: AuthUser) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.aiUsageLog.findMany({
      where: { organizationId: user.organizationId, createdAt: { gte: since } },
      select: { operation: true, model: true, success: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const total = rows.length;
    const byDay = new Map<string, number>();
    const byOperation = new Map<string, number>();
    const byModel = new Map<string, number>();
    let failures = 0;
    for (const r of rows) {
      const day = r.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      byOperation.set(r.operation, (byOperation.get(r.operation) ?? 0) + 1);
      byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
      if (!r.success) failures++;
    }
    return {
      total,
      failures,
      last30Days: Array.from(byDay.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
      byOperation: Array.from(byOperation.entries()).map(([operation, count]) => ({ operation, count })),
      byModel: Array.from(byModel.entries()).map(([model, count]) => ({ model, count })),
    };
  }

  /** Decrypted optional API keys for the third-party image sources, read once per call. */
  private async resolveImageSourceKeys(organizationId: string): Promise<{ wikiartKey?: string; artsyKey?: string }> {
    try {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      const ai = (org?.settings as Record<string, unknown>)?.ai as
        | { wikiartApiKeyEnc?: string; artsyApiKeyEnc?: string }
        | undefined;
      return {
        wikiartKey: ai?.wikiartApiKeyEnc ? this.crypto.decrypt(ai.wikiartApiKeyEnc) : undefined,
        artsyKey: ai?.artsyApiKeyEnc ? this.crypto.decrypt(ai.artsyApiKeyEnc) : undefined,
      };
    } catch {
      return {};
    }
  }

  /**
   * WikiArt (with a registered key) takes priority — it's a curated art-only
   * index, so a hit is higher-confidence than a general Commons search.
   * Falls through to Commons, then Artsy (another curated art-world index,
   * if a key is configured), and finally — now that autofill runs with a
   * real OpenRouter web search behind it instead of pure model memory — to
   * whatever imageUrl the AI itself found in a search result, but only once
   * that URL is verified (HEAD-checked) to actually resolve to a real image.
   * An unverified AI guess is worse than no photo at all, so it's never
   * trusted without that check.
   */
  private async findPhoto(
    query: string,
    organizationId: string,
    aiGuessedUrl?: string,
  ): Promise<{ url: string | null; source: 'wikiart' | 'commons' | 'artsy' | 'ai-search' | null }> {
    try {
      const { wikiartKey, artsyKey } = await this.resolveImageSourceKeys(organizationId);

      if (wikiartKey) {
        const fromWikiArt = await searchWikiArtImage(wikiartKey, query);
        if (fromWikiArt) return { url: fromWikiArt, source: 'wikiart' };
      }
      const fromCommons = await searchCommonsImage(query);
      if (fromCommons) return { url: fromCommons, source: 'commons' };

      if (artsyKey) {
        const fromArtsy = await searchArtsyImage(artsyKey, query);
        if (fromArtsy) return { url: fromArtsy, source: 'artsy' };
      }

      if (aiGuessedUrl && (await isLikelyRealImage(aiGuessedUrl))) {
        return { url: aiGuessedUrl, source: 'ai-search' };
      }
      return { url: null, source: null };
    } catch (err) {
      this.logger.warn(`findPhoto — échec inattendu pour "${query}": ${String(err)}`);
      return { url: null, source: null };
    }
  }

  /**
   * The "Wiki" image-search button — WikiArt (if a key is configured) and
   * Wikimedia Commons, combined and de-duplicated, no AI/LLM call involved
   * at all. Deliberately separate from findPhoto() above (which only ever
   * needs the single best hit for autofill) since this one is about
   * surfacing as many real candidates as possible for the user to pick from.
   */
  private async findWikiImages(
    query: string,
    organizationId: string,
    limit = 8,
  ): Promise<{ images: string[]; wikiartCount: number; artsyCount: number }> {
    const { wikiartKey, artsyKey } = await this.resolveImageSourceKeys(organizationId);
    const fromWikiArt = wikiartKey ? await searchWikiArtImages(wikiartKey, query, limit) : [];
    const fromCommons = await searchCommonsImages(query, limit);
    const fromArtsy = artsyKey ? await searchArtsyImages(artsyKey, query, limit) : [];
    const seen = new Set<string>();
    const images = [...fromWikiArt, ...fromCommons, ...fromArtsy].filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    }).slice(0, limit);
    return { images, wikiartCount: fromWikiArt.length, artsyCount: fromArtsy.length };
  }

  /** Builds the "(dont N via WikiArt, M via Artsy)" suffix for the Wiki image-search messages. */
  private describeSourceBreakdown(wikiartCount: number, artsyCount: number): string {
    const parts = [];
    if (wikiartCount) parts.push(`${wikiartCount} via WikiArt`);
    if (artsyCount) parts.push(`${artsyCount} via Artsy`);
    return parts.length ? ` (dont ${parts.join(', ')})` : ' via Wikimedia Commons';
  }

  @Post('images/artwork')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'Find multiple candidate photos for an artwork via WikiArt/Artsy/Wikimedia Commons (no AI call)' })
  async findArtworkImages(@CurrentUser() user: AuthUser, @Body() body: { title?: string; artistName?: string }) {
    const query = `${body.artistName ?? ''} ${body.title ?? ''}`.trim();
    if (!query) throw new BadRequestException('title or artistName is required');
    const { images, wikiartCount, artsyCount } = await this.findWikiImages(query, user.organizationId);
    const message = images.length
      ? `${images.length} image${images.length > 1 ? 's' : ''} trouvée${images.length > 1 ? 's' : ''}${this.describeSourceBreakdown(wikiartCount, artsyCount)}.`
      : 'Aucune image trouvée via WikiArt/Artsy/Wikimedia Commons pour ce titre/artiste.';
    this.logger.log(`Recherche Wiki d'images pour une œuvre — "${query}" — ${message}`);
    return { images, message };
  }

  @Post('images/artwork/ai')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'Find multiple candidate photos for an artwork via AI-grounded web search' })
  async findArtworkImagesAi(@CurrentUser() user: AuthUser, @Body() body: { title?: string; artistName?: string }) {
    if (!(await this.ai.isEnabled(user.organizationId))) {
      const message = 'IA désactivée ou non configurée pour cette organisation (Réglages → IA).';
      throw new ServiceUnavailableException(message);
    }
    const query = `${body.artistName ?? ''} ${body.title ?? ''}`.trim();
    if (!query) throw new BadRequestException('title or artistName is required');
    const searchContext = await buildSearchContext(`${query} photo painting image`);
    const { data, meta } = await this.dedupe(`findImages.artwork:${user.organizationId}:${query}`, () =>
      this.ai.findImages({
        query: `Search query to run: ${body.artistName ?? ''} "${body.title ?? ''}" photo painting image`.trim(),
        organizationId: user.organizationId,
        searchContext: searchContext ?? undefined,
      }),
    );
    const candidates = data.imageUrls ?? [];
    const validated = (await Promise.all(candidates.map(async (u) => ((await isLikelyRealImage(u)) ? u : null)))).filter(
      (u): u is string => Boolean(u),
    );
    const message =
      validated.length > 0
        ? `${meta.message} ${validated.length} image${validated.length > 1 ? 's' : ''} réelle${validated.length > 1 ? 's' : ''} vérifiée${validated.length > 1 ? 's' : ''} sur ${candidates.length} proposée${candidates.length > 1 ? 's' : ''} par l'IA.`
        : candidates.length > 0
          ? `${meta.message} Les ${candidates.length} URL proposée${candidates.length > 1 ? 's' : ''} par l'IA n'ont pas pu être vérifiées (lien mort ou pas une image) — aucune retenue.`
          : meta.message;
    this.logger.log(message);
    this.logUsage(user.organizationId, 'findImages.artwork', meta.attempts);
    return { images: validated, message };
  }

  @Post('images/artist')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'Find multiple candidate portraits for an artist via WikiArt/Artsy/Wikimedia Commons (no AI call)' })
  async findArtistImages(@CurrentUser() user: AuthUser, @Body() body: { fullName: string }) {
    if (!body.fullName?.trim()) throw new BadRequestException('fullName is required');
    const { images, wikiartCount, artsyCount } = await this.findWikiImages(`${body.fullName} portrait`, user.organizationId);
    const message = images.length
      ? `${images.length} portrait${images.length > 1 ? 's' : ''} trouvé${images.length > 1 ? 's' : ''}${this.describeSourceBreakdown(wikiartCount, artsyCount)}.`
      : 'Aucun portrait trouvé via WikiArt/Artsy/Wikimedia Commons pour ce nom.';
    this.logger.log(`Recherche Wiki de portraits — "${body.fullName}" — ${message}`);
    return { images, message };
  }

  @Post('images/artist/ai')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'Find multiple candidate portraits for an artist via AI-grounded web search' })
  async findArtistImagesAi(@CurrentUser() user: AuthUser, @Body() body: { fullName: string }) {
    if (!(await this.ai.isEnabled(user.organizationId))) {
      const message = 'IA désactivée ou non configurée pour cette organisation (Réglages → IA).';
      throw new ServiceUnavailableException(message);
    }
    if (!body.fullName?.trim()) throw new BadRequestException('fullName is required');
    const searchContext = await buildSearchContext(`${body.fullName} portrait photo`);
    const { data, meta } = await this.dedupe(`findImages.artist:${user.organizationId}:${body.fullName}`, () =>
      this.ai.findImages({
        query: `Search query to run: ${body.fullName} portrait photo`,
        organizationId: user.organizationId,
        searchContext: searchContext ?? undefined,
      }),
    );
    const candidates = data.imageUrls ?? [];
    const validated = (await Promise.all(candidates.map(async (u) => ((await isLikelyRealImage(u)) ? u : null)))).filter(
      (u): u is string => Boolean(u),
    );
    const message =
      validated.length > 0
        ? `${meta.message} ${validated.length} portrait${validated.length > 1 ? 's' : ''} vérifié${validated.length > 1 ? 's' : ''} sur ${candidates.length} proposé${candidates.length > 1 ? 's' : ''} par l'IA.`
        : candidates.length > 0
          ? `${meta.message} Les ${candidates.length} URL proposée${candidates.length > 1 ? 's' : ''} par l'IA n'ont pas pu être vérifiées — aucune retenue.`
          : meta.message;
    this.logger.log(message);
    this.logUsage(user.organizationId, 'findImages.artist', meta.attempts);
    return { images: validated, message };
  }

  /** Settings → AI "Tester la connexion" — exactly one minimal request to the chosen provider, bypassing the fallback chain, so the result reflects the key just typed in rather than whichever provider happens to win normal usage. */
  @Post('test')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Test a single AI provider with exactly one minimal request' })
  async testProvider(@CurrentUser() user: AuthUser, @Body() body: { provider: 'openrouter' | 'gemini' | 'mistral' }) {
    if (!body.provider) throw new BadRequestException('provider is required');
    if (!(this.ai instanceof AiProviderChain)) {
      throw new ServiceUnavailableException('Le test de connexion nécessite la chaîne de fournisseurs IA standard.');
    }
    const result = await this.ai.testProvider(body.provider, user.organizationId);
    this.logger.log(`Test de connexion IA — ${body.provider} — ${result.success ? 'succès' : 'échec'} : ${result.message}`);
    return result;
  }

  @Post('autofill/artwork')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'AI-suggested artwork fields from title + artist name (OpenRouter-backed, real photo via Wikimedia Commons)' })
  async autofillArtwork(
    @CurrentUser() user: AuthUser,
    @Body() body: { title?: string; artistName?: string; locale?: Locale },
  ) {
    this.logger.log(`Clic "IA" reçu pour une œuvre — titre="${body.title ?? ''}", artiste="${body.artistName ?? ''}"`);
    if (!(await this.ai.isEnabled(user.organizationId))) {
      const message = "IA désactivée ou non configurée pour cette organisation (Réglages → IA).";
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }
    const dedupeKey = `autofillArtwork:${user.organizationId}:${body.title ?? ''}:${body.artistName ?? ''}:${body.locale ?? 'en'}`;
    const { data, meta, searchContext } = await this.dedupe(dedupeKey, () =>
      this.runArtworkAutofillCore(
        user.organizationId,
        body.title ?? '',
        body.artistName ?? '',
        body.locale ?? 'en',
      ),
    );
    const aiGuessedUrl = data.imageUrl;
    if (body.title) {
      const { url, source } = await this.findPhoto(`${body.artistName ?? ''} ${body.title}`.trim(), user.organizationId, aiGuessedUrl);
      data.imageUrl = url ?? undefined;
      if (source === 'wikiart') meta.message += ' Photo réelle trouvée via WikiArt.';
      else if (source === 'commons') meta.message += ' Photo réelle trouvée via Wikimedia Commons.';
      else if (source === 'artsy') meta.message += ' Photo réelle trouvée via Artsy.';
      else if (source === 'ai-search') meta.message += " Photo trouvée par l'IA via recherche web et vérifiée.";
      else meta.message += ' Aucune photo trouvée.';
      // Patch imageSource on the debug log entry that runArtworkAutofillCore just pushed
      const latest = this.debugLog.getAll()[0];
      if (latest?.op === 'autofill_artwork') latest.imageSource = source;
    }
    this.logger.log(meta.message);
    return { data, meta };
  }

  @Post('autofill/artist')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'AI-suggested artist bio/dates/nationality from a full name (OpenRouter-backed)' })
  async autofillArtist(@CurrentUser() user: AuthUser, @Body() body: { fullName: string; locale?: Locale }) {
    this.logger.log(`Clic "IA" reçu pour un artiste — nom="${body.fullName}"`);
    if (!(await this.ai.isEnabled(user.organizationId))) {
      const message = "IA désactivée ou non configurée pour cette organisation (Réglages → IA).";
      this.logger.warn(message);
      throw new ServiceUnavailableException(message);
    }
    const t0 = Date.now();
    const searchContext = await buildArtistSearchContext(body.fullName);
    const sharedArtist = await this.dedupe(`autofillArtist:${user.organizationId}:${body.fullName}:${body.locale ?? 'en'}`, () =>
      this.ai.autofillArtist({
        fullName: body.fullName,
        locale: body.locale ?? 'en',
        organizationId: user.organizationId,
        searchContext: searchContext ?? undefined,
      }),
    );
    const data = { ...sharedArtist.data };
    const meta = { ...sharedArtist.meta, attempts: [...sharedArtist.meta.attempts] };
    const aiGuessedUrl = data.imageUrl;
    const { url, source } = await this.findPhoto(`${body.fullName} portrait`, user.organizationId, aiGuessedUrl);
    data.imageUrl = url ?? undefined;
    if (source === 'wikiart') meta.message += ' Portrait trouvé via WikiArt.';
    else if (source === 'commons') meta.message += ' Portrait trouvé via Wikimedia Commons.';
    else if (source === 'artsy') meta.message += ' Portrait trouvé via Artsy.';
    else if (source === 'ai-search') meta.message += " Portrait trouvé par l'IA via recherche web et vérifié.";
    else meta.message += ' Aucun portrait trouvé.';
    this.logger.log(meta.message);
    this.logUsage(user.organizationId, 'autofillArtist', meta.attempts);
    try {
      this.debugLog.push({
        op: 'autofill_artist',
        input: { fullName: body.fullName },
        ddgContextBytes: searchContext ? searchContext.length : null,
        structuredHit: null,
        provider: meta.attempts[0]?.model ?? null,
        success: meta.hasUsableData,
        fieldsFound: Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k]) => k),
        imageSource: source,
        durationMs: Date.now() - t0,
      });
    } catch (e) {
      this.logger.error(`debugLog.push (artist) a échoué : ${String(e)}`);
    }
    return { data, meta };
  }

  // ---------------------------------------------------------------------------
  // Bulk autofill — artwork collection
  // ---------------------------------------------------------------------------

  private static readonly bulkAutofillJobs = new Map<string, {
    mode: 'ai' | 'wiki';
    total: number;
    done: number;
    updated: number;
    running: boolean;
    startedAt: Date;
    finishedAt: Date | undefined;
  }>();

  private bulkAutofillStatusView(orgId: string) {
    const s = AiController.bulkAutofillJobs.get(orgId);
    if (!s) return { running: false, done: 0, total: 0, updated: 0, mode: null, startedAt: null, finishedAt: null };
    return { running: s.running, done: s.done, total: s.total, updated: s.updated, mode: s.mode, startedAt: s.startedAt.toISOString(), finishedAt: s.finishedAt?.toISOString() ?? null };
  }

  /**
   * Core artwork autofill logic shared between the single-artwork endpoint and the
   * bulk background job. Builds DDG + Wikipedia context, calls the AI, merges any
   * structured museum record, logs to the debug log, and tracks usage.
   * Throws on AI failure — callers decide whether to surface or swallow the error.
   */
  private async runArtworkAutofillCore(
    orgId: string,
    title: string,
    artistName: string,
    locale: string,
  ): Promise<{
    data: import('./ai.types').ArtworkAutofillResult;
    meta: import('./ai.types').AiAutofillResponse<import('./ai.types').ArtworkAutofillResult>['meta'];
    searchContext: string | null;
  }> {
    const t0 = Date.now();
    const [searchContext, structuredHit] = await Promise.all([
      buildArtworkSearchContext(artistName, title),
      this.structuredLookup.searchArtworkByTitle(artistName || undefined, title, orgId),
    ]);
    const combinedContext = structuredHit
      ? `${searchContext ?? ''}\n\nConfirmed museum record (source: ${structuredHit.source}${structuredHit.sourceUrl ? `, ${structuredHit.sourceUrl}` : ''}): ${JSON.stringify(structuredHit.result)} — trust these values over your own search/memory for any field they cover.`.trim()
      : searchContext;
    const result = await this.ai.autofillArtwork({
      title,
      artistName: artistName || undefined,
      locale: locale as Locale,
      organizationId: orgId,
      searchContext: combinedContext ?? undefined,
    });
    const data = { ...result.data };
    if (structuredHit) {
      for (const [k, v] of Object.entries(structuredHit.result)) {
        if (v !== undefined && v !== null && v !== '') (data as Record<string, unknown>)[k] = v;
      }
      result.meta.message += ` Données confirmées via ${structuredHit.source} (${structuredHit.matchedTitle}).`;
    }
    this.logUsage(orgId, 'autofillArtwork', result.meta.attempts);
    try {
      this.debugLog.push({
        op: 'autofill_artwork',
        input: { artistName, title },
        ddgContextBytes: searchContext ? searchContext.length : null,
        structuredHit: structuredHit ? { source: structuredHit.source, matchedTitle: structuredHit.matchedTitle } : null,
        provider: result.meta.attempts[0]?.model ?? null,
        success: result.meta.hasUsableData,
        fieldsFound: Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k]) => k),
        imageSource: null,
        durationMs: Date.now() - t0,
      });
    } catch (e) {
      this.logger.error(`debugLog.push (artwork) a échoué : ${String(e)}`);
    }
    return { data, meta: result.meta, searchContext };
  }

  /**
   * Returns only the fields from an autofill result that are actually missing on the
   * current artwork, so existing curator work is never overwritten by bulk AI data.
   */
  private buildArtworkPatch(
    artwork: {
      description: unknown;
      yearFrom: number | null;
      dateText: string | null;
      heightCm: number | null;
      widthCm: number | null;
      dimensionsNote: string | null;
      signatureDescription: string | null;
      condition: string;
    },
    data: import('./ai.types').ArtworkAutofillResult,
    locale: string,
  ): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    // Description (JSON field) — only add locale key if missing
    const desc = artwork.description as Record<string, string> | null ?? {};
    if (!desc[locale] && data.description) {
      patch.description = { ...desc, [locale]: data.description };
    }

    if (!artwork.yearFrom && data.yearFrom) patch.yearFrom = data.yearFrom;
    if (!artwork.dateText && data.dateText) patch.dateText = data.dateText;
    if (!artwork.heightCm && data.heightCm) patch.heightCm = data.heightCm;
    if (!artwork.widthCm && data.widthCm) patch.widthCm = data.widthCm;
    if (!artwork.dimensionsNote && data.dimensionsNote) patch.dimensionsNote = data.dimensionsNote;
    if (!artwork.signatureDescription && data.signatureDescription) patch.signatureDescription = data.signatureDescription;
    const validConditions = ['excellent', 'good', 'fair', 'poor', 'critical'];
    if (artwork.condition === 'unknown' && data.condition && validConditions.includes(data.condition)) {
      patch.condition = data.condition;
    }

    return patch;
  }

  @Post('bulk-autofill/artwork')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: 'Start a background job that autofills empty fields on artworks — AI mode uses the full LLM pipeline, wiki mode uses museum/structured sources only (no LLM)' })
  async startBulkAutofillArtwork(
    @CurrentUser() user: AuthUser,
    @Body() body: { ids?: string[]; mode?: 'ai' | 'wiki' },
  ) {
    const orgId = user.organizationId;
    const existing = AiController.bulkAutofillJobs.get(orgId);
    if (existing?.running) return this.bulkAutofillStatusView(orgId);

    const mode = body.mode ?? 'ai';

    if (mode === 'ai' && !(await this.ai.isEnabled(orgId))) {
      throw new ServiceUnavailableException('IA désactivée ou non configurée pour cette organisation (Réglages → IA).');
    }

    const whereIds = body.ids?.length ? { id: { in: body.ids } } : {};
    const artworks = await this.prisma.artwork.findMany({
      where: { organizationId: orgId, deletedAt: null, ...whereIds },
      select: {
        id: true,
        title: true,
        attribution: true,
        description: true,
        yearFrom: true,
        dateText: true,
        heightCm: true,
        widthCm: true,
        dimensionsNote: true,
        signatureDescription: true,
        condition: true,
        artist: { select: { fullName: true } },
      },
    });

    const state = { mode, total: artworks.length, done: 0, updated: 0, running: true, startedAt: new Date(), finishedAt: undefined as Date | undefined };
    AiController.bulkAutofillJobs.set(orgId, state);

    void (async () => {
      for (const aw of artworks) {
        try {
          const titleMap = aw.title as Record<string, string> | null ?? {};
          const title = titleMap['fr'] ?? titleMap['en'] ?? Object.values(titleMap).find((v) => v) ?? '';
          const artistName = aw.artist?.fullName ?? aw.attribution ?? '';
          const locale = titleMap['fr'] ? 'fr' : (titleMap['en'] ? 'en' : Object.keys(titleMap)[0] ?? 'fr');

          if (!title) { state.done++; continue; }

          let data: import('./ai.types').ArtworkAutofillResult = {};

          if (mode === 'wiki') {
            const hit = await this.structuredLookup.searchArtworkByTitle(artistName || undefined, title, orgId);
            if (hit) data = hit.result as import('./ai.types').ArtworkAutofillResult;
          } else {
            // Same pipeline as the single-artwork endpoint: DDG context + Wikipedia + AI + debug log + usage tracking
            const result = await this.runArtworkAutofillCore(orgId, title, artistName, locale);
            if (result.meta.hasUsableData) data = result.data;
          }

          const patch = this.buildArtworkPatch(aw, data, locale);
          if (Object.keys(patch).length) {
            await this.prisma.artwork.update({ where: { id: aw.id }, data: patch });
            state.updated++;
          }
        } catch (err) {
          this.logger.warn(`Bulk autofill — erreur sur "${aw.id}": ${String(err)}`);
        }
        state.done++;
        // Pace calls to avoid hammering external APIs
        await new Promise((r) => setTimeout(r, mode === 'ai' ? 1200 : 400));
      }
      state.running = false;
      state.finishedAt = new Date();
    })();

    return this.bulkAutofillStatusView(orgId);
  }

  @Get('bulk-autofill/artwork/status')
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'Current progress of the background artwork bulk-autofill job for this org' })
  getBulkAutofillArtworkStatus(@CurrentUser() user: AuthUser) {
    return this.bulkAutofillStatusView(user.organizationId);
  }

  // ---------------------------------------------------------------------------

  @Get('debug-log')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Recent AI autofill debug log (in-memory, last 200 entries)' })
  getDebugLog() {
    return { entries: this.debugLog.getAll(), serverStarted: new Date().toISOString() };
  }

  @Delete('debug-log')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Clear the in-memory AI debug log' })
  clearDebugLog() {
    this.debugLog.clear();
    return { ok: true };
  }
}
