'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCountUp } from '@/hooks/use-count-up';

export function StatCard({
  icon: Icon,
  label,
  value,
  numericValue,
  format,
  sub,
  trend,
  index = 0,
  tone = 'primary',
}: {
  icon: LucideIcon;
  label: string;
  /** Pre-formatted display value — used as-is when `numericValue` isn't provided. */
  value: string;
  /** When provided, the card counts up from 0 to this number on mount instead of showing `value` statically. */
  numericValue?: number;
  /** Formats the animated `numericValue` for display each frame. */
  format?: (n: number) => string;
  sub?: string;
  trend?: string;
  index?: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
}) {
  const animated = useCountUp(numericValue ?? 0);
  const display = numericValue != null ? (format ? format(animated) : String(animated)) : value;

  const toneClass = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
  }[tone];

  const glowClass = {
    primary: 'bg-primary/15',
    success: 'bg-emerald-500/15',
    warning: 'bg-amber-500/15',
    danger: 'bg-red-500/15',
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-subtle transition-shadow hover:shadow-elevated"
    >
      <div className={cn('absolute -right-8 -top-8 size-28 rounded-full blur-2xl transition-transform duration-500 group-hover:scale-125', glowClass)} />
      <div className="relative flex items-center justify-between">
        <span className={cn('flex size-9 items-center justify-center rounded-lg', toneClass)}>
          <Icon className="size-[18px]" />
        </span>
        {trend && (
          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-success">
            <ArrowUpRight className="size-3" />
            {trend}
          </span>
        )}
      </div>
      <p className="relative mt-4 font-display text-3xl font-semibold tracking-tight tabular-nums">
        {display}
      </p>
      <p className="relative mt-0.5 text-sm text-muted-foreground">{label}</p>
      {sub && <p className="relative mt-2 text-xs text-muted-foreground/80">{sub}</p>}
    </motion.div>
  );
}
