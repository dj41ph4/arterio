import { apiFetch } from '@/lib/api/client';
import type { Locale } from '@arterio/shared';

export interface SearchResults {
  artworks: Array<{ id: string; title: string; inventoryNumber: string; artist: string | null; thumbnailUrl: string | null; dominantColors: string[] }>;
  artists: Array<{ id: string; name: string; nationality: string | null; thumbnailUrl: string | null }>;
  documents: Array<{ id: string; title: string; type: string; artworkId: string | null; matchedInOcr: boolean }>;
  exhibitions: Array<{ id: string; title: string; venue: string | null; status: string }>;
}

export interface AiSearchFilters {
  search?: string;
  artistName?: string;
  status?: string[];
  condition?: string[];
  color?: string;
  yearFrom?: number;
  yearTo?: number;
  favorite?: boolean;
}

export const searchApi = {
  run: (q: string, locale: Locale) =>
    apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q)}&locale=${locale}`),
  /** Natural-language query → structured collection filters (one AI call, no data exposed to the model). */
  aiFilters: (query: string, locale: Locale) =>
    apiFetch<{ filters: AiSearchFilters; modelUsed: string | null }>('/ai/search-filters', {
      method: 'POST',
      body: JSON.stringify({ query, locale }),
    }),
};
