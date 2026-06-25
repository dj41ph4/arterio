'use client';

import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import {
  LibraryBig,
  ShieldCheck,
  Truck,
  Wrench,
  AlertTriangle,
  Clock3,
  CalendarClock,
  ChevronRight,
  Palette,
} from 'lucide-react';
import type { Locale } from '@arterio/shared';
import { useDashboardStats } from '@/hooks/use-artworks';
import { formatCompact, formatCurrency, formatDate } from '@/lib/format';
import { PageHeader } from '@/components/app-shell/page-header';
import { StatCard } from './stat-card';
import { HeroSlideshow } from './hero-slideshow';
import { QuickActions } from './quick-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Donut } from '@/components/charts/donut';
import { BarList } from '@/components/charts/bar-list';
import { ArtworkThumbnail } from '@/components/artwork/thumbnail';
import { Link } from '@/i18n/navigation';
import { resolveLocalized } from '@arterio/shared';

const ALERT_ICON = {
  insurance_expiring: ShieldCheck,
  loan_due: CalendarClock,
  restoration_due: Wrench,
} as const;
const ALERT_TONE = {
  critical: 'text-destructive bg-destructive/10',
  warning: 'text-amber-600 dark:text-amber-400 bg-warning/10',
  info: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
} as const;

export function DashboardView() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const { data: stats, isLoading } = useDashboardStats();

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-6 lg:p-8">
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      {/* Hero slideshow */}
      {isLoading || !stats ? (
        <Skeleton className="h-[340px] w-full rounded-2xl sm:h-[400px]" />
      ) : (
        <HeroSlideshow artworks={stats.recentlyAdded} locale={locale} />
      )}

      {/* Quick actions */}
      <QuickActions />

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !stats ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[140px]" />)
        ) : (
          <>
            <StatCard
              icon={LibraryBig}
              label={t('dashboard.totalArtworks')}
              value={formatCompact(stats.totalArtworks, locale)}
              numericValue={stats.totalArtworks}
              format={(n) => formatCompact(n, locale)}
              sub={`${stats.artists} artistes · ${stats.collections} collections`}
              tone="primary"
              index={0}
            />
            <StatCard
              icon={ShieldCheck}
              label={t('dashboard.totalValue')}
              value={formatCurrency(stats.totalInsuredValue, stats.currency, locale)}
              numericValue={stats.totalInsuredValue}
              format={(n) => formatCurrency(n, stats.currency, locale)}
              tone="success"
              index={1}
            />
            <StatCard
              icon={Truck}
              label={t('dashboard.onLoan')}
              value={String(stats.onLoan)}
              numericValue={stats.onLoan}
              sub={`${stats.onExhibition} ${t('dashboard.onExhibition').toLowerCase()}`}
              tone="warning"
              index={2}
            />
            <StatCard
              icon={Wrench}
              label={t('dashboard.needsRestoration')}
              value={String(stats.needsRestoration)}
              numericValue={stats.needsRestoration}
              tone="danger"
              index={3}
            />
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('dashboard.byCollection')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !stats ? (
              <Skeleton className="h-[168px]" />
            ) : (
              <Donut
                centerValue={formatCompact(stats.totalArtworks, locale)}
                centerLabel={t('dashboard.totalArtworks')}
                segments={stats.byCollection.map((c) => ({
                  label: c.name,
                  value: c.count,
                  color: c.color,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.byStatus')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !stats ? (
              <Skeleton className="h-[168px]" />
            ) : (
              <BarList
                items={stats.byStatus
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 6)
                  .map((s) => ({
                    label: t(`status.${s.key}`),
                    value: s.count,
                  }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Condition + top collections by value */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4 text-primary" /> {t('dashboard.conditionOverview')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !stats ? (
              <Skeleton className="h-[140px]" />
            ) : (
              <BarList
                items={stats.byCondition
                  .sort((a, b) => b.count - a.count)
                  .map((c) => ({ label: t(`condition.${c.key}`), value: c.count }))}
              />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('dashboard.valueByCollection')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !stats ? (
              <Skeleton className="h-[140px]" />
            ) : (
              <BarList
                items={[...stats.byCollection]
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 6)
                  .map((c) => ({
                    label: c.name,
                    value: c.value,
                    color: c.color,
                    hint: formatCurrency(c.value, stats.currency, locale),
                  }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alerts + recently added */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              {t('dashboard.alerts')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading || !stats ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)
            ) : stats.alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('dashboard.noAlerts')}
              </p>
            ) : (
              stats.alerts.map((alert) => {
                const Icon = ALERT_ICON[alert.type];
                const content = (
                  <div className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40">
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${ALERT_TONE[alert.severity]}`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug text-foreground">
                        {alert.title}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="size-3" />
                        {formatDate(alert.dueAt, locale)}
                      </p>
                    </div>
                  </div>
                );
                return alert.artworkId ? (
                  <Link key={alert.id} href={`/artworks/${alert.artworkId}`} className="block">
                    {content}
                  </Link>
                ) : (
                  <div key={alert.id}>{content}</div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t('dashboard.recentlyAdded')}</CardTitle>
            <Link
              href="/collection"
              className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
            >
              {t('dashboard.viewAll')} <ChevronRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent>
            {isLoading || !stats ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {stats.recentlyAdded.map((art, i) => (
                  <motion.div
                    key={art.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Link href={`/artworks/${art.id}`} className="group block">
                      <ArtworkThumbnail
                        colors={art.dominantColors}
                        src={art.primaryImageUrl}
                        className="aspect-square w-full transition-transform group-hover:scale-[1.03]"
                        rounded="lg"
                      />
                      <p className="mt-1.5 truncate text-xs font-medium text-foreground">
                        {resolveLocalized(art.title, locale)}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {art.artistName}
                      </p>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
