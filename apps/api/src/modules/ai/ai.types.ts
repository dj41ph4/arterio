import type { Locale } from '@arterio/shared';

/**
 * Provider-agnostic AI contract. Every enrichment capability the product will
 * eventually offer is declared here. Implementations are swappable and the whole
 * surface is gated behind `AI_ENABLED` — nothing calls a provider while off.
 */
export interface AiCapabilities {
  describe: boolean;
  tag: boolean;
  ocr: boolean;
  signature: boolean;
  compare: boolean;
  similar: boolean;
  classify: boolean;
}

export interface DescribeInput {
  imageUrl?: string;
  context?: Record<string, unknown>;
  locale: Locale;
  /** Lets a provider look up org-specific config (e.g. chosen OpenRouter models) instead of the env default. */
  organizationId?: string;
}

export interface DescribeResult {
  description: string;
  keywords: string[];
  suggestedCategory?: string;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiProvider {
  readonly id: string;
  /** Static "is this provider configured at all" flag — for org-aware providers, prefer isEnabled(). */
  readonly enabled: boolean;
  /** Whether AI is actually usable right now for this organization (checks org-level settings, falling back to env config). */
  isEnabled(organizationId?: string): Promise<boolean>;
  capabilities(): AiCapabilities;
  describe(input: DescribeInput): Promise<DescribeResult>;
  ocr(imageUrl: string): Promise<string>;
  tags(input: DescribeInput): Promise<string[]>;
}
