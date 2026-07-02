'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, Palette, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** 12 hues around the wheel + the 3 neutral families — values are what the API's color param accepts. */
const SWATCHES: { value: string; css: string }[] = [
  { value: '#e03131', css: '#e03131' }, // red
  { value: '#e8590c', css: '#e8590c' }, // orange
  { value: '#f0a202', css: '#f0a202' }, // amber
  { value: '#ffd43b', css: '#ffd43b' }, // yellow
  { value: '#82c91e', css: '#82c91e' }, // lime
  { value: '#2f9e44', css: '#2f9e44' }, // green
  { value: '#12b886', css: '#12b886' }, // teal
  { value: '#15aabf', css: '#15aabf' }, // cyan
  { value: '#1c7ed6', css: '#1c7ed6' }, // blue
  { value: '#4263eb', css: '#4263eb' }, // indigo
  { value: '#7048e8', css: '#7048e8' }, // violet
  { value: '#d6336c', css: '#d6336c' }, // pink
  { value: 'black', css: '#1a1a1a' },
  { value: 'gray', css: '#8a8a8a' },
  { value: 'white', css: '#f5f5f5' },
];

export function ColorFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const t = useTranslations('grid.colorFilter');
  const active = SWATCHES.find((s) => s.value === value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 border-dashed">
          {active ? (
            <span className="size-3.5 rounded-full border border-border" style={{ backgroundColor: active.css }} />
          ) : (
            <Palette className="size-3.5" />
          )}
          {t('label')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="grid grid-cols-5 gap-2">
          {SWATCHES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onChange(s.value === value ? null : s.value)}
              className={cn(
                'flex size-8 items-center justify-center rounded-full border transition-transform hover:scale-110',
                s.value === value ? 'border-primary ring-2 ring-primary/40' : 'border-border',
              )}
              style={{ backgroundColor: s.css }}
              aria-label={s.value}
            >
              {s.value === value && <Check className={cn('size-4', s.value === 'white' || s.value === '#ffd43b' ? 'text-black' : 'text-white')} />}
            </button>
          ))}
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-md py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" /> {t('clear')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
