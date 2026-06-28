import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDER } from './ai.types';
import { AnthropicAiProvider } from './anthropic.provider';
import { OpenRouterAiProvider } from './openrouter.provider';
import { OpenRouterController } from './openrouter.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoModule } from '../../core/crypto/crypto.module';
import { CryptoService } from '../../core/crypto/crypto.service';
import type { Env } from '../../core/config/configuration';

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [OpenRouterController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [ConfigService, PrismaService, CryptoService],
      // AnthropicAiProvider stays purely env-driven (its own API key is a secret
      // not meant to be typed into the Settings UI). OpenRouterAiProvider is the
      // default otherwise — it's always constructed (even with no env config at
      // all) because whether it's actually "on" is decided per-organization from
      // Settings → AI, not at app boot: an org with nothing enabled just gets
      // isEnabled() === false, and enrichment silently falls back to the normal
      // Wikidata/museum-API flow without ever calling OpenRouter.
      useFactory: (config: ConfigService<Env, true>, prisma: PrismaService, crypto: CryptoService) => {
        const provider = config.get('AI_PROVIDER', { infer: true });
        if (config.get('AI_ENABLED', { infer: true }) && provider === 'anthropic') {
          const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
          const model = config.get('AI_MODEL', { infer: true });
          return new AnthropicAiProvider(apiKey ?? '', model);
        }
        const apiKey = config.get('OPENROUTER_API_KEY', { infer: true });
        const model = config.get('OPENROUTER_MODEL', { infer: true });
        return new OpenRouterAiProvider(apiKey ?? '', model ?? '', prisma, crypto);
      },
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
