import { Body, Controller, Inject, Logger, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Locale } from '@arterio/shared';
import { AI_PROVIDER, type AiProvider } from './ai.types';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUser } from '../../common/types';

function normalizeForMatch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function matchesAllTokens(name: string, candidate: string): boolean {
  const candidateNorm = normalizeForMatch(candidate);
  const tokens = normalizeForMatch(name).split(/\s+/).filter((t) => t.length > 1);
  if (!tokens.length) return false;
  return tokens.every((t) => candidateNorm.includes(t));
}

/**
 * Best-effort, keyless real photo for a specific named work — the AI model
 * can only ever recall an image URL from memory (unreliable, easily
 * hallucinated), whereas WikiArt actually hosts the image. Used only as a
 * fallback when the AI response didn't already include one.
 */
async function findWikiArtImage(title: string, artistName: string | undefined): Promise<string | undefined> {
  if (!artistName) return undefined;
  try {
    const searchRes = await fetch(
      `https://www.wikiart.org/en/api/2/SearchArtists?term=${encodeURIComponent(artistName)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!searchRes.ok) return undefined;
    const artists = (await searchRes.json()) as Array<{ artistName?: string; url?: string }> | null;
    const artist = artists?.find((a) => matchesAllTokens(artistName, a.artistName ?? ''));
    if (!artist?.url) return undefined;

    const slug = artist.url.replace(/^\/?en\//, '');
    const paintingsRes = await fetch(
      `https://www.wikiart.org/en/api/2/PaintingsByArtist?artistUrl=${encodeURIComponent(slug)}&json=2`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!paintingsRes.ok) return undefined;
    const paintings = (await paintingsRes.json()) as Array<{ title?: string; image?: string }> | null;
    const painting = paintings?.find((p) => matchesAllTokens(title, p.title ?? ''));
    return painting?.image || undefined;
  } catch {
    return undefined;
  }
}

/** Lets the frontend show/hide "AI autocomplete" buttons without duplicating the enabled-check logic. */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(@Inject(AI_PROVIDER) private readonly ai: AiProvider) {}

  @Post('autofill/artwork')
  @RequirePermissions(PERMISSIONS.ARTWORK_CREATE)
  @ApiOperation({ summary: 'AI-suggested artwork fields from title + artist name (OpenRouter-backed, WikiArt for the photo)' })
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
    if (!data.imageUrl && body.title) {
      const found = await findWikiArtImage(body.title, body.artistName);
      if (found) {
        data.imageUrl = found;
        meta.message += ' Photo trouvée via WikiArt.';
      } else {
        meta.message += ' Aucune photo trouvée (ni par le modèle, ni via WikiArt).';
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
    const result = await this.ai.autofillArtist({
      fullName: body.fullName,
      locale: body.locale ?? 'en',
      organizationId: user.organizationId,
    });
    this.logger.log(result.meta.message);
    return result;
  }
}
