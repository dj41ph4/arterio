'use client';

export interface BarItem {
  label: string;
  value: number;
  color?: string;
  hint?: string;
}

/** Horizontal proportional bar list (Vercel-style). */
export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-foreground">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {item.hint ?? item.value}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${(item.value / max) * 100}%`,
                background: item.color ?? 'hsl(var(--primary))',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
