'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Truck, Search, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/ui/badge';

interface LoanView {
  id: string;
  artworkTitle: string;
  artist: string;
  direction: 'in' | 'out';
  counterparty: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'active' | 'returned' | 'overdue';
}

const TODAY = new Date('2026-06-21');

const LOANS: LoanView[] = [
  { id: 'l1', artworkTitle: 'Landscape near Spring', artist: 'Johannes Vermeer', direction: 'out', counterparty: 'Rijksmuseum, Amsterdam', startDate: '2026-04-01', endDate: '2026-09-30', status: 'active' },
  { id: 'l2', artworkTitle: 'Self-Portrait No. VII', artist: 'Caspar David Friedrich', direction: 'out', counterparty: 'Tate Modern, Londres', startDate: '2026-06-15', endDate: '2026-06-28', status: 'active' },
  { id: 'l3', artworkTitle: 'Composition Argenteuil', artist: 'Artemisia Gentileschi', direction: 'in', counterparty: 'Collection privée Dubois', startDate: '2026-03-10', endDate: '2026-06-10', status: 'overdue' },
  { id: 'l4', artworkTitle: 'Allegory of Twilight', artist: 'Egon Schiele', direction: 'out', counterparty: 'MoMA, New York', startDate: '2026-07-01', endDate: '2026-10-15', status: 'pending' },
  { id: 'l5', artworkTitle: 'View of Saint Jerome', artist: 'Rembrandt van Rijn', direction: 'in', counterparty: 'Musée du Louvre', startDate: '2025-12-01', endDate: '2026-03-01', status: 'returned' },
  { id: 'l6', artworkTitle: 'Portrait of a Young Woman', artist: 'Johannes Vermeer', direction: 'out', counterparty: 'Mauritshuis, La Haye', startDate: '2026-06-20', endDate: '2026-11-30', status: 'active' },
  { id: 'l7', artworkTitle: 'Self-Portrait Twilight', artist: 'Hilma af Klint', direction: 'in', counterparty: 'Moderna Museet, Stockholm', startDate: '2026-08-01', endDate: '2026-12-01', status: 'pending' },
];

const STATUS_TONE = { pending: 'info', active: 'success', returned: 'neutral', overdue: 'danger' } as const;

export function LoansView() {
  const t = useTranslations();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return LOANS.filter(
      (l) => l.artworkTitle.toLowerCase().includes(q) || l.artist.toLowerCase().includes(q) || l.counterparty.toLowerCase().includes(q),
    ).sort((a, b) => +new Date(b.startDate) - +new Date(a.startDate));
  }, [search]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 pb-3 md:px-6">
        <PageHeader title={t('nav.loans')} subtitle={t('loans.subtitle', { count: filtered.length })} />
      </div>

      <div className="border-b border-border bg-background px-6 py-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('loans.searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-4 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Truck className="h-10 w-10 opacity-40" />
            <p className="text-sm">{t('common.noResults')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((loan) => (
              <div
                key={loan.id}
                className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${loan.direction === 'out' ? 'bg-blue-500/12 text-blue-600 dark:text-blue-400' : 'bg-violet-500/12 text-violet-600 dark:text-violet-400'}`}>
                  {loan.direction === 'out' ? <ArrowUpFromLine className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{loan.artworkTitle}</p>
                  <p className="truncate text-xs text-muted-foreground">{loan.artist} · {loan.counterparty}</p>
                </div>
                <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {formatDate(loan.startDate)} – {formatDate(loan.endDate)}
                </div>
                <Badge tone={STATUS_TONE[loan.status]} dot className="shrink-0">
                  {t(`loans.status.${loan.status}`)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
