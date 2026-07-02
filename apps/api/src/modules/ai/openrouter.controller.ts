import { Controller, Get, Query, BadRequestException } from '@nestjs/common';

/**
 * Exposes a minimal OpenRouter API for the frontend.
 * Currently provides an endpoint to list available models.
 * The optional `free` query parameter can be set to `true` to filter only free models.
 *
 * OpenRouter's model catalog is a public, keyless endpoint — no API key is
 * needed just to browse what's available, only to actually call a model
 * (handled separately by OpenRouterAiProvider with the org's configured key).
 */
@Controller('openrouter')
export class OpenRouterController {
  @Get('models')
  async listModels(@Query('free') free?: string) {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new BadRequestException(`Failed to fetch models: ${res.status}`);
    }
    const data = (await res.json()) as any;
    const models = data?.data ?? [];
    if (free === 'true') {
      // OpenRouter model objects contain a `price` field; free models have price per token = 0.
      return models.filter((m: any) => Number(m.price?.price_per_token ?? 0) === 0);
    }
    return models;
  }
}
