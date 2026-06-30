import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDER } from './ai.types';
import { AnthropicAiProvider } from './anthropic.provider';
import { OpenRouterAiProvider } from './openrouter.provider';
import { GeminiAiProvider } from './gemini.provider';
import { MistralAiProvider } from './mistral.provider';
import { AiProviderChain } from './ai-provider-chain';
import { OpenRouterController } from './openrouter.controller';
import { AiController } from './ai.controller';
import { StructuredLookupService } from './structured-lookup.service';
import { AiDebugLogService } from './ai-debug-log.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CryptoModule } from '../../core/crypto/crypto.module';
import { CryptoService } from '../../core/crypto/crypto.service';
import type { Env } from '../../core/config/configuration';

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [OpenRouterController, AiController],
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
        const openRouterKey = config.get('OPENROUTER_API_KEY', { infer: true });
        const openRouterModel = config.get('OPENROUTER_MODEL', { infer: true });
        const geminiKey = config.get('GEMINI_API_KEY', { infer: true });
        const geminiModel = config.get('GEMINI_MODEL', { infer: true });
        const mistralKey = config.get('MISTRAL_API_KEY', { infer: true });
        const mistralModel = config.get('MISTRAL_MODEL', { infer: true });
        // Chained so a free-tier OpenRouter model that 402s/429s — or simply
        // finds nothing — falls through to the next provider automatically,
        // with the order itself swappable per-org from Settings → AI (any
        // permutation of the three).
        return new AiProviderChain(
          {
            openrouter: new OpenRouterAiProvider(openRouterKey ?? '', openRouterModel ?? '', prisma, crypto),
            gemini: new GeminiAiProvider(geminiKey ?? '', geminiModel ?? '', prisma, crypto),
            mistral: new MistralAiProvider(mistralKey ?? '', mistralModel ?? '', prisma, crypto),
          },
          ['openrouter', 'mistral', 'gemini'],
          prisma,
        );
      },
    },
    StructuredLookupService,
    AiDebugLogService,
  ],
  exports: [AI_PROVIDER, AiDebugLogService],
})
export class AiModule {}
