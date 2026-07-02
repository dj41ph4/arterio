import { cn } from '@/lib/utils';

/** Arterio mark — an aperture/diamond formed from overlapping strokes. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-flex size-7 items-center justify-center rounded-[0.5rem] bg-primary text-primary-foreground shadow-subtle',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
        <path
          d="M12 3 L20 19 L12 15 L4 19 Z"
          fill="currentColor"
          fillOpacity="0.95"
        />
        <path d="M12 3 L12 15" stroke="hsl(var(--primary))" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-display text-[15px] font-semibold tracking-tight text-foreground',
        className,
      )}
    >
      Arterio
    </span>
  );
}
