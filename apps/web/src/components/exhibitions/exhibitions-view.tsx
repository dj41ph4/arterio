'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Frame, Search, MapPin, Calendar } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { apiFetch } from '@/lib/api/client';
import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/ui/badge';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

interface ExhibitionView {
  id: string;
  title: string;
  venue: string;
  city: string;
  startDate: string;
  endDate: string;
  artworkCount: number;
  color: string;
}

const TODAY = new Date('2026-06-21');

const DEMO_EXHIBITIONS: ExhibitionView[] = [
  { id: 'ex1', title: 'Lumières du Nord', venue: 'Rijksmuseum', city: 'Amsterdam', startDate: '2026-04-10', endDate: '2026-08-30', artworkCount: 18, color: '#0ea5e9' },
  { id: 'ex2', title: 'Cubisme & Fragmentation', venue: 'Centre Pompidou', city: 'Paris', startDate: '2026-06-01', endDate: '2026-09-15', artworkCount: 12, color: '#8b5cf6' },
  { id: 'ex3', title: "Rétrospective de l'Âge d'or", venue: 'Mauritshuis', city: 'La Haye', startDate: '2025-11-20', endDate: '2026-03-01', artworkCount: 24, color: '#b45309' },
  { id: 'ex4', title: 'Couleurs Pop', venue: 'MoMA', city: 'New York', startDate: '2026-09-05', endDate: '2026-12-20', artworkCount: 9, color: '#ec4899' },
  { id: 'ex5', title: 'Portraits Intimes', venue: 'Musée d\'Orsay', city: 'Paris', startDate: '2026-01-15', endDate: '2026-05-10', artworkCount: 15, color: '#10b981' },
  { id: 'ex6', title: 'Regards Contemporains', venue: 'Tate Modern', city: 'Londres', startDate: '2026-10-01', endDate: '2027-01-31', artworkCount: 21, color: '#ef4444' },
];

function getPhase(start: string, end: string): 'upcoming' | 'current' | 'past' {
  const s = new Date(start);
  const e = new Date(end);
  if (TODAY < s) return 'upcoming';
  if (TODAY > e) return 'past';
  return 'current';
}

const PHASE_TONE = { upcoming: 'info', current: 'success', past: 'neutral' } as const;

export function ExhibitionsView() {
  const t = useTranslations();
  const [search, setSearch] = useState('');
  const [exhibitions, setExhibitions] = useState<ExhibitionView[]>(USE_API ? [] : DEMO_EXHIBITIONS);

  useEffect(() => {
    if (!USE_API) return;
    apiFetch<{ data: ExhibitionView[] }>('/exhibitions')
      .then((res) => setExhibitions(res.data))
      .catch(() => setExhibitions([]));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return exhibitions
      .filter((e) => e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q) || e.city.toLowerCase().includes(q))
      .sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate));
  }, [search, exhibitions]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 pb-3 md:px-6">
        <PageHeader
          title={t('nav.exhibitions')}
          subtitle={t('exhibitions.subtitle', { count: filtered.length })}
        />
      </div>

      <div className="border-b border-border bg-background px-6 py-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('exhibitions.searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-4 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Frame className="h-10 w-10 opacity-40" />
            <p className="text-sm">{t('common.noResults')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {filtered.map((ex) => {
              const phase = getPhase(ex.startDate, ex.endDate);
              return (
                <motion.div
                  key={ex.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -2 }}
                  className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="h-2" style={{ background: ex.color }} />
                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground leading-snug">{ex.title}</h3>
                      <Badge tone={PHASE_TONE[phase]} dot>{t(`exhibitions.phase.${phase}`)}</Badge>
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {ex.venue}, {ex.city}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" /> {formatDate(ex.startDate)} – {formatDate(ex.endDate)}
                    </p>
                    <div className="pt-2 border-t border-border text-xs text-muted-foreground">
                      {t('exhibitions.worksCount', { count: ex.artworkCount })}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
