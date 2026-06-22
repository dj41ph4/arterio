'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  index = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  trend?: string;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-subtle transition-shadow hover:shadow-elevated"
    >
      <div className="absolute -right-6 -top-6 size-24 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100" />
      <div className="flex items-center justify-between">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-[18px]" />
        </span>
        {trend && (
          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-success">
            <ArrowUpRight className="size-3" />
            {trend}
          </span>
        )}
      </div>
      <p className="mt-4 font-display text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
      {sub && <p className={cn('mt-2 text-xs text-muted-foreground/80')}>{sub}</p>}
    </motion.div>
  );
}
