'use client';

import * as React from 'react';
import { useLocale } from 'next-intl';
import { Check, Languages } from 'lucide-react';
import { LOCALES, LOCALE_META, type Locale } from '@arterio/shared';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();

  function switchTo(next: Locale) {
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2 font-medium"
              disabled={pending}
            >
              <Languages className="size-[18px]" />
              <span className="text-xs uppercase">{locale}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{LOCALE_META[locale].label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        {LOCALES.map((l) => (
          <DropdownMenuItem key={l} onClick={() => switchTo(l)} className="gap-2.5">
            <span className="text-base leading-none">{LOCALE_META[l].flag}</span>
            <span className="flex-1">{LOCALE_META[l].nativeLabel}</span>
            {l === locale && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
