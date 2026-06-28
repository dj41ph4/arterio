import type {
  AiCapabilities,
  AiProvider,
  ArtistAutofillInput,
  ArtistAutofillResult,
  ArtworkAutofillInput,
  ArtworkAutofillResult,
  DescribeInput,
  DescribeResult,
} from './ai.types';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { CryptoService } from '../../core/crypto/crypto.service';

interface OrgAiSettings {
  enabled?: boolean;
  openrouterApiKeyEnc?: string;
  models?: string[];
}

/**
 * OpenRouter provider – a thin wrapper around the OpenRouter chat completions API.
 * Both the API key and the model list can be overridden per-organization from
 * Settings → AI (stored encrypted on Organization.settings.ai) — falling back
 * to the env-configured OPENROUTER_API_KEY / OPENROUTER_MODEL when an org
 * hasn't set its own. When multiple models are configured, the provider calls
 * each in order and returns the first successful result — this is the
 * "switch to the next AI when one stops working" failover the org admin
 * configures from the UI.
 */
export class OpenRouterAiProvider implements AiProvider {
  readonly id = 'openrouter';
  readonly enabled = true;

  private readonly envApiKey: string;
  private readonly envModels: string[];

  constructor(
    envApiKey: string,
    modelList: string,
    private readonly prisma?: PrismaService,
    private readonly crypto?: CryptoService,
  ) {
    this.envApiKey = envApiKey;
    // Accept a comma‑separated list of model IDs, e.g. "openrouter/auto,openrouter/mistral-7b"
    this.envModels = modelList.split(',').map((m) => m.trim()).filter(Boolean);
  }

  private async resolveOrgSettings(organizationId?: string): Promise<OrgAiSettings | null> {
    if (!organizationId || !this.prisma) return null;
    try {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      return ((org?.settings as Record<string, unknown>)?.ai as OrgAiSettings | undefined) ?? null;
    } catch {
      return null;
    }
  }

  /** True once enabled at the org level (or via env, when no org context applies) AND an API key is resolvable either way. */
  async isEnabled(organizationId?: string): Promise<boolean> {
    const org = await this.resolveOrgSettings(organizationId);
    if (org) return Boolean(org.enabled && (org.openrouterApiKeyEnc || this.envApiKey));
    return Boolean(this.envApiKey);
  }

  private async resolveApiKey(org: OrgAiSettings | null): Promise<string> {
    if (org?.openrouterApiKeyEnc && this.crypto) {
      try {
        return this.crypto.decrypt(org.openrouterApiKeyEnc);
      } catch {
        // fall through to env key
      }
    }
    return this.envApiKey;
  }

  /** Org-chosen models (Settings → AI) take priority over the env-configured default list. */
  private resolveModels(org: OrgAiSettings | null): string[] {
    if (org?.models?.length) return org.models;
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

  private async callModel(model: string, apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
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
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`OpenRouter request failed with ${res.status}`);
    }
    const data = (await res.json()) as any;
    return data?.choices?.[0]?.message?.content ?? '{}';
  }

  /** Tries each org/env-configured model in order, returning the first one that responds — the "switch to the next AI" failover. */
  private async completeWithFailover(organizationId: string | undefined, systemPrompt: string, userMessage: string): Promise<string> {
    const org = await this.resolveOrgSettings(organizationId);
    const apiKey = await this.resolveApiKey(org);
    if (!apiKey) throw new ServiceUnavailableException('No OpenRouter API key configured');

    const models = this.resolveModels(org);
    const errors: string[] = [];
    for (const model of models) {
      try {
        return await this.callModel(model, apiKey, systemPrompt, userMessage);
      } catch (e) {
        errors.push(`${model}: ${String(e)}`);
      }
    }
    throw new ServiceUnavailableException(`All OpenRouter models failed: ${errors.join(' | ')}`);
  }

  async describe(input: DescribeInput): Promise<DescribeResult> {
    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
Return ONLY a JSON object: {"description": "...", "keywords": [...], "suggestedCategory": "..."}`;
    const text = await this.completeWithFailover(input.organizationId, systemPrompt, 'Describe this artwork for cataloguing purposes.');
    try {
      return JSON.parse(text) as DescribeResult;
    } catch {
      // If the model didn't return valid JSON, wrap the raw text.
      return { description: text, keywords: [], suggestedCategory: undefined } as DescribeResult;
    }
  }

  async autofillArtwork(input: ArtworkAutofillInput): Promise<ArtworkAutofillResult> {
    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
Only state facts you are confident about for this specific, named work — leave a field out entirely rather than guessing.
Return ONLY a JSON object with any of: description, techniqueName, dateText, yearFrom (number), dimensionsNote, condition, tags (string array), imageUrl (a real public URL only if you know one).`;
    const userMessage = `Title: ${input.title ?? '(unknown)'}\nArtist: ${input.artistName ?? '(unknown)'}`;
    try {
      return JSON.parse(await this.completeWithFailover(input.organizationId, systemPrompt, userMessage)) as ArtworkAutofillResult;
    } catch {
      return {};
    }
  }

  async autofillArtist(input: ArtistAutofillInput): Promise<ArtistAutofillResult> {
    const systemPrompt = `You are an art historian. Respond in language code: ${input.locale}.
Only state facts you are confident about for this specific person — leave a field out entirely rather than guessing.
Return ONLY a JSON object with any of: biography, nationality, birthDate, deathDate, movement, imageUrl (a real public URL only if you know one).`;
    try {
      return JSON.parse(await this.completeWithFailover(input.organizationId, systemPrompt, `Artist: ${input.fullName}`)) as ArtistAutofillResult;
    } catch {
      return {};
    }
  }

  // The other AI capabilities are not implemented for OpenRouter.
  async ocr(_imageUrl: string): Promise<string> {
    throw new ServiceUnavailableException('OCR not supported by OpenRouter provider');
  }

  async tags(_input: DescribeInput): Promise<string[]> {
    throw new ServiceUnavailableException('Tagging not supported by OpenRouter provider');
  }
}
