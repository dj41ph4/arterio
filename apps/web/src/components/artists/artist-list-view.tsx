'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Search, Users, Sparkles, RefreshCw, SearchX, Merge, Upload } from 'lucide-react';
import { useQuery, useMutation, useMutationState } from '@tanstack/react-query';
import { toast } from 'sonner';
import { artistRepository } from '@/lib/data/artist-repository';
import { PageHeader } from '@/components/app-shell/page-header';
import { translateNationality } from '@/lib/nationality';
import { cn } from '@/lib/utils';
import { AddArtistModal } from './add-artist-modal';
import { ImportModal } from '@/components/import/import-modal';
import { useQueryClient } from '@tanstack/react-query';
import { ENRICH_ARTIST_MUTATION_KEY, MERGE_ARTISTS_MUTATION_KEY } from '@/lib/data/artist-mutation-keys';
import type { ArtistView } from '@/lib/data/artist-repository';
import type { Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';

function ArtistCard({
  artist,
  locale,
  onClick,
  onRetryEnrich,
  retrying,
}: {
  artist: ArtistView;
  locale: Locale;
  onClick: () => void;
  onRetryEnrich: (e: React.MouseEvent) => void;
  retrying: boolean;
}) {
  const t = useTranslations();
  const notEnriched = !artist.externalIds.wikidata;
  const initials = artist.fullName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const years = [artist.birthDate?.slice(0, 4), artist.deathDate?.slice(0, 4)]
    .filter(Boolean)
    .join(' – ');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      onClick={onClick}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Portrait */}
      <div className="relative h-40 overflow-hidden bg-muted">
        {artist.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artist.thumbnail}
            alt={artist.fullName}
            className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-4xl font-semibold text-muted-foreground">{initials}</span>
          </div>
        )}
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        {/* Movement badge */}
        {artist.movement && (
          <span className="absolute bottom-2 left-3 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {resolveLocalized(artist.movement.label, locale) || artist.movement.name}
          </span>
        )}
        {/* Not-enriched retry button */}
        {notEnriched && (
          <button
            onClick={onRetryEnrich}
            disabled={retrying}
            title="Réessayer l'enrichissement Wikipédia/Wikidata"
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-primary disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="font-semibold text-foreground leading-snug">{artist.fullName}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {artist.nationality && <span>{translateNationality(artist.nationality, locale)}</span>}
          {years && (
            <>
              {artist.nationality && <span>·</span>}
              <span>{years}</span>
            </>
          )}
        </div>
        <div className="mt-auto pt-3 flex items-center justify-between border-t border-border">
          <span className="text-xs text-muted-foreground">
            {t('artists.worksInCollection', { count: artist.artworkCount })}
          </span>
          {Object.keys(artist.externalIds).length > 0 && (
            <span className="text-[10px] text-primary">
              {Object.keys(artist.externalIds).map((k) => k.toUpperCase()).join(' · ')}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function ArtistListView() {
  const t = useTranslations();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [unenrichedOnly, setUnenrichedOnly] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const qc = useQueryClient();

  const pendingMerge = useMutationState({
    filters: { mutationKey: MERGE_ARTISTS_MUTATION_KEY, status: 'pending' },
  }).length > 0;

  const mergeMutation = useMutation({
    mutationKey: MERGE_ARTISTS_MUTATION_KEY,
    mutationFn: () => artistRepository.autoMerge(),
    onSuccess: (report) => {
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      if (!report.merged.length && !report.flagged.length) {
        toast.info('Aucun doublon détecté');
        return;
      }
      if (report.merged.length) {
        toast.success(
          `${report.merged.length} groupe${report.merged.length > 1 ? 's' : ''} fusionné${report.merged.length > 1 ? 's' : ''} : ` +
          report.merged.map((m) => `${m.canonicalName} (${m.confidence}%)`).join(', '),
        );
      }
      if (report.flagged.length) {
        toast.warning(`${report.flagged.length} groupe${report.flagged.length > 1 ? 's' : ''} ambigu${report.flagged.length > 1 ? 's' : ''} laissé${report.flagged.length > 1 ? 's' : ''} de côté (vérification manuelle nécessaire)`);
      }
    },
    onError: () => toast.error('Échec de la fusion automatique'),
  });

  // Fetches every page up front — the backend caps a single page at 50/200,
  // but this view renders the whole roster as cards with client-side search,
  // not a paginated table, so partial loading just looks like missing data.
  const { data: allArtists = [], isLoading } = useQuery({
    queryKey: ['artists-all'],
    queryFn: async () => {
      const all: ArtistView[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await artistRepository.list({ cursor: cursor ?? undefined, limit: 200 });
        all.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
      return all;
    },
    staleTime: 30_000,
  });

  const unenrichedCount = allArtists.filter((a) => !a.externalIds.wikidata).length;
  const searchLower = search.trim().toLowerCase();
  const artists = allArtists.filter((a) => {
    if (unenrichedOnly && a.externalIds.wikidata) return false;
    if (!searchLower) return true;
    return (
      a.fullName.toLowerCase().includes(searchLower) ||
      a.nationality?.toLowerCase().includes(searchLower) ||
      a.movement?.name.toLowerCase().includes(searchLower)
    );
  });

  // pendingEnrichIds reflects the shared mutation cache, which survives this
  // component unmounting/remounting (e.g. navigating away and back) — so a
  // retry triggered before navigating still shows as in-progress on return,
  // instead of resetting to idle just because the component was recreated.
  const pendingEnrichIds = useMutationState({
    filters: { mutationKey: ENRICH_ARTIST_MUTATION_KEY, status: 'pending' },
    select: (m) => m.state.variables as string,
  });

  const retryMutation = useMutation({
    mutationKey: ENRICH_ARTIST_MUTATION_KEY,
    mutationFn: (id: string) => artistRepository.enrich(id),
    onMutate: (id) => setRetryingId(id),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      if (updated.externalIds.wikidata) {
        toast.success(`${updated.fullName} — enrichissement trouvé`);
      } else {
        toast.error(`${updated.fullName} — toujours introuvable (vérifiez l'orthographe du nom)`);
      }
    },
    onError: () => toast.error("Échec de l'enrichissement — réessayez plus tard"),
    onSettled: () => setRetryingId(null),
  });

  // The bulk re-enrichment job itself runs entirely server-side (see
  // ArtistService.startBulkEnrich) — this query just polls its progress, so
  // navigating away and back (or even reloading) picks the same job back up
  // instead of restarting or silently losing track of it. Polling itself
  // only happens while this component is mounted; the job keeps running on
  // the server regardless.
  const { data: bulkStatus } = useQuery({
    queryKey: ['artists-bulk-enrich-status'],
    queryFn: () => artistRepository.getBulkEnrichStatus(),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  });

  const startBulkMutation = useMutation({
    mutationFn: () => artistRepository.startBulkEnrich(),
    onSuccess: (status) => qc.setQueryData(['artists-bulk-enrich-status'], status),
    onError: () => toast.error("Échec du lancement de l'enrichissement groupé"),
  });

  // Fires the "N / M retrouvés" summary toast exactly once, the moment the
  // polled status flips from running to finished — works the same whether
  // this component was mounted the whole time or just remounted on return.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!bulkStatus) return;
    if (wasRunning.current && !bulkStatus.running) {
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      toast.success(`${bulkStatus.resolved} / ${bulkStatus.total} artiste${bulkStatus.total > 1 ? 's' : ''} retrouvé${bulkStatus.resolved > 1 ? 's' : ''}`);
    }
    wasRunning.current = bulkStatus.running;
  }, [bulkStatus, qc]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 pb-3 md:px-6">
        <PageHeader
          title={t('nav.artists')}
          subtitle={t('artists.subtitle', { count: artists.length })}
          actions={
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Nouvel artiste
            </button>
          }
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border bg-background px-6 py-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('artists.searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-4 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>
        {unenrichedCount > 0 && (
          <button
            onClick={() => setUnenrichedOnly((v) => !v)}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              unenrichedOnly
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            <SearchX className="h-4 w-4" />
            Non trouvés ({unenrichedCount})
          </button>
        )}
        {unenrichedCount > 0 && (
          <button
            onClick={() => startBulkMutation.mutate()}
            disabled={bulkStatus?.running || startBulkMutation.isPending}
            title="Tourne en arrière-plan sur le serveur — continue même si vous changez de page"
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={cn('h-4 w-4', bulkStatus?.running && 'animate-spin')} />
            {bulkStatus?.running ? `${bulkStatus.done} / ${bulkStatus.total}…` : 'Tout réessayer'}
          </button>
        )}
        <button
          onClick={() => mergeMutation.mutate()}
          disabled={mergeMutation.isPending || pendingMerge}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
          title="Détecte les artistes en double (variantes de nom) et les fusionne après vérification Wikidata"
        >
          <Merge className={cn('h-4 w-4', (mergeMutation.isPending || pendingMerge) && 'animate-pulse')} />
          {mergeMutation.isPending || pendingMerge ? 'Analyse…' : 'Fusionner les doublons'}
        </button>
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          title="Importer un fichier CSV/Excel — un fichier nom/biographie/photo par artiste est détecté automatiquement"
        >
          <Upload className="h-4 w-4" />
          Importer
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : artists.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Users className="h-10 w-10 opacity-40" />
            <p className="text-sm">{t('common.noResults')}</p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4"
            layout
          >
            {artists.map((artist) => (
              <ArtistCard
                key={artist.id}
                artist={artist}
                locale={locale as Locale}
                onClick={() => router.push(`/${locale}/artists/${artist.id}`)}
                onRetryEnrich={(e) => { e.stopPropagation(); retryMutation.mutate(artist.id); }}
                retrying={retryingId === artist.id || pendingEnrichIds.includes(artist.id)}
              />
            ))}
          </motion.div>
        )}
      </div>

      <AddArtistModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(artist) => {
          qc.invalidateQueries({ queryKey: ['artists-all'] });
          router.push(`/${locale}/artists/${artist.id}`);
        }}
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
