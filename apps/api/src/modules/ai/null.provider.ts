import { ServiceUnavailableException } from '@nestjs/common';
import type { AiCapabilities, AiProvider, DescribeInput, DescribeResult } from './ai.types';

/**
 * Active when AI is disabled. Reports no capabilities and politely refuses
 * operations instead of throwing unexpected errors — the platform runs fully
 * without any AI provider configured.
 */
export class NullAiProvider implements AiProvider {
  readonly id = 'null';
  readonly enabled = false;

  capabilities(): AiCapabilities {
    return {
      describe: false,
      tag: false,
      ocr: false,
      signature: false,
      compare: false,
      similar: false,
      classify: false,
    };
  }

  private unavailable(): never {
    throw new ServiceUnavailableException('AI features are disabled on this instance.');
  }

  describe(_input: DescribeInput): Promise<DescribeResult> {
    return this.unavailable();
  }
  ocr(_imageUrl: string): Promise<string> {
    return this.unavailable();
  }
  tags(_input: DescribeInput): Promise<string[]> {
    return this.unavailable();
  }
}
