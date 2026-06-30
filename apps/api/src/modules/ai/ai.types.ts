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
  /** Free, key-less web-search context (see common/free-web-search.util.ts) — appended to the prompt so a provider with no native/paid search of its own still gets real grounding. Optional: providers ignore it if absent. */
  searchContext?: string;
}

export interface ArtworkAutofillResult {
  description?: string;
  techniqueName?: string;
  dateText?: string;
  yearFrom?: number;
  /** Height in cm — when a source gives "20x30 cm", the larger dimension convention is height x width; parsed out of dimensionsNote, not left as text-only. */
  heightCm?: number;
  widthCm?: number;
  /** Raw dimension text as found in the source (may include extra detail beyond height/width, e.g. a frame size) — kept alongside the parsed numbers, never instead of them. */
  dimensionsNote?: string;
  /** Where/how the work is signed, e.g. "signé en bas à droite" — important for authentication. */
  signatureDescription?: string;
  condition?: string;
  tags?: string[];
  /** Best-effort — only set when the model recalls an actual public image URL for this work; never fabricated. */
  imageUrl?: string;
}

export interface ArtistAutofillInput {
  fullName: string;
  locale: Locale;
  organizationId?: string;
  /** Free, key-less web-search context (see common/free-web-search.util.ts) — appended to the prompt so a provider with no native/paid search of its own still gets real grounding. Optional: providers ignore it if absent. */
  searchContext?: string;
}

export interface ArtistAutofillResult {
  biography?: string;
  nationality?: string;
  birthDate?: string;
  deathDate?: string;
  movement?: string;
  imageUrl?: string;
}

export interface TranslateInput {
  text: string;
  targetLocale: Locale;
  sourceLocale?: Locale;
  organizationId?: string;
}

export interface FindImagesInput {
  /** Free-text search-engine-style query, e.g. `Picasso "The Old Guitarist" photo painting image`. */
  query: string;
  organizationId?: string;
  /** Free, key-less web-search context (see common/free-web-search.util.ts) — appended to the prompt so a provider with no native/paid search of its own still gets real grounding. Optional: providers ignore it if absent. */
  searchContext?: string;
}

export interface FindImagesResult {
  /** Real image URLs found in search results — never invented. Each one is still HEAD-validated by the caller before being trusted. */
  imageUrls?: string[];
}

/** One model attempt, in human terms — surfaced to both server logs and the UI so a failure is never a silent/raw JSON blob. */
export interface AiAttemptLog {
  model: string;
  success: boolean;
  /** Human-readable, e.g. "Clé API invalide ou refusée (401)" or "Réponse reçue avec succès". */
  message: string;
  /** Which provider made this attempt ("openrouter" | "gemini" | ...) — set when multiple providers may be chained, so usage logging attributes calls correctly. */
  provider?: string;
}

export interface AiAutofillMeta {
  modelUsed?: string;
  fallbackUsed: boolean;
  attempts: AiAttemptLog[];
  /** One-sentence, human-readable summary of what happened overall — always present, success or failure. */
  message: string;
  /** True only when at least one real field was extracted from the model's response. */
  hasUsableData: boolean;
}

export interface AiAutofillResponse<T> {
  data: T;
  meta: AiAutofillMeta;
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
  autofillArtwork(input: ArtworkAutofillInput): Promise<AiAutofillResponse<ArtworkAutofillResult>>;
  autofillArtist(input: ArtistAutofillInput): Promise<AiAutofillResponse<ArtistAutofillResult>>;
  /** Best-effort — returns null (never throws) on any failure, so a translation gap never blocks enrichment. */
  translate(input: TranslateInput): Promise<string | null>;
  /** Dedicated multi-image search (the "IA" image-search button) — separate from autofill's single best-effort imageUrl, this asks for as many real candidates as the search turns up. */
  findImages(input: FindImagesInput): Promise<AiAutofillResponse<FindImagesResult>>;
  /** Settings → AI "Tester la connexion" button — exactly ONE minimal request to verify a key actually works, with the real success/error message surfaced (not swallowed like translate()'s null-on-failure contract). Optional: not every provider needs it. */
  testConnection?(organizationId?: string): Promise<{ success: boolean; message: string }>;
}
