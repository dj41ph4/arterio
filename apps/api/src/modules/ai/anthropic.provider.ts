import type { AiCapabilities, AiProvider, DescribeInput, DescribeResult } from './ai.types';

/**
 * Claude-backed provider. Only instantiated when AI_ENABLED=true and
 * ANTHROPIC_API_KEY is set. The SDK import is intentionally lazy so the
 * module loads cleanly even when the dependency is absent in stripped builds.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly enabled = true;

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
}
