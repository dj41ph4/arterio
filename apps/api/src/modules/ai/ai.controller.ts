import { BadRequestException, Body, Controller, Get, Inject, Logger, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Locale } from '@arterio/shared';
import { AI_PROVIDER, type AiProvider, type AiAttemptLog } from './ai.types';
import { searchCommonsImage, searchCommonsImages } from '../../common/commons-image-search.util';
import { searchWikiArtImage, searchWikiArtImages } from '../../common/wikiart-api.util';
import { isLikelyRealImage } from '../../common/download-image.util';
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
  ) {}

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

  /**
   * WikiArt (with a registered key) takes priority — it's a curated art-only
   * index, so a hit is higher-confidence than a general Commons search.
   * Falls through to Commons, and finally — now that autofill runs with a
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
  ): Promise<{ url: string | null; source: 'wikiart' | 'commons' | 'ai-search' | null }> {
    try {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      const wikiartApiKeyEnc = ((org?.settings as Record<string, unknown>)?.ai as { wikiartApiKeyEnc?: string } | undefined)?.wikiartApiKeyEnc;
      if (wikiartApiKeyEnc) {
        const key = this.crypto.decrypt(wikiartApiKeyEnc);
        const fromWikiArt = await searchWikiArtImage(key, query);
        if (fromWikiArt) return { url: fromWikiArt, source: 'wikiart' };
      }
    } catch {
      // fall through to Commons
    }
    const fromCommons = await searchCommonsImage(query);
    if (fromCommons) return { url: fromCommons, source: 'commons' };

    if (aiGuessedUrl && (await isLikelyRealImage(aiGuessedUrl))) {
      return { url: aiGuessedUrl, source: 'ai-search' };
    }
    return { url: null, source: null };
  }

  /**
   * The "Wiki" image-search button — WikiArt (if a key is configured) and
   * Wikimedia Commons, combined and de-duplicated, no AI/LLM call involved
   * at all. Deliberately separate from findPhoto() above (which only ever
   * needs the single best hit for autofill) since this one is about
   * surfacing as many real candidates as possible for the user to pick from.
   */
  private async findWikiImages(query: string, organizationId: string, limit = 8): Promise<{ images: string[]; wikiartCount: number }> {
    let fromWikiArt: string[] = [];
    try {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      const wikiartApiKeyEnc = ((org?.settings as Record<string, unknown>)?.ai as { wikiartApiKeyEnc?: string } | undefined)?.wikiartApiKeyEnc;
      if (wikiartApiKeyEnc) {
        const key = this.crypto.decrypt(wikiartApiKeyEnc);
        fromWikiArt = await searchWikiArtImages(key, query, limit);
      }
    } catch {
      // fall through to Commons-only
    }
    const fromCommons = await searchCommonsImages(query, limit);
    const seen = new Set<string>();
    const images = [...fromWikiArt, ...fromCommons].filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    }).slice(0, limit);
    return { images, wikiartCount: fromWikiArt.length };
  }

  @Post('images/artwork')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'Find multiple candidate photos for an artwork via WikiArt/Wikimedia Commons (no AI call)' })
  async findArtworkImages(@CurrentUser() user: AuthUser, @Body() body: { title?: string; artistName?: string }) {
    const query = `${body.artistName ?? ''} ${body.title ?? ''}`.trim();
    if (!query) throw new BadRequestException('title or artistName is required');
    const { images, wikiartCount } = await this.findWikiImages(query, user.organizationId);
    const message = images.length
      ? `${images.length} image${images.length > 1 ? 's' : ''} trouvée${images.length > 1 ? 's' : ''}${wikiartCount ? ` (dont ${wikiartCount} via WikiArt)` : ' via Wikimedia Commons'}.`
      : 'Aucune image trouvée via WikiArt/Wikimedia Commons pour ce titre/artiste.';
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
    const { data, meta } = await this.ai.findImages({
      query: `Search query to run: ${body.artistName ?? ''} "${body.title ?? ''}" photo painting image`.trim(),
      organizationId: user.organizationId,
    });
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
  @ApiOperation({ summary: 'Find multiple candidate portraits for an artist via WikiArt/Wikimedia Commons (no AI call)' })
  async findArtistImages(@CurrentUser() user: AuthUser, @Body() body: { fullName: string }) {
    if (!body.fullName?.trim()) throw new BadRequestException('fullName is required');
    const { images, wikiartCount } = await this.findWikiImages(`${body.fullName} portrait`, user.organizationId);
    const message = images.length
      ? `${images.length} portrait${images.length > 1 ? 's' : ''} trouvé${images.length > 1 ? 's' : ''}${wikiartCount ? ` (dont ${wikiartCount} via WikiArt)` : ' via Wikimedia Commons'}.`
      : 'Aucun portrait trouvé via WikiArt/Wikimedia Commons pour ce nom.';
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
    const { data, meta } = await this.ai.findImages({
      query: `Search query to run: ${body.fullName} portrait photo`,
      organizationId: user.organizationId,
    });
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
    const { data, meta } = await this.ai.autofillArtwork({
      title: body.title,
      artistName: body.artistName,
      locale: body.locale ?? 'en',
      organizationId: user.organizationId,
    });
    // A WikiArt/Commons hit is always preferred (dedicated art/media
    // indexes), but the AI's own imageUrl is no longer discarded outright —
    // autofill now runs with a real web search behind it, so its guess is
    // often an actual photo found in a search result (an auction lot, the
    // artist's own site). It's still HEAD-checked in findPhoto() before
    // being trusted, so a hallucinated/broken URL never reaches the UI.
    const aiGuessedUrl = data.imageUrl;
    if (body.title) {
      const { url, source } = await this.findPhoto(`${body.artistName ?? ''} ${body.title}`.trim(), user.organizationId, aiGuessedUrl);
      data.imageUrl = url ?? undefined;
      if (source === 'wikiart') meta.message += ' Photo réelle trouvée via WikiArt.';
      else if (source === 'commons') meta.message += ' Photo réelle trouvée via Wikimedia Commons.';
      else if (source === 'ai-search') meta.message += " Photo trouvée par l'IA via recherche web et vérifiée.";
      else meta.message += ' Aucune photo trouvée.';
    }
    this.logger.log(meta.message);
    this.logUsage(user.organizationId, 'autofillArtwork', meta.attempts);
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
    const { data, meta } = await this.ai.autofillArtist({
      fullName: body.fullName,
      locale: body.locale ?? 'en',
      organizationId: user.organizationId,
    });
    const aiGuessedUrl = data.imageUrl;
    const { url, source } = await this.findPhoto(`${body.fullName} portrait`, user.organizationId, aiGuessedUrl);
    data.imageUrl = url ?? undefined;
    if (source === 'wikiart') meta.message += ' Portrait trouvé via WikiArt.';
    else if (source === 'commons') meta.message += ' Portrait trouvé via Wikimedia Commons.';
    else if (source === 'ai-search') meta.message += " Portrait trouvé par l'IA via recherche web et vérifié.";
    else meta.message += ' Aucun portrait trouvé.';
    this.logger.log(meta.message);
    this.logUsage(user.organizationId, 'autofillArtist', meta.attempts);
    return { data, meta };
  }
}
