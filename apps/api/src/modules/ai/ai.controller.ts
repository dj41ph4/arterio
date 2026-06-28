import { Body, Controller, Inject, Logger, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Locale } from '@arterio/shared';
import { AI_PROVIDER, type AiProvider } from './ai.types';
import { searchCommonsImage } from '../../common/commons-image-search.util';
import { searchWikiArtImage } from '../../common/wikiart-api.util';
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

  /** WikiArt (with a registered key) takes priority — it's a curated art-only index, so a hit is higher-confidence than a general Commons search. Falls through silently on any failure. */
  private async findPhoto(query: string, organizationId: string): Promise<{ url: string | null; source: 'wikiart' | 'commons' | null }> {
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
    return { url: fromCommons, source: fromCommons ? 'commons' : null };
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
    // A chat model with no web-search tool can only ever hallucinate an
    // imageUrl from memory — it looks plausible but routinely 404s or isn't
    // an image at all, which is exactly what surfaced as "Impossible
    // d'attacher l'image trouvée par l'IA". A real WikiArt/Commons search
    // result always wins over the model's own guess.
    const aiGuessedUrl = data.imageUrl;
    if (body.title) {
      const { url, source } = await this.findPhoto(`${body.artistName ?? ''} ${body.title}`.trim(), user.organizationId);
      if (url) {
        data.imageUrl = url;
        meta.message += source === 'wikiart' ? ' Photo réelle trouvée via WikiArt.' : ' Photo réelle trouvée via Wikimedia Commons.';
      } else if (aiGuessedUrl) {
        meta.message += " Aucune photo trouvée (WikiArt/Commons) — l'URL fournie par le modèle n'est pas fiable et a été ignorée.";
        data.imageUrl = undefined;
      } else {
        meta.message += ' Aucune photo trouvée.';
      }
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
    const { url, source } = await this.findPhoto(`${body.fullName} portrait`, user.organizationId);
    if (url) {
      data.imageUrl = url;
      meta.message += source === 'wikiart' ? ' Portrait trouvé via WikiArt.' : ' Portrait trouvé via Wikimedia Commons.';
    } else if (aiGuessedUrl) {
      meta.message += " Aucun portrait trouvé (WikiArt/Commons) — l'URL fournie par le modèle n'est pas fiable et a été ignorée.";
      data.imageUrl = undefined;
    } else {
      meta.message += ' Aucun portrait trouvé.';
    }
    this.logger.log(meta.message);
    return { data, meta };
  }
}
