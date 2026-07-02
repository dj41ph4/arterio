'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { collectionRepository, type CollectionInput } from '@/lib/data/collection-repository';

export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: () => collectionRepository.list(),
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CollectionInput) => collectionRepository.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
    },
  });
}

export function useUpdateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CollectionInput> }) =>
      collectionRepository.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => collectionRepository.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['facets'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
