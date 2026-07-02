'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, RefreshCw, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import type { SortingState } from '@tanstack/react-table';
import { ARTWORK_STATUS, CONDITION_RATING } from '@arterio/shared';
import type { ArtworkView, Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { useCreateArtwork, useUpdateArtwork } from '@/hooks/use-artworks';
import { artworkRepository } from '@/lib/data';
import { ArtworkThumbnail } from '@/components/artwork/thumbnail';
import { cn } from '@/lib/utils';

type ColType = 'text' | 'number' | 'status' | 'condition';

interface SheetColumn {
  id: string;
  label: string;
  width: number;
  type: ColType;
  readOnly?: boolean;
  /** Key understood by the parent's sort state — omit if this column can't be sorted server-side. */
  sortKey?: string;
  getValue: (a: ArtworkView, locale: Locale) => string;
  buildPatch?: (raw: string) => Partial<ArtworkView>;
}

const ROW_HEIGHT = 36;

export function SpreadsheetGrid({
  items,
  onReachEnd,
  sorting,
  onSort,
}: {
  items: ArtworkView[];
  sorting?: SortingState;
  onSort?: (sortKey: string) => void;
  onReachEnd: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const qc = useQueryClient();
  const updateArtwork = useUpdateArtwork();
  const createArtwork = useCreateArtwork();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadTargetRef = React.useRef<string | null>(null);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ row: number; col: number } | null>(null);
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | HTMLSelectElement>(null);

  const openFilePicker = (artworkId: string) => {
    uploadTargetRef.current = artworkId;
    fileInputRef.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = uploadTargetRef.current;
    e.target.value = '';
    if (!file || !targetId) return;
    setUploadingId(targetId);
    try {
      await artworkRepository.uploadMedia(targetId, file);
      toast.success(t('grid.cellSaved'));
      qc.invalidateQueries({ queryKey: ['artworks'] });
      qc.invalidateQueries({ queryKey: ['artwork', targetId] });
    } catch {
      toast.error(t('grid.cellSaveFailed'));
    } finally {
      setUploadingId(null);
    }
  };

  const handleAddRow = async () => {
    const created = await createArtwork.mutateAsync({});
    openFilePicker(created.id);
  };

  const columns = React.useMemo<SheetColumn[]>(
    () => [
      {
        id: 'thumb',
        label: '',
        width: 48,
        type: 'text',
        readOnly: true,
        getValue: () => '',
      },
      {
        id: 'inventoryNumber',
        label: t('artwork.fields.inventoryNumber'),
        width: 140,
        type: 'text',
        sortKey: 'inventoryNumber',
        getValue: (a) => a.inventoryNumber ?? '',
        buildPatch: (raw) => ({ inventoryNumber: raw }),
      },
      {
        id: 'title',
        label: t('artwork.fields.title'),
        width: 260,
        type: 'text',
        getValue: (a, loc) => resolveLocalized(a.title, loc) ?? '',
        buildPatch: (raw) => ({ title: { [locale]: raw } as ArtworkView['title'] }),
      },
      {
        id: 'artistName',
        label: t('artwork.fields.artist'),
        width: 180,
        type: 'text',
        readOnly: true,
        sortKey: 'artist',
        getValue: (a) => a.artistName ?? '',
      },
      {
        id: 'dateText',
        label: t('artwork.fields.date'),
        width: 110,
        type: 'text',
        sortKey: 'date',
        getValue: (a) => a.dateText ?? '',
        buildPatch: (raw) => ({ dateText: raw || null }),
      },
      {
        id: 'heightCm',
        label: 'H (cm)',
        width: 80,
        type: 'number',
        getValue: (a) => (a.heightCm ?? '') as string,
        buildPatch: (raw) => ({ heightCm: raw === '' ? null : Number(raw) }),
      },
      {
        id: 'widthCm',
        label: 'L (cm)',
        width: 80,
        type: 'number',
        getValue: (a) => (a.widthCm ?? '') as string,
        buildPatch: (raw) => ({ widthCm: raw === '' ? null : Number(raw) }),
      },
      {
        id: 'depthCm',
        label: 'P (cm)',
        width: 80,
        type: 'number',
        getValue: (a) => (a.depthCm ?? '') as string,
        buildPatch: (raw) => ({ depthCm: raw === '' ? null : Number(raw) }),
      },
      {
        id: 'status',
        label: t('artwork.fields.status'),
        width: 150,
        type: 'status',
        sortKey: 'status',
        getValue: (a) => a.status,
        buildPatch: (raw) => ({ status: raw as ArtworkView['status'] }),
      },
      {
        id: 'condition',
        label: t('artwork.fields.condition'),
        width: 130,
        type: 'condition',
        sortKey: 'condition',
        getValue: (a) => a.condition,
        buildPatch: (raw) => ({ condition: raw as ArtworkView['condition'] }),
      },
      {
        id: 'insuranceValue',
        label: t('artwork.fields.insuranceValue'),
        width: 130,
        type: 'number',
        getValue: (a) => (a.valuation?.insuranceValue ?? '') as string,
        buildPatch: (raw) =>
          ({ valuation: { insuranceValue: raw === '' ? null : Number(raw) } } as Partial<ArtworkView>),
      },
      {
        id: 'collectionName',
        label: t('artwork.fields.collection'),
        width: 160,
        type: 'text',
        readOnly: true,
        getValue: (a) => a.collectionName ?? '',
      },
    ],
    [t, locale],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });
  const virtualItems = virtualizer.getVirtualItems();

  React.useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (last && last.index >= items.length - 8) onReachEnd();
  }, [virtualItems, items.length, onReachEnd]);

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
    }
  }, [editing]);

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const leftOffsets = React.useMemo(() => {
    const map: number[] = [];
    let acc = 0;
    for (const c of columns) {
      map.push(acc);
      acc += c.width;
    }
    return map;
  }, [columns]);

  const commit = React.useCallback(
    (row: number, col: number, raw: string) => {
      const column = columns[col]!;
      if (column.readOnly || !column.buildPatch) return;
      const artwork = items[row]!;
      const patch = column.buildPatch(raw);
      updateArtwork.mutate(
        { id: artwork.id, patch },
        {
          onError: () => toast.error(t('grid.cellSaveFailed')),
        },
      );
    },
    [columns, items, updateArtwork, t],
  );

  const moveTo = (row: number, col: number) => {
    const clampedRow = Math.max(0, Math.min(items.length - 1, row));
    let clampedCol = col;
    // Skip read-only / thumbnail columns when navigating with keys.
    while (clampedCol >= 0 && clampedCol < columns.length && columns[clampedCol]!.readOnly) {
      clampedCol += col > (editing?.col ?? -1) ? 1 : -1;
    }
    clampedCol = Math.max(1, Math.min(columns.length - 1, clampedCol));
    const column = columns[clampedCol]!;
    setEditing({ row: clampedRow, col: clampedCol });
    setDraft(column.getValue(items[clampedRow]!, locale));
  };

  const startEdit = (row: number, col: number) => {
    const column = columns[col]!;
    if (column.readOnly) return;
    setEditing({ row, col });
    setDraft(column.getValue(items[row]!, locale));
  };

  const endEdit = (commitChange: boolean) => {
    if (editing && commitChange) commit(editing.row, editing.col, draft);
    setEditing(null);
  };

  const onCellKeyDown = (e: React.KeyboardEvent, row: number, col: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      endEdit(true);
      moveTo(row + 1, col);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      endEdit(true);
      moveTo(row, col + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      endEdit(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100dvh-13.5rem)] overflow-auto scrollbar-thin border-t border-border"
    >
      <div style={{ width: totalWidth, minWidth: '100%' }}>
        {/* Header */}
        <div className="sticky top-0 z-20 flex border-b border-border bg-muted/60 backdrop-blur">
          {columns.map((c) => {
            const sorted = c.sortKey && sorting?.[0]?.id === c.sortKey ? (sorting[0]!.desc ? 'desc' : 'asc') : false;
            return (
              <div
                key={c.id}
                style={{ width: c.width }}
                onClick={c.sortKey ? () => onSort?.(c.sortKey!) : undefined}
                className={cn(
                  'flex h-9 shrink-0 items-center border-r border-border/50 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
                  c.sortKey && 'cursor-pointer select-none hover:text-foreground',
                )}
              >
                <span className="truncate">{c.label}</span>
                {c.sortKey && (
                  <span className="ml-1 shrink-0 text-muted-foreground/70">
                    {sorted === 'asc' ? (
                      <ArrowUp className="size-3" />
                    ) : sorted === 'desc' ? (
                      <ArrowDown className="size-3" />
                    ) : (
                      <ChevronsUpDown className="size-3 opacity-40" />
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualItems.map((vi) => {
            const row = vi.index;
            const artwork = items[row]!;
            return (
              <div
                key={artwork.id}
                style={{ transform: `translateY(${vi.start}px)`, height: ROW_HEIGHT }}
                className="absolute left-0 top-0 flex w-full border-b border-border/40"
              >
                {columns.map((c, col) => {
                  const isEditing = editing?.row === row && editing?.col === col;
                  if (c.id === 'thumb') {
                    const isUploading = uploadingId === artwork.id;
                    return (
                      <div
                        key={c.id}
                        style={{ width: c.width }}
                        onClick={() => !isUploading && openFilePicker(artwork.id)}
                        title={t('grid.viewSheet')}
                        className="flex shrink-0 cursor-pointer items-center justify-center border-r border-border/30 py-1 transition-opacity hover:opacity-70"
                      >
                        {isUploading ? (
                          <RefreshCw className="size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <ArtworkThumbnail
                            colors={artwork.dominantColors}
                            src={artwork.thumbnailUrl}
                            className="size-7"
                            rounded="sm"
                            showIcon={false}
                          />
                        )}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={c.id}
                      style={{ width: c.width }}
                      onClick={() => !isEditing && startEdit(row, col)}
                      className={cn(
                        'flex shrink-0 items-center border-r border-border/30 px-2.5 text-sm',
                        c.readOnly ? 'text-muted-foreground' : 'cursor-cell text-foreground hover:bg-muted/30',
                        isEditing && 'ring-2 ring-inset ring-primary',
                      )}
                    >
                      {isEditing ? (
                        c.type === 'status' ? (
                          <select
                            ref={inputRef as React.RefObject<HTMLSelectElement>}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => endEdit(true)}
                            onKeyDown={(e) => onCellKeyDown(e, row, col)}
                            className="h-full w-full bg-transparent text-sm outline-none"
                          >
                            {ARTWORK_STATUS.map((s) => (
                              <option key={s} value={s}>{t(`status.${s}`)}</option>
                            ))}
                          </select>
                        ) : c.type === 'condition' ? (
                          <select
                            ref={inputRef as React.RefObject<HTMLSelectElement>}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => endEdit(true)}
                            onKeyDown={(e) => onCellKeyDown(e, row, col)}
                            className="h-full w-full bg-transparent text-sm outline-none"
                          >
                            {CONDITION_RATING.map((s) => (
                              <option key={s} value={s}>{t(`condition.${s}`)}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            ref={inputRef as React.RefObject<HTMLInputElement>}
                            type={c.type === 'number' ? 'number' : 'text'}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => endEdit(true)}
                            onKeyDown={(e) => onCellKeyDown(e, row, col)}
                            className="h-full w-full bg-transparent text-sm outline-none"
                          />
                        )
                      ) : c.type === 'status' ? (
                        <span className="truncate">{t(`status.${artwork.status}`)}</span>
                      ) : c.type === 'condition' ? (
                        <span className="truncate">{t(`condition.${artwork.condition}`)}</span>
                      ) : (
                        <span className="truncate tabular-nums">{c.getValue(artwork, locale)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Add-row */}
        <button
          onClick={handleAddRow}
          disabled={createArtwork.isPending}
          style={{ width: totalWidth }}
          className="flex h-9 items-center gap-2 border-b border-border/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:opacity-50"
        >
          {createArtwork.isPending ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          {t('grid.newArtwork')}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFilePicked}
      />
    </div>
  );
}
