'use client';

import { motion } from 'framer-motion';
import { useLocale } from 'next-intl';
import { Star } from 'lucide-react';
import type { ArtworkView, Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { Link } from '@/i18n/navigation';
import { ArtworkThumbnail } from '@/components/artwork/thumbnail';
import { StatusBadge } from '@/components/artwork/status-badge';
import { cn } from '@/lib/utils';

export function Gallery({ items }: { items: ArtworkView[] }) {
  const locale = useLocale() as Locale;

  return (
    <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 md:p-6 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((art, i) => (
        <motion.div
          key={art.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.4) }}
        >
          <Link
            href={`/artworks/${art.id}`}
            className="group block overflow-hidden rounded-xl border border-border bg-card shadow-subtle transition-all hover:-translate-y-0.5 hover:shadow-elevated"
          >
            <div className="relative">
              <ArtworkThumbnail
                colors={art.dominantColors}
                src={art.primaryImageUrl}
                className="aspect-[4/5] w-full"
                rounded="sm"
              />
              {art.isFavorite && (
                <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/40 backdrop-blur">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                </span>
              )}
              <span className="absolute left-2 top-2">
                <StatusBadge status={art.status} />
              </span>
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-medium text-foreground">
                {resolveLocalized(art.title, locale)}
              </p>
              <p className="truncate text-xs text-muted-foreground">{art.artistName}</p>
              <div className="mt-2 flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[11px] text-muted-foreground',
                  )}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: art.collectionColor ?? 'hsl(var(--muted-foreground))' }}
                  />
                  {art.collectionName}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {art.inventoryNumber}
                </span>
              </div>
            </div>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
