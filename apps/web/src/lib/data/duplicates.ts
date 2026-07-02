import { apiFetch } from '@/lib/api/client';
import type { ArtworkView } from '@arterio/shared';

export interface VisualDuplicateGroup {
  artworks: ArtworkView[];
  /** 0-100 — perceptual-hash proximity of the closest image pair in the group. */
  similarity: number;
}

export const duplicatesApi = {
  findVisual: () =>
    apiFetch<{ groups: VisualDuplicateGroup[]; comparedImages: number }>('/artworks/duplicates/visual'),
  merge: (canonicalId: string, duplicateIds: string[]) =>
    apiFetch<{ ok: boolean }>('/artworks/merge', { method: 'POST', body: JSON.stringify({ canonicalId, duplicateIds }) }),
};
