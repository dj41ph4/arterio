import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../core/config/configuration';

/**
 * Exposes a minimal OpenRouter API for the frontend.
 * Currently provides an endpoint to list available models.
 * The optional `free` query parameter can be set to `true` to filter only free models.
 */
@Controller('openrouter')
export class OpenRouterController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get('models')
  async listModels(@Query('free') free?: string) {
    const apiKey = this.config.get('OPENROUTER_API_KEY', { infer: true });
    if (!apiKey) {
      throw new BadRequestException('OpenRouter API key not configured');
    }

    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
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
