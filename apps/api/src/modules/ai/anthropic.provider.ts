import type {
  AiAutofillMeta,
  AiAutofillResponse,
  AiCapabilities,
  AiProvider,
  ArtistAutofillInput,
  ArtistAutofillResult,
  ArtworkAutofillInput,
  ArtworkAutofillResult,
  DescribeInput,
  DescribeResult,
  TranslateInput,
} from './ai.types';
import { Logger } from '@nestjs/common';

/**
 * Claude-backed provider. Only instantiated when AI_ENABLED=true and
 * ANTHROPIC_API_KEY is set. The SDK import is intentionally lazy so the
 * module loads cleanly even when the dependency is absent in stripped builds.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly enabled = true;
  private readonly logger = new Logger(AnthropicAiProvider.name);

  async isEnabled(): Promise<boolean> {
    return true;
  }

  private readonly model: string;
  private client: unknown = null;

  constructor(apiKey: string, model = 'claude-opus-4-8') {
    this.model = model;
    // Lazy-load to avoid hard build dependency when AI is off.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Anthropic } = require('@anthropic-ai/sdk') as typeof import('@anthropic-ai/sdk');
    this.client = new Anthropic({ apiKey });
  }

  capabilities(): AiCapabilities {
    return {
      describe: true,
      tag: true,
      ocr: true,
      signature: false,
      compare: false,
      similar: false,
      classify: true,
    };
  }

  async describe(input: DescribeInput): Promise<DescribeResult> {
    const sdk = this.client as import('@anthropic-ai/sdk').Anthropic;
    const content: import('@anthropic-ai/sdk').Anthropic.MessageParam['content'] = [];

    if (input.imageUrl) {
      // Pass as URL reference — works for publicly accessible images
      content.push({
        type: 'image',
        source: { type: 'url', url: input.imageUrl },
      } as never);
    }

    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
Return ONLY a JSON object: {"description": "...", "keywords": [...], "suggestedCategory": "..."}`;

    content.push({ type: 'text', text: 'Describe this artwork for cataloguing purposes.' });

    const msg = await sdk.messages.create({
      model: this.model,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    });

    const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
    return JSON.parse(text) as DescribeResult;
  }

  async ocr(_imageUrl: string): Promise<string> {
    // TODO: implement OCR via vision
    return '';
  }

  async tags(input: DescribeInput): Promise<string[]> {
    const result = await this.describe(input);
    return result.keywords;
  }

  private async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const sdk = this.client as import('@anthropic-ai/sdk').Anthropic;
    const msg = await sdk.messages.create({
      model: this.model,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: userMessage }] }],
    });
    return msg.content.find((b) => b.type === 'text')?.text ?? '{}';
  }

  /** Mirrors OpenRouterAiProvider's parsing/meta contract so the controller can treat both providers identically. */
  private parseAutofillResult<T extends object>(text: string, model: string): { data: T; meta: AiAutofillMeta } {
    const attempts = [{ model, success: true, message: `Réponse reçue avec succès du modèle "${model}"` }];
    const meta: AiAutofillMeta = {
      modelUsed: model,
      fallbackUsed: false,
      attempts,
      message: `Réponse IA reçue correctement depuis Anthropic (modèle : ${model}).`,
      hasUsableData: false,
    };
    try {
      const data = JSON.parse(text) as T;
      const fieldCount = Object.values(data).filter((v) => v !== undefined && v !== null && v !== '').length;
      if (fieldCount === 0) {
        meta.message += ' — Réponse extraite mais entièrement vide.';
      } else {
        meta.message += ` — Réponse extraite avec succès et envoyée à l'UI (${fieldCount} champ${fieldCount > 1 ? 's' : ''}).`;
        meta.hasUsableData = true;
      }
      return { data, meta };
    } catch (e) {
      meta.message += ` — Réponse reçue mais JSON invalide (${(e as Error).message}).`;
      this.logger.warn(`JSON.parse a échoué sur la réponse Anthropic (tronquée) : ${text.slice(0, 200)}`);
      return { data: {} as T, meta };
    }
  }

  async autofillArtwork(input: ArtworkAutofillInput): Promise<AiAutofillResponse<ArtworkAutofillResult>> {
    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
Only state facts you are confident about for this specific, named work — leave a field out entirely rather than guessing.
Return ONLY a JSON object with any of: description, techniqueName, dateText, yearFrom (number), dimensionsNote, signatureDescription (where/how the work is signed), condition, tags (string array).`;
    const userMessage = `Title: ${input.title ?? '(unknown)'}\nArtist: ${input.artistName ?? '(unknown)'}`;
    const text = await this.complete(systemPrompt, userMessage);
    return this.parseAutofillResult<ArtworkAutofillResult>(text, this.model);
  }

  async autofillArtist(input: ArtistAutofillInput): Promise<AiAutofillResponse<ArtistAutofillResult>> {
    const systemPrompt = `You are an art historian. Respond in language code: ${input.locale}.
Only state facts you are confident about for this specific person — leave a field out entirely rather than guessing.
Return ONLY a JSON object with any of: biography, nationality, birthDate, deathDate, movement.`;
    const text = await this.complete(systemPrompt, `Artist: ${input.fullName}`);
    return this.parseAutofillResult<ArtistAutofillResult>(text, this.model);
  }

  /** Best-effort text translation — never throws, returns null so the caller (enrichment) just skips that locale on failure. */
  async translate(input: TranslateInput): Promise<string | null> {
    const systemPrompt =
      `You are a professional translator. Translate the user's text into language code "${input.targetLocale}"` +
      (input.sourceLocale ? ` (source language code: "${input.sourceLocale}").` : '.') +
      ' Return ONLY the translated text — no quotes, no explanation, no markdown, no preamble.';
    try {
      const text = await this.complete(systemPrompt, input.text);
      const trimmed = text.trim();
      return trimmed || null;
    } catch (e) {
      this.logger.warn(`Traduction vers "${input.targetLocale}" échouée : ${String(e)}`);
      return null;
    }
  }
}
