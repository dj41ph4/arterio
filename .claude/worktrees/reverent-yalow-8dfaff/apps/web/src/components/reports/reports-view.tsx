'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  BarChart3, FileBarChart, ShieldCheck, Wrench, Image as ImageIcon, Download,
} from 'lucide-react';
import { useDashboardStats } from '@/hooks/use-artworks';
import { formatCurrency } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';

const REPORT_DEFS = [
  { id: 'catalogue', icon: ImageIcon, tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/12' },
  { id: 'insurance', icon: ShieldCheck, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/12' },
  { id: 'conservation', icon: Wrench, tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/12' },
  { id: 'financial', icon: BarChart3, tone: 'text-violet-600 dark:text-violet-400 bg-violet-500/12' },
] as const;

export function ReportsView() {
  const t = useTranslations();
  const { data: stats, isLoading } = useDashboardStats();

  const handleGenerate = (id: string) => {
    toast.info(t('reports.generating', { name: t(`reports.types.${id}.title`) }));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="p-4 pb-3 md:px-6">
        <PageHeader title={t('nav.reports')} subtitle={t('reports.subtitle')} />
      </div>

      <div className="p-6 space-y-6">
        {/* Report cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {REPORT_DEFS.map((def) => {
            const Icon = def.icon;
            return (
              <div key={def.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${def.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{t(`reports.types.${def.id}.title`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`reports.types.${def.id}.description`)}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleGenerate(def.id)}
                  className="flex items-center justify-center gap-2 self-start rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('reports.generatePdf')}
                </button>
              </div>
            );
          })}
        </div>

        {/* Live snapshot from real collection data */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileBarChart className="h-4 w-4 text-primary" />
            {t('reports.snapshot')}
          </h2>
          {isLoading || !stats ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label={t('dashboard.totalArtworks')} value={String(stats.totalArtworks)} />
              <Stat label={t('dashboard.totalValue')} value={formatCurrency(stats.totalInsuredValue, stats.currency, 'fr')} />
              <Stat label={t('dashboard.onLoan')} value={String(stats.onLoan)} />
              <Stat label={t('dashboard.needsRestoration')} value={String(stats.needsRestoration)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
