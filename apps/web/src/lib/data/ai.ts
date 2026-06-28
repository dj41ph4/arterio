import { apiFetch } from '@/lib/api/client';
import type { Locale } from '@arterio/shared';

export interface ArtworkAutofillResult {
  description?: string;
  techniqueName?: string;
  dateText?: string;
  yearFrom?: number;
  dimensionsNote?: string;
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

export const aiApi = {
  autofillArtwork: (input: { title?: string; artistName?: string; locale: Locale }) =>
    apiFetch<ArtworkAutofillResult>('/ai/autofill/artwork', { method: 'POST', body: JSON.stringify(input) }),
  autofillArtist: (input: { fullName: string; locale: Locale }) =>
    apiFetch<ArtistAutofillResult>('/ai/autofill/artist', { method: 'POST', body: JSON.stringify(input) }),
};
