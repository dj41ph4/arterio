import { apiFetch } from '@/lib/api/client';
import type { Locale } from '@arterio/shared';

export interface ArtworkAutofillResult {
  description?: string;
  techniqueName?: string;
  dateText?: string;
  yearFrom?: number;
  heightCm?: number;
  widthCm?: number;
  dimensionsNote?: string;
  signatureDescription?: string;
  condition?: string;
  tags?: string[];
  imageUrl?: string;
}

export interface ArtistAutofillResult {
  biography?: string;
  nationality?: string;
  birthDate?: string;
  deathDate?: string;
  movement?: string;
  imageUrl?: string;
}

export interface AiAttemptLog {
  model: string;
  success: boolean;
  message: string;
}

export interface AiAutofillMeta {
  modelUsed?: string;
  fallbackUsed: boolean;
  attempts: AiAttemptLog[];
  /** Always present, success or failure — show this to the user instead of a generic toast. */
  message: string;
  hasUsableData: boolean;
}

export interface AiAutofillResponse<T> {
  data: T;
  meta: AiAutofillMeta;
}

export interface ImageSearchResult {
  images: string[];
  message: string;
}

export const aiApi = {
  autofillArtwork: (input: { title?: string; artistName?: string; locale: Locale }) =>
    apiFetch<AiAutofillResponse<ArtworkAutofillResult>>('/ai/autofill/artwork', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  autofillArtist: (input: { fullName: string; locale: Locale }) =>
    apiFetch<AiAutofillResponse<ArtistAutofillResult>>('/ai/autofill/artist', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** "Wiki" image search — WikiArt + Wikimedia Commons, no AI call. */
  findArtworkImagesWiki: (input: { title?: string; artistName?: string }) =>
    apiFetch<ImageSearchResult>('/ai/images/artwork', { method: 'POST', body: JSON.stringify(input) }),
  /** "IA" image search — AI-grounded web search, each candidate URL validated server-side before being returned. */
  findArtworkImagesAi: (input: { title?: string; artistName?: string }) =>
    apiFetch<ImageSearchResult>('/ai/images/artwork/ai', { method: 'POST', body: JSON.stringify(input) }),
  findArtistImagesWiki: (input: { fullName: string }) =>
    apiFetch<ImageSearchResult>('/ai/images/artist', { method: 'POST', body: JSON.stringify(input) }),
  findArtistImagesAi: (input: { fullName: string }) =>
    apiFetch<ImageSearchResult>('/ai/images/artist/ai', { method: 'POST', body: JSON.stringify(input) }),
};
