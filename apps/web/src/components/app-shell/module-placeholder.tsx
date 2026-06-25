'use client';

import { motion } from 'framer-motion';
import {
  Sparkles,
  Users,
  Frame,
  Truck,
  MapPin,
  FileText,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from './page-header';
import { Badge } from '@/components/ui/badge';

/**
 * Icon registry — pages are Server Components and cannot pass a component
 * function across the server/client boundary, so they pass a string key.
 */
const ICONS: Record<string, LucideIcon> = {
  users: Users,
  frame: Frame,
  truck: Truck,
  mapPin: MapPin,
  fileText: FileText,
  barChart: BarChart3,
};

/** Elegant placeholder for modules scheduled in later phases — never an empty screen. */
export function ModulePlaceholder({
  titleKey,
  icon,
  features,
}: {
  titleKey: string;
  icon: keyof typeof ICONS;
  features: string[];
}) {
  const t = useTranslations();
  const Icon = ICONS[icon] ?? Sparkles;
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-6 lg:p-8">
      <PageHeader
        title={t(titleKey)}
        actions={
          <Badge tone="primary" className="gap-1">
            <Sparkles className="size-3" /> Phase 2+
          </Badge>
        }
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-border bg-card p-10 shadow-subtle"
      >
        <div className="absolute -right-10 -top-10 size-48 rounded-full bg-primary/10 blur-3xl" />
        <span className="relative flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-8" />
        </span>
        <h2 className="relative mt-5 font-display text-xl font-semibold tracking-tight">
          {t(titleKey)}
        </h2>
        <p className="relative mt-1.5 max-w-xl text-sm text-muted-foreground">
          This module is fully designed in the architecture and lands in an upcoming phase.
          Planned capabilities:
        </p>
        <ul className="relative mt-5 grid max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2.5 text-sm">
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="text-foreground">{f}</span>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}
