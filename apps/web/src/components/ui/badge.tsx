import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        primary: 'border-transparent bg-primary/12 text-primary',
        success:
          'border-transparent bg-success/12 text-success dark:text-success',
        info: 'border-transparent bg-blue-500/12 text-blue-600 dark:text-blue-400',
        warning:
          'border-transparent bg-warning/15 text-amber-600 dark:text-amber-400',
        danger:
          'border-transparent bg-destructive/12 text-destructive',
        violet:
          'border-transparent bg-violet-500/12 text-violet-600 dark:text-violet-400',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
