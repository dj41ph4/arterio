'use client';

import { Search, Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { useUiStore } from '@/stores/ui-store';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { AccentPicker } from './accent-picker';
import { LocaleSwitcher } from './locale-switcher';
import { UserMenu } from './user-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function Topbar() {
  const t = useTranslations();
  const openCommand = useUiStore((s) => s.setCommandOpen);

  return (
    <header className="glass sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border px-4 md:px-6">
      {/* Mobile brand */}
      <div className="flex items-center gap-2 md:hidden">
        <Logo />
      </div>

      {/* Search trigger → command palette */}
      <button
        onClick={() => openCommand(true)}
        className="group flex h-9 max-w-md flex-1 items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">{t('common.search')}…</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications">
              <Bell className="size-[18px]" />
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-background" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('dashboard.alerts')}</TooltipContent>
        </Tooltip>

        <LocaleSwitcher />
        <AccentPicker />
        <ThemeToggle />
        <div className="mx-1.5 h-6 w-px bg-border" />
        <UserMenu />
      </div>
    </header>
  );
}
