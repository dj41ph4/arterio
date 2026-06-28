import { apiFetch } from '@/lib/api/client';
import type { Locale } from '@arterio/shared';

export interface ArtworkAutofillResult {
  description?: string;
  techniqueName?: string;
  dateText?: string;
  yearFrom?: number;
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
};
