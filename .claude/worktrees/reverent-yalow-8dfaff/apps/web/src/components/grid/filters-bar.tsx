'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Search,
  SlidersHorizontal,
  Columns3,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  Table2,
  Rows3,
  Download,
  Check,
  X,
} from 'lucide-react';
import type { Table } from '@tanstack/react-table';
import type { ArtworkView } from '@arterio/shared';
import type { ArtworkFacets } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type ViewMode = 'table' | 'gallery' | 'sheet';

interface FiltersBarProps {
  table: Table<ArtworkView>;
  search: string;
  onSearch: (v: string) => void;
  facets?: ArtworkFacets;
  statusFilter: string[];
  collectionFilter: string[];
  onToggleStatus: (v: string) => void;
  onToggleCollection: (v: string) => void;
  onClearFilters: () => void;
  viewMode: ViewMode;
  onViewMode: (v: ViewMode) => void;
  columnLabels: Record<string, string>;
  onExport: () => void;
  exporting: boolean;
}

function FacetPopover({
  label,
  options,
  active,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string; count: number; color?: string }[];
  active: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 border-dashed">
          <SlidersHorizontal className="size-3.5" />
          {label}
          {active.length > 0 && (
            <Badge tone="primary" className="ml-1 px-1.5 py-0 text-[10px]">
              {active.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1.5">
        <div className="max-h-72 overflow-y-auto scrollbar-thin">
          {options.map((opt) => {
            const checked = active.includes(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => onToggle(opt.value)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
              >
                <span
                  className={cn(
                    'flex size-4 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                  )}
                >
                  {checked && <Check className="size-3" />}
                </span>
                {opt.color && (
                  <span className="size-2.5 rounded-full" style={{ background: opt.color }} />
                )}
                <span className="flex-1 truncate text-left capitalize">{opt.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{opt.count}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FiltersBar({
  table,
  search,
  onSearch,
  facets,
  statusFilter,
  collectionFilter,
  onToggleStatus,
  onToggleCollection,
  onClearFilters,
  viewMode,
  onViewMode,
  columnLabels,
  onExport,
  exporting,
}: FiltersBarProps) {
  const t = useTranslations();
  const hasFilters = statusFilter.length > 0 || collectionFilter.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={`${t('common.search')}…`}
          className="pl-9"
        />
      </div>

      {facets && (
        <>
          <FacetPopover
            label={t('artwork.fields.status')}
            options={facets.status.map((s) => ({ ...s, label: t(`status.${s.value}`) }))}
            active={statusFilter}
            onToggle={onToggleStatus}
          />
          <FacetPopover
            label={t('artwork.fields.collection')}
            options={facets.collection}
            active={collectionFilter}
            onToggle={onToggleCollection}
          />
        </>
      )}

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="gap-1 px-2">
          <X className="size-3.5" /> {t('common.clear')}
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowDownUp className="size-3.5" />
              <span className="hidden sm:inline">{t('grid.sort')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto scrollbar-thin">
            <DropdownMenuLabel>{t('grid.sortBy')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanSort())
              .map((column) => {
                const sorted = column.getIsSorted();
                return (
                  <button
                    key={column.id}
                    onClick={column.getToggleSortingHandler()}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted',
                      sorted && 'text-foreground font-medium',
                      !sorted && 'text-muted-foreground',
                    )}
                  >
                    <span className="flex-1 truncate text-left">{columnLabels[column.id] ?? column.id}</span>
                    {sorted === 'asc' ? (
                      <ArrowUp className="size-3.5 text-primary" />
                    ) : sorted === 'desc' ? (
                      <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowDownUp className="size-3.5 opacity-30" />
                    )}
                  </button>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Columns visibility */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Columns3 className="size-3.5" />
              <span className="hidden sm:inline">{t('grid.columns')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto scrollbar-thin">
            <DropdownMenuLabel>{t('grid.columns')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(v) => column.toggleVisibility(!!v)}
                  onSelect={(e) => e.preventDefault()}
                  className="capitalize"
                >
                  {columnLabels[column.id] ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View toggle */}
        <div className="flex items-center rounded-md border border-border p-0.5">
          <button
            onClick={() => onViewMode('table')}
            className={cn(
              'flex size-7 items-center justify-center rounded transition-colors',
              viewMode === 'table'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label={t('grid.viewList')}
            title={t('grid.viewList')}
          >
            <Rows3 className="size-4" />
          </button>
          <button
            onClick={() => onViewMode('gallery')}
            className={cn(
              'flex size-7 items-center justify-center rounded transition-colors',
              viewMode === 'gallery'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label={t('grid.viewGrid')}
            title={t('grid.viewGrid')}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={() => onViewMode('sheet')}
            className={cn(
              'flex size-7 items-center justify-center rounded transition-colors',
              viewMode === 'sheet'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label={t('grid.viewSheet')}
            title={t('grid.viewSheet')}
          >
            <Table2 className="size-4" />
          </button>
        </div>

        <Button variant="outline" size="sm" className="gap-1.5" onClick={onExport} disabled={exporting}>
          <Download className={cn('size-3.5', exporting && 'animate-pulse')} />
          <span className="hidden sm:inline">{t('common.export')}</span>
        </Button>
      </div>
    </div>
  );
}
