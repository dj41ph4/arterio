import { apiFetch } from '@/lib/api/client';

export interface MediaIndexBackfillStatus {
  running: boolean;
  done: number;
  total: number;
  indexed: number;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Visual indexing (phash + dominant colors) — powers color search, visual duplicates and similarity. */
export const mediaIndexApi = {
  start: () => apiFetch<MediaIndexBackfillStatus>('/artworks/media/backfill-index', { method: 'POST' }),
  status: () => apiFetch<MediaIndexBackfillStatus>('/artworks/media/backfill-index/status'),
};
