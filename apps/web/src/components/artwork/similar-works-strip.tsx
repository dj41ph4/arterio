'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import type { ArtworkView, Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { apiFetch } from '@/lib/api/client';
import { Link } from '@/i18n/navigation';
import { ArtworkThumbnail } from './thumbnail';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

/** Horizontal strip of visually/contextually similar works, on the detail page's overview tab. Hidden while empty. */
export function SimilarWorksStrip({ artworkId }: { artworkId: string }) {
  const t = useTranslations('artwork.similar');
  const locale = useLocale() as Locale;

  const { data } = useQuery({
    queryKey: ['artwork-similar', artworkId],
    queryFn: () => apiFetch<ArtworkView[]>(`/artworks/${artworkId}/similar?limit=8`),
    enabled: USE_API,
    staleTime: 60_000,
  });

  if (!data?.length) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-primary" />
        <h3 className="text-sm font-semibold">{t('title')}</h3>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
        {data.map((a) => (
          <Link
            key={a.id}
            href={`/artworks/${a.id}`}
            className="group w-28 shrink-0 overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/50"
          >
            <div className="aspect-square">
              <ArtworkThumbnail colors={a.dominantColors} src={a.thumbnailUrl} />
            </div>
            <div className="p-2">
              <p className="truncate text-xs font-medium">{resolveLocalized(a.title, locale) || a.inventoryNumber}</p>
              <p className="truncate text-[11px] text-muted-foreground">{a.artistName ?? '—'}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
