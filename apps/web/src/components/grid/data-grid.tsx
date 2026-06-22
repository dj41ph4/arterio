'use client';

import * as React from 'react';
import { flexRender, type Table } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ArtworkView } from '@arterio/shared';
import { cn } from '@/lib/utils';

const PINNED_LEFT = new Set(['select', 'artwork']);
const ROW_HEIGHT = 56;

export function DataGrid({
  table,
  onRowClick,
  onReachEnd,
}: {
  table: Table<ArtworkView>;
  onRowClick: (id: string) => void;
  onReachEnd: () => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Infinite-scroll trigger when the last virtual item nears the end.
  const virtualItems = virtualizer.getVirtualItems();
  React.useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (last && last.index >= rows.length - 8) onReachEnd();
  }, [virtualItems, rows.length, onReachEnd]);

  // Pre-compute sticky-left offsets.
  const leftOffsets = React.useMemo(() => {
    const map: Record<string, number> = {};
    let acc = 0;
    for (const col of table.getVisibleLeafColumns()) {
      if (PINNED_LEFT.has(col.id)) {
        map[col.id] = acc;
        acc += col.getSize();
      }
    }
    return map;
  }, [table, table.getState().columnSizing, table.getState().columnVisibility]);

  const totalWidth = table.getTotalSize();

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100dvh-13.5rem)] overflow-auto scrollbar-thin border-t border-border"
    >
      <div style={{ width: totalWidth, minWidth: '100%' }}>
        {/* Header */}
        <div className="sticky top-0 z-20 flex border-b border-border bg-muted/60 backdrop-blur">
          {table.getFlatHeaders().map((header) => {
            const pinned = PINNED_LEFT.has(header.column.id);
            const sortable = header.column.getCanSort();
            const sorted = header.column.getIsSorted();
            return (
              <div
                key={header.id}
                style={{
                  width: header.getSize(),
                  left: pinned ? leftOffsets[header.column.id] : undefined,
                }}
                className={cn(
                  'flex h-10 shrink-0 items-center px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                  pinned && 'sticky z-10 bg-muted/90 backdrop-blur',
                  sortable && 'cursor-pointer select-none hover:text-foreground',
                )}
                onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
              >
                <span className="truncate">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </span>
                {sortable && (
                  <span className="ml-1 text-muted-foreground/70">
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
            const row = rows[vi.index]!;
            const selected = row.getIsSelected();
            return (
              <div
                key={row.id}
                data-index={vi.index}
                onClick={() => onRowClick(row.original.id)}
                style={{ transform: `translateY(${vi.start}px)`, height: ROW_HEIGHT }}
                className={cn(
                  'group absolute left-0 top-0 flex w-full cursor-pointer border-b border-border/60 transition-colors',
                  selected ? 'bg-primary/5' : 'hover:bg-muted/40',
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const pinned = PINNED_LEFT.has(cell.column.id);
                  return (
                    <div
                      key={cell.id}
                      style={{
                        width: cell.column.getSize(),
                        left: pinned ? leftOffsets[cell.column.id] : undefined,
                      }}
                      className={cn(
                        'flex shrink-0 items-center px-3 text-sm',
                        pinned &&
                          cn(
                            'sticky z-10',
                            selected ? 'bg-[hsl(var(--primary)/0.05)]' : 'bg-card group-hover:bg-[hsl(var(--muted)/0.4)]',
                          ),
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
