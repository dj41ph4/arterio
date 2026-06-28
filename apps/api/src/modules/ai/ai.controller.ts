import { Body, Controller, Inject, Logger, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Locale } from '@arterio/shared';
import { AI_PROVIDER, type AiProvider } from './ai.types';
import { searchCommonsImage } from '../../common/commons-image-search.util';
import { searchWikiArtImage } from '../../common/wikiart-api.util';
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
    return { data, meta };
  }
}
