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

/**
 * Claude-backed provider. Only instantiated when AI_ENABLED=true and
 * ANTHROPIC_API_KEY is set. The SDK import is intentionally lazy so the
 * module loads cleanly even when the dependency is absent in stripped builds.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly enabled = true;

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

  async autofillArtwork(input: ArtworkAutofillInput): Promise<ArtworkAutofillResult> {
    const systemPrompt = `You are an expert art cataloguer. Respond in language code: ${input.locale}.
Only state facts you are confident about for this specific, named work — leave a field out entirely rather than guessing.
Return ONLY a JSON object with any of: description, techniqueName, dateText, yearFrom (number), dimensionsNote, condition, tags (string array), imageUrl (a real public URL only if you know one).`;
    const userMessage = `Title: ${input.title ?? '(unknown)'}\nArtist: ${input.artistName ?? '(unknown)'}`;
    try {
      return JSON.parse(await this.complete(systemPrompt, userMessage)) as ArtworkAutofillResult;
    } catch {
      return {};
    }
  }

  async autofillArtist(input: ArtistAutofillInput): Promise<ArtistAutofillResult> {
    const systemPrompt = `You are an art historian. Respond in language code: ${input.locale}.
Only state facts you are confident about for this specific person — leave a field out entirely rather than guessing.
Return ONLY a JSON object with any of: biography, nationality, birthDate, deathDate, movement, imageUrl (a real public URL only if you know one).`;
    try {
      return JSON.parse(await this.complete(systemPrompt, `Artist: ${input.fullName}`)) as ArtistAutofillResult;
    } catch {
      return {};
    }
  }
}
