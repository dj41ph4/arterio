'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useSearchParams } from 'next/navigation';
import { Check, Star, Pencil, Trash2, X, LibraryBig, Upload, Plus, Merge } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ArtworkView, Locale, ArtworkQuery } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { toast } from 'sonner';
import { useArtworksInfinite, useToggleFavorite } from '@/hooks/use-artworks';
import { artworkRepository } from '@/lib/data';
import { useFacets } from '@/hooks/use-artworks';
import { useDebounce } from '@/hooks/use-debounce';
import { useRouter } from '@/i18n/navigation';
import { formatCurrency, formatDate, formatDimensions } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/app-shell/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArtworkThumbnail } from '@/components/artwork/thumbnail';
import { StatusBadge, ConditionBadge } from '@/components/artwork/status-badge';
import { FiltersBar, type ViewMode } from './filters-bar';
import { DataGrid } from './data-grid';
import { Gallery } from './gallery';
import { SpreadsheetGrid } from './spreadsheet-grid';
import { ImportModal } from '@/components/import/import-modal';
import { CollectionsManagerModal } from '@/components/collections/collections-manager-modal';
import { ArtworkFormModal } from '@/components/artwork/artwork-form-modal';
import { exportCollectionToXlsx } from '@/lib/import/export-spreadsheet';

const SORT_FIELD: Record<string, string> = {
  artwork: 'title',
  artist: 'artistName',
  date: 'yearFrom',
  value: 'value',
  updated: 'updatedAt',
  status: 'status',
  condition: 'condition',
  inventoryNumber: 'inventoryNumber',
  acquisitionDate: 'acquisitionDate',
  heightCm: 'heightCm',
  widthCm: 'widthCm',
  collectionName: 'collection',
};

function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'flex size-[18px] items-center justify-center rounded-[5px] border transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background hover:border-primary/60',
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}

