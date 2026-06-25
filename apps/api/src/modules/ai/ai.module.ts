import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDER } from './ai.types';
import { NullAiProvider } from './null.provider';
import { AnthropicAiProvider } from './anthropic.provider';
import { OpenRouterAiProvider } from './openrouter.provider';
import { OpenRouterController } from './openrouter.controller';
import type { Env } from '../../core/config/configuration';

@Module({
  controllers: [OpenRouterController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const enabled = config.get('AI_ENABLED', { infer: true });
        if (!enabled) return new NullAiProvider();

        const provider = config.get('AI_PROVIDER', { infer: true });
        if (provider === 'openrouter') {
          const apiKey = config.get('OPENROUTER_API_KEY', { infer: true });
          const model = config.get('OPENROUTER_MODEL', { infer: true });
          return new OpenRouterAiProvider(apiKey ?? '', model);
        }
        // Default to Anthropic for backward compatibility
        const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
        const model = config.get('AI_MODEL', { infer: true });
        return new AnthropicAiProvider(apiKey ?? '', model);
      },
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
