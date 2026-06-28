import type { AiCapabilities, AiProvider, DescribeInput, DescribeResult } from './ai.types';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';

/**
 * OpenRouter provider – a thin wrapper around the OpenRouter chat completions API.
 * It supports one or more model identifiers (comma‑separated in the env var, or
 * up to 3 chosen per-organization in Settings → AI). When multiple models are
 * configured, the provider calls each model in order and returns the first
 * successful result — this is the "switch to the next AI when one stops
 * working" failover the org admin configures.
 */
export class OpenRouterAiProvider implements AiProvider {
  readonly id = 'openrouter';
  readonly enabled = true;

  private readonly apiKey: string;
  private readonly envModels: string[];

  constructor(
    apiKey: string,
    modelList: string,
    private readonly prisma?: PrismaService,
  ) {
    this.apiKey = apiKey;
    // Accept a comma‑separated list of model IDs, e.g. "openrouter/auto,openrouter/mistral-7b"
    this.envModels = modelList.split(',').map((m) => m.trim()).filter(Boolean);
  }

  /** Org-chosen models (Settings → AI) take priority over the env-configured default list. */
  private async resolveModels(organizationId?: string): Promise<string[]> {
    if (organizationId && this.prisma) {
      try {
        const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
        const orgModels = ((org?.settings as Record<string, unknown>)?.aiModels as string[] | undefined) ?? [];
        if (orgModels.length) return orgModels;
      } catch {
        // fall through to env default
      }
    }
    return this.envModels.length ? this.envModels : ['openrouter/auto'];
  }

  capabilities(): AiCapabilities {
    return {
      describe: true,
      tag: false,
      ocr: false,
      signature: false,
      compare: false,
      similar: false,
      classify: false,
    };
  }

  private async callModel(model: string, input: DescribeInput): Promise<DescribeResult> {
    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
Return ONLY a JSON object: {"description": "...", "keywords": [...], "suggestedCategory": "..."}`;
    const userMessage = 'Describe this artwork for cataloguing purposes.';

    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.0,
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`OpenRouter request failed with ${res.status}`);
    }
    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content ?? '{}';
    try {
      return JSON.parse(text) as DescribeResult;
    } catch {
      // If the model didn't return valid JSON, wrap the raw text.
      return { description: text, keywords: [], suggestedCategory: undefined } as DescribeResult;
    }
  }

  async describe(input: DescribeInput): Promise<DescribeResult> {
    // Try each configured model until one succeeds.
    const models = await this.resolveModels(input.organizationId);
    const errors: string[] = [];
    for (const model of models) {
      try {
        return await this.callModel(model, input);
      } catch (e) {
        errors.push(`${model}: ${String(e)}`);
        // continue to next model
      }
    }
    // If all models failed, surface the aggregated errors.
    throw new ServiceUnavailableException(`All OpenRouter models failed: ${errors.join(' | ')}`);
  }

  // The other AI capabilities are not implemented for OpenRouter.
  async ocr(_imageUrl: string): Promise<string> {
    throw new ServiceUnavailableException('OCR not supported by OpenRouter provider');
  }

  async tags(_input: DescribeInput): Promise<string[]> {
    throw new ServiceUnavailableException('Tagging not supported by OpenRouter provider');
  }
}