export function CollectionView({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const toggleFav = useToggleFavorite();

  // Deep-link filters from cross-link buttons (exhibition card, location row…).
  const exhibitionId = searchParams.get('exhibitionId') ?? undefined;
  const exhibitionLabel = searchParams.get('exhibitionTitle');
  const locationId = searchParams.get('locationId') ?? undefined;
  const locationLabel = searchParams.get('locationName');

  const [rawSearch, setRawSearch] = React.useState('');
  const search = useDebounce(rawSearch, 250);
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [collectionFilter, setCollectionFilter] = React.useState<string[]>([]);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updated', desc: true }]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    inventoryNumber: false,
    acquisitionDate: false,
  });
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [viewMode, setViewMode] = React.useState<ViewMode>('table');
  const [importOpen, setImportOpen] = React.useState(false);
  const [collectionsOpen, setCollectionsOpen] = React.useState(false);
  const [artworkFormOpen, setArtworkFormOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const dedupMutation = useMutation({
    mutationFn: () => artworkRepository.autoMerge(),
    onSuccess: (report) => {
      qc.invalidateQueries({ queryKey: ['artworks'] });
      if (!report.merged.length) {
        toast.info('Aucun doublon détecté');
      } else {
        toast.success(
          `${report.merged.length} groupe${report.merged.length > 1 ? 's' : ''} fusionné${report.merged.length > 1 ? 's' : ''} — ${report.checked} œuvres analysées`,
        );
      }
    },
    onError: () => toast.error('Échec de la fusion automatique'),
  });

  const { data: facets } = useFacets();

  const query: Omit<ArtworkQuery, 'cursor' | 'limit'> = React.useMemo(
    () => ({
      search: search || undefined,
      status: statusFilter.length ? (statusFilter as ArtworkQuery['status']) : undefined,
      collectionId: collectionFilter.length ? collectionFilter : undefined,
      exhibitionId,
      locationId,
      favorite: favoritesOnly || undefined,
      sort: sorting[0]
        ? { field: SORT_FIELD[sorting[0].id] ?? sorting[0].id, dir: sorting[0].desc ? 'desc' : 'asc' }
        : undefined,
      locale,
    }),
    [search, statusFilter, collectionFilter, exhibitionId, locationId, sorting, favoritesOnly, locale],
  );

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useArtworksInfinite(query);

  const rows = React.useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;

  const columns = React.useMemo<ColumnDef<ArtworkView>[]>(
    () => [
      {
        id: 'select',
        size: 44,
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            onChange={(v) => table.toggleAllRowsSelected(v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox checked={row.getIsSelected()} onChange={(v) => row.toggleSelected(v)} />
        ),
      },
      {
        id: 'artwork',
        size: 300,
        enableHiding: false,
        header: () => <>{t('artwork.fields.title')}</>,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <ArtworkThumbnail
                colors={a.dominantColors}
                src={a.thumbnailUrl}
                className="size-10 shrink-0"
                rounded="md"
                showIcon={false}
              />
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {resolveLocalized(a.title, locale)}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {a.inventoryNumber}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        id: 'artist',
        size: 180,
        header: () => <>{t('artwork.fields.artist')}</>,
        cell: ({ row }) => (
          <span className="truncate text-foreground">{row.original.artistName ?? '—'}</span>
        ),
      },
      {
        id: 'inventoryNumber',
        size: 150,
        header: () => <>{t('artwork.fields.inventoryNumber')}</>,
        cell: ({ row }) => (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {row.original.inventoryNumber}
          </span>
        ),
      },
      {
        id: 'date',
        size: 110,
        header: () => <>{t('artwork.fields.date')}</>,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.dateText ?? '—'}</span>
        ),
      },
      {
        id: 'technique',
        size: 160,
        enableSorting: false,
        header: () => <>{t('artwork.fields.technique')}</>,
        cell: ({ row }) => (
          <span className="truncate text-muted-foreground">
            {row.original.techniqueName ?? '—'}
          </span>
        ),
      },
      {
        id: 'status',
        size: 150,
        header: () => <>{t('artwork.fields.status')}</>,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'condition',
        size: 120,
        header: () => <>{t('artwork.fields.condition')}</>,
        cell: ({ row }) => <ConditionBadge condition={row.original.condition} />,
      },
      {
        id: 'collection',
        size: 160,
        enableSorting: false,
        header: () => <>{t('artwork.fields.collection')}</>,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2 truncate text-muted-foreground">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: row.original.collectionColor ?? 'hsl(var(--muted-foreground))' }}
            />
            {row.original.collectionName ?? '—'}
          </span>
        ),
      },
      {
        id: 'dimensions',
        size: 140,
        enableSorting: false,
        header: () => <>{t('artwork.fields.dimensions')}</>,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatDimensions(row.original.heightCm, row.original.widthCm, row.original.depthCm)}
          </span>
        ),
      },
      {
        id: 'value',
        size: 130,
        header: () => <>{t('artwork.fields.insuranceValue')}</>,
        cell: ({ row }) => (
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(
              row.original.valuation?.insuranceValue,
              row.original.valuation?.currency ?? 'EUR',
              locale,
            )}
          </span>
        ),
      },
      {
        id: 'acquisitionDate',
        size: 130,
        header: () => <>{t('artwork.fields.acquisitionDate')}</>,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.acquisitionDate ? formatDate(row.original.acquisitionDate, locale) : '—'}
          </span>
        ),
      },
      {
        id: 'updated',
        size: 120,
        header: () => <>{t('artwork.fields.updatedAt')}</>,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{formatDate(row.original.updatedAt, locale)}</span>
        ),
      },
      {
        id: 'favorite',
        size: 56,
        enableSorting: false,
        header: () => <span className="sr-only">{t('nav.favorites')}</span>,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFav.mutate({ id: a.id, value: !a.isFavorite });
              }}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
              aria-label="Toggle favorite"
            >
              <Star
                className={cn(
                  'size-4 transition-colors',
                  a.isFavorite && 'fill-amber-400 text-amber-400',
                )}
              />
            </button>
          );
        },
      },
    ],
    [t, locale, toggleFav],
  );

  const columnLabels: Record<string, string> = {
    artwork: t('artwork.fields.title'),
    artist: t('artwork.fields.artist'),
    inventoryNumber: t('artwork.fields.inventoryNumber'),
    date: t('artwork.fields.date'),
    technique: t('artwork.fields.technique'),
    status: t('artwork.fields.status'),
    condition: t('artwork.fields.condition'),
    collection: t('artwork.fields.collection'),
    dimensions: t('artwork.fields.dimensions'),
    value: t('artwork.fields.insuranceValue'),
    acquisitionDate: t('artwork.fields.acquisitionDate'),
    updated: t('artwork.fields.updatedAt'),
    favorite: t('nav.favorites'),
  };

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: true,
  });

  const selectedCount = Object.keys(rowSelection).length;

  const handleBulkDelete = async () => {
    const ids = Object.keys(rowSelection);
    if (!ids.length) return;
    if (!confirm(`Mettre ${ids.length} œuvre(s) à la corbeille ?`)) return;
    try {
      await Promise.all(ids.map((id) => artworkRepository.remove(id)));
      toast.success(`${ids.length} œuvre(s) déplacée(s) vers la corbeille`);
      setRowSelection({});
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'artworks' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la suppression');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportCollectionToXlsx(locale);
      toast.success('Export terminé');
    } catch (err) {
      toast.error(err instanceof Error ? `Échec de l'export : ${err.message}` : "Échec de l'export");
    } finally {
      setExporting(false);
    }
  };

  const onReachEnd = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      <div className="space-y-4 p-4 pb-3 md:px-6">
        <PageHeader
          title={t('grid.title')}
          subtitle={t('grid.subtitle', { count: total })}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCollectionsOpen(true)}
                className="flex items-center gap-2"
              >
                <LibraryBig className="h-4 w-4" />
                {t('collections.title')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => dedupMutation.mutate()}
                disabled={dedupMutation.isPending}
                className="flex items-center gap-2"
                title="Détecte les œuvres en double (même titre + artiste) et fusionne en gardant la plus complète"
              >
                <Merge className={cn('h-4 w-4', dedupMutation.isPending && 'animate-pulse')} />
                {dedupMutation.isPending ? 'Analyse…' : 'Fusionner les doublons'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {t('common.import')}
              </Button>
              <Button
                size="sm"
                onClick={() => setArtworkFormOpen(true)}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                {t('grid.newArtwork')}
              </Button>
            </div>
          }
        />
        {(exhibitionId || locationId) && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <span className="text-foreground">
              Filtré par {exhibitionId ? 'exposition' : 'emplacement'} :{' '}
              <strong>{exhibitionLabel ?? locationLabel ?? '—'}</strong>
            </span>
            <button
              onClick={() => router.push('/collection')}
              className="ml-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <X className="h-3 w-3" /> Retirer le filtre
            </button>
          </div>
        )}
        <FiltersBar
          table={table}
          search={rawSearch}
          onSearch={setRawSearch}
          facets={facets}
          statusFilter={statusFilter}
          collectionFilter={collectionFilter}
          onToggleStatus={(v) =>
            setStatusFilter((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))
          }
          onToggleCollection={(v) =>
            setCollectionFilter((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))
          }
          onClearFilters={() => {
            setStatusFilter([]);
            setCollectionFilter([]);
          }}
          viewMode={viewMode}
          onViewMode={setViewMode}
          columnLabels={columnLabels}
          onExport={handleExport}
          exporting={exporting}
        />
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="space-y-2 px-4 md:px-6">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState onCreate={() => setArtworkFormOpen(true)} />
      ) : viewMode === 'table' ? (
        <DataGrid
          table={table}
          onRowClick={(id) => router.push(`/artworks/${id}`)}
          onReachEnd={onReachEnd}
        />
      ) : viewMode === 'sheet' ? (
        <SpreadsheetGrid
          items={rows}
          onReachEnd={onReachEnd}
          sorting={sorting}
          onSort={(sortKey) =>
            setSorting((prev) =>
              prev[0]?.id === sortKey ? [{ id: sortKey, desc: !prev[0].desc }] : [{ id: sortKey, desc: false }],
            )
          }
        />
      ) : (
        <div className="flex-1 overflow-auto scrollbar-thin border-t border-border">
          <Gallery items={rows} />
        </div>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4"
          >
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-popover/95 p-1.5 pl-4 shadow-floating backdrop-blur">
              <span className="text-sm font-medium">
                {t('grid.selectedCount', { count: selectedCount })}
              </span>
              <div className="mx-1 h-5 w-px bg-border" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => toast.info(t('grid.bulkEdit', { count: selectedCount }))}
              >
                <Pencil className="size-3.5" /> {t('common.edit')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={handleBulkDelete}
              >
                <Trash2 className="size-3.5" /> {t('common.delete')}
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => setRowSelection({})}>
                <X className="size-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <CollectionsManagerModal open={collectionsOpen} onClose={() => setCollectionsOpen(false)} />
      <ArtworkFormModal open={artworkFormOpen} onClose={() => setArtworkFormOpen(false)} />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('grid');
  return (
    <div className="flex flex-1 items-center justify-center border-t border-border bg-dotted">
      <div className="flex max-w-sm flex-col items-center px-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LibraryBig className="size-7" />
        </span>
        <h3 className="mt-4 font-display text-lg font-semibold">{t('emptyTitle')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('emptyBody')}</p>
        <Button className="mt-5" onClick={onCreate}>{t('newArtwork')}</Button>
      </div>
    </div>
  );
}
