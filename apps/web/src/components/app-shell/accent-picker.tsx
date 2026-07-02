'use client';

import { Palette, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ACCENT_PRESETS } from '@/lib/accent';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

export function AccentPicker() {
  const accent = useUiStore((s) => s.accent);
  const setAccent = useUiStore((s) => s.setAccent);
  const t = useTranslations('theme');

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('accent')}>
              <Palette className="size-[18px]" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('accent')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-60">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('accent')}
        </p>
        <div className="grid grid-cols-4 gap-2">
          {ACCENT_PRESETS.map((preset) => {
            const selected = preset.id === accent;
            return (
              <button
                key={preset.id}
                onClick={() => setAccent(preset.id)}
                title={preset.name}
                className={cn(
                  'group relative flex aspect-square items-center justify-center rounded-lg border transition-all hover:scale-105',
                  selected ? 'border-foreground/30 ring-2 ring-ring/50' : 'border-border',
                )}
                style={{ background: `hsl(${preset.light})` }}
              >
                {selected && <Check className="size-4 text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
