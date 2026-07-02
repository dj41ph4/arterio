import { ServiceUnavailableException } from '@nestjs/common';
import type {
  AiAutofillResponse,
  AiCapabilities,
  AiChatInput,
  AiChatTurn,
  AiOcrInput,
  AiOcrResult,
  AiProvider,
  AiVisionInput,
  AiVisionResult,
  ArtistAutofillInput,
  ArtistAutofillResult,
  ArtworkAutofillInput,
  ArtworkAutofillResult,
  DescribeInput,
  DescribeResult,
  FindImagesInput,
  FindImagesResult,
  TranslateInput,
} from './ai.types';

/**
 * Active when AI is disabled. Reports no capabilities and politely refuses
 * operations instead of throwing unexpected errors — the platform runs fully
 * without any AI provider configured.
 */
export class NullAiProvider implements AiProvider {
  readonly id = 'null';
  readonly enabled = false;

  async isEnabled(): Promise<boolean> {
    return false;
  }

  capabilities(): AiCapabilities {
    return {
      describe: false,
      tag: false,
      ocr: false,
      signature: false,
      compare: false,
      similar: false,
      classify: false,
      chat: false,
      vision: false,
    };
  }

  private unavailable(): never {
    throw new ServiceUnavailableException('AI features are disabled on this instance.');
  }

  describe(_input: DescribeInput): Promise<DescribeResult> {
    return this.unavailable();
  }
  ocr(_input: AiOcrInput): Promise<AiOcrResult> {
    return this.unavailable();
  }
  chat(_input: AiChatInput): Promise<AiChatTurn> {
    return this.unavailable();
  }
  analyzeImage(_input: AiVisionInput): Promise<AiVisionResult> {
    return this.unavailable();
  }
  tags(_input: DescribeInput): Promise<string[]> {
    return this.unavailable();
  }
  autofillArtwork(_input: ArtworkAutofillInput): Promise<AiAutofillResponse<ArtworkAutofillResult>> {
    return this.unavailable();
  }
  autofillArtist(_input: ArtistAutofillInput): Promise<AiAutofillResponse<ArtistAutofillResult>> {
    return this.unavailable();
  }
  /** Translation is best-effort enrichment, not a user-facing action — return null rather than throwing when AI is off. */
  async translate(_input: TranslateInput): Promise<string | null> {
    return null;
  }
  findImages(_input: FindImagesInput): Promise<AiAutofillResponse<FindImagesResult>> {
    return this.unavailable();
  }
}
