import { BadRequestException, Body, Controller, Inject, Logger, NotFoundException, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ARTWORK_STATUS, CONDITION_RATING, PERMISSIONS, type Locale } from '@arterio/shared';
import { AI_PROVIDER, type AiProvider } from './ai.types';
import { ChatService, type ChatRequestMessage } from './chat.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UPLOAD_DIR } from '../../core/config/paths';
import type { AuthUser } from '../../common/types';

const LOCALES: Locale[] = ['en', 'fr', 'it', 'es', 'de', 'nl'];

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('ai')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('chat')
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'Assistant « Parle à ta collection » — one grounded answer per call (server-side tool loop)' })
  async chat(
    @CurrentUser() user: AuthUser,
    @Body() body: { messages?: ChatRequestMessage[]; locale?: string },
  ) {
    if (!(await this.ai.isEnabled(user.organizationId))) {
      throw new ServiceUnavailableException('Aucun fournisseur IA activé pour cette organisation (Réglages → IA).');
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length || messages[messages.length - 1]!.role !== 'user') {
      throw new BadRequestException('messages must end with a user message');
    }
    const locale: Locale = LOCALES.includes(body.locale as Locale) ? (body.locale as Locale) : 'fr';

    const outcome = await this.chatService.chat(user, messages, locale);

    // Metadata only — never message content (same privacy bar as autofill).
    if (outcome.attempts.length) {
      this.prisma.aiUsageLog
        .createMany({
          data: outcome.attempts.map((a) => ({
            organizationId: user.organizationId,
            operation: 'chat',
            provider: a.provider ?? this.ai.id,
            model: a.model,
            success: a.success,
          })),
        })
        .catch((e) => this.logger.warn(`Échec de l'enregistrement de l'usage IA (chat) : ${String(e)}`));
    }

    return {
      message: outcome.message,
      trace: outcome.trace,
      modelUsed: outcome.modelUsed ?? null,
    };
  }

  /**
   * "Recherche intelligente" — one toolless chat turn translating a natural-
   * language query into structured ArtworkQuery filters. The filters are then
   * applied by the normal /artworks list endpoint, whose permission gates
   * (valuations…) apply as usual — the model never sees any data here.
   */
  @Post('search-filters')
  @RequirePermissions(PERMISSIONS.ARTWORK_READ)
  @ApiOperation({ summary: 'Translate a natural-language query into collection filters' })
  async searchFilters(@CurrentUser() user: AuthUser, @Body() body: { query?: string; locale?: string }) {
    if (!(await this.ai.isEnabled(user.organizationId))) {
      throw new ServiceUnavailableException('Aucun fournisseur IA activé pour cette organisation (Réglages → IA).');
    }
    const query = (body.query ?? '').trim().slice(0, 300);
    if (!query) throw new BadRequestException('query is required');
    const locale: Locale = LOCALES.includes(body.locale as Locale) ? (body.locale as Locale) : 'fr';

    const systemPrompt = `You translate a natural-language art-collection search into a JSON filter object. Query language: probably "${locale}".
Return ONLY a JSON object with any subset of:
- "search": free text to match against titles/inventory/artist (only words that identify a specific work or artist — NEVER copy filter words like colors or conditions into it)
- "artistName": artist name if one is mentioned
- "status": array from ${JSON.stringify(ARTWORK_STATUS)}
- "condition": array from ${JSON.stringify(CONDITION_RATING)}
- "color": ONE hex color like "#1c7ed6" (or "black"/"white"/"gray") if a color is mentioned
- "yearFrom"/"yearTo": numeric year bounds if a period is mentioned
- "favorite": true if favorites are mentioned
Omit every key you are not sure about. No prose, no markdown fences — JSON only.`;

    const turn = await this.ai.chat({
      systemPrompt,
      messages: [{ role: 'user', content: query }],
      tools: [],
      locale,
      organizationId: user.organizationId,
    });

    let parsed: Record<string, unknown> = {};
    try {
      const text = turn.text ?? '';
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      // fall through to empty filters — the caller falls back to plain text search
    }

    // Validate against the shared enums — the model's output is never trusted.
    const arr = (v: unknown, allowed: readonly string[]) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && allowed.includes(x)) : undefined;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const color = str(parsed.color);
    const filters = {
      search: str(parsed.search),
      artistName: str(parsed.artistName),
      status: arr(parsed.status, ARTWORK_STATUS),
      condition: arr(parsed.condition, CONDITION_RATING),
      color: color && (/^#[0-9a-f]{6}$/i.test(color) || ['black', 'white', 'gray'].includes(color)) ? color : undefined,
      yearFrom: num(parsed.yearFrom),
      yearTo: num(parsed.yearTo),
      favorite: parsed.favorite === true ? true : undefined,
    };

    if (turn.meta.attempts.length) {
      this.prisma.aiUsageLog
        .createMany({
          data: turn.meta.attempts.map((a) => ({
            organizationId: user.organizationId,
            operation: 'searchFilters',
            provider: a.provider ?? this.ai.id,
            model: a.model,
            success: a.success,
          })),
        })
        .catch(() => undefined);
    }

    return { filters, modelUsed: turn.meta.modelUsed ?? null };
  }

  /**
   * Vision condition report — SUGGESTION ONLY, nothing is written: the user
   * reviews/edits the proposed rating + note in the Conservation tab and
   * accepts explicitly (which goes through the normal artwork PATCH).
   */
  @Post('condition-report')
  @RequirePermissions(PERMISSIONS.ARTWORK_UPDATE)
  @ApiOperation({ summary: "Constat d'état par vision — suggestion from the artwork's primary photo" })
  async conditionReport(@CurrentUser() user: AuthUser, @Body() body: { artworkId?: string; locale?: string }) {
    if (!(await this.ai.isEnabled(user.organizationId))) {
      throw new ServiceUnavailableException('Aucun fournisseur IA activé pour cette organisation (Réglages → IA).');
    }
    if (!this.ai.capabilities().vision) {
      throw new ServiceUnavailableException("Aucun fournisseur IA supportant l'analyse d'image n'est configuré (Réglages → IA).");
    }
    const artworkId = body.artworkId?.trim();
    if (!artworkId) throw new BadRequestException('artworkId is required');
    const locale: Locale = LOCALES.includes(body.locale as Locale) ? (body.locale as Locale) : 'fr';

    const media = await this.prisma.mediaAsset.findFirst({
      where: { artworkId, organizationId: user.organizationId, type: 'image' },
      orderBy: { sortOrder: 'asc' },
    });
    if (!media) throw new NotFoundException("Cette œuvre n'a pas encore de photo.");

    // Downscale to ≤1024px: keeps the base64 payload well under provider caps
    // even for 15 MB uploads, with no visible loss for condition assessment.
    const buffer = await readFile(join(UPLOAD_DIR, media.storageKey));
    const resized = await sharp(buffer, { failOn: 'none' })
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const result = await this.ai.analyzeImage({
      imageBase64: resized.toString('base64'),
      mimeType: 'image/jpeg',
      task: `You are a professional art conservator. Assess the physical condition of the artwork in this photo.
Return ONLY a JSON object: {"condition": one of ${JSON.stringify(CONDITION_RATING)}, "note": a 2-4 sentence condition note, "observations": array of short strings (visible damage, wear, discoloration…)}.
Only describe what is actually visible — never invent damage.`,
      locale,
      organizationId: user.organizationId,
    });

    if (result.meta.attempts.length) {
      this.prisma.aiUsageLog
        .createMany({
          data: result.meta.attempts.map((a) => ({
            organizationId: user.organizationId,
            operation: 'conditionReport',
            provider: a.provider ?? this.ai.id,
            model: a.model,
            success: a.success,
          })),
        })
        .catch(() => undefined);
    }

    // Clamp everything the model returned — suggestion or not, it must be valid.
    const raw = result.json;
    const condition = typeof raw.condition === 'string' && (CONDITION_RATING as readonly string[]).includes(raw.condition) ? raw.condition : 'unknown';
    const note = typeof raw.note === 'string' ? raw.note.slice(0, 2000) : '';
    const observations = Array.isArray(raw.observations)
      ? raw.observations.filter((o): o is string => typeof o === 'string').slice(0, 12)
      : [];

    return { condition, note, observations, modelUsed: result.meta.modelUsed ?? null };
  }
}
