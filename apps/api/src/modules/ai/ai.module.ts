import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDER } from './ai.types';
import { NullAiProvider } from './null.provider';
import { AnthropicAiProvider } from './anthropic.provider';
import type { Env } from '../../core/config/configuration';

@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const enabled = config.get('AI_ENABLED', { infer: true });
        if (!enabled) return new NullAiProvider();

        const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
        const model = config.get('AI_MODEL', { infer: true });
        return new AnthropicAiProvider(apiKey ?? '', model);
      },
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
