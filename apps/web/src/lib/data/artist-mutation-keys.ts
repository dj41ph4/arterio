/**
 * Shared TanStack Query mutationKey for artist enrichment, used by every
 * surface that can trigger it (list per-card retry, list bulk retry, the
 * profile page button, the edit-artist Wiki button). The QueryClient/mutation
 * cache lives above route changes (see components/providers.tsx), so any
 * component — even one mounted fresh after navigation — can ask
 * useMutationState whether an enrich() call for a given artist id is still
 * pending, instead of relying on local component state that resets on unmount.
 */
export const ENRICH_ARTIST_MUTATION_KEY = ['enrich-artist'] as const;

/** Same survives-navigation reasoning as ENRICH_ARTIST_MUTATION_KEY, for the "Fusionner les doublons" bulk action. */
export const MERGE_ARTISTS_MUTATION_KEY = ['merge-artists'] as const;
