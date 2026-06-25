'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ArtworkQuery, ArtworkView } from '@arterio/shared';
import { artworkRepository } from '@/lib/data';

const PAGE_SIZE = 50;

export function useArtworksInfinite(query: Omit<ArtworkQuery, 'cursor' | 'limit'>) {
  return useInfiniteQuery({
    queryKey: ['artworks', query],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      artworkRepository.list({ ...query, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useArtwork(id: string) {
  return useQuery({
    queryKey: ['artwork', id],
    queryFn: () => artworkRepository.getById(id),
  });
}

export function useFacets() {
  return useQuery({ queryKey: ['facets'], queryFn: () => artworkRepository.facets() });
}

export function useDashboardStats() {
  return useQuery({ queryKey: ['stats'], queryFn: () => artworkRepository.stats() });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      artworkRepository.toggleFavorite(id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artworks'] });
      qc.invalidateQueries({ queryKey: ['artwork'] });
    },
  });
}

export function useUpdateArtwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ArtworkView> }) =>
      artworkRepository.update(id, patch),
    onSuccess: (updated) => {
      qc.setQueryData(['artwork', updated.id], updated);
      qc.invalidateQueries({ queryKey: ['artworks'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
    },
  });
}

export function useCreateArtwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ArtworkView>) => artworkRepository.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artworks'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
    },
  });
}

export function useDeleteArtwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => artworkRepository.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artworks'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
    },
  });
}
