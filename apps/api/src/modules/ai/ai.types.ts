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

export interface ArtworkAutofillInput {
  title?: string;
  artistName?: string;
  locale: Locale;
  organizationId?: string;
}

export interface ArtworkAutofillResult {
  description?: string;
  techniqueName?: string;
  dateText?: string;
  yearFrom?: number;
  dimensionsNote?: string;
  condition?: string;
  tags?: string[];
  /** Best-effort — only set when the model recalls an actual public image URL for this work; never fabricated. */
  imageUrl?: string;
}

export interface ArtistAutofillInput {
  fullName: string;
  locale: Locale;
  organizationId?: string;
}

export interface ArtistAutofillResult {
  biography?: string;
  nationality?: string;
  birthDate?: string;
  deathDate?: string;
  movement?: string;
  imageUrl?: string;
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
  autofillArtwork(input: ArtworkAutofillInput): Promise<ArtworkAutofillResult>;
  autofillArtist(input: ArtistAutofillInput): Promise<ArtistAutofillResult>;
}
