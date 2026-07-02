'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, LibraryBig, Users, Menu, Sparkles, MonitorDown } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { NAV_SECTIONS, SETTINGS_ITEM, type NavItem } from './nav';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

/** The 3 sections pinned in the bar; everything else lives in the "Plus" sheet. */
const PINNED_KEYS = ['dashboard', 'collection', 'artists'] as const;

export function MobileNav() {
  const t = useTranslations();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const setAssistantOpen = useUiStore((s) => s.setAssistantOpen);
  const [installAvailable, setInstallAvailable] = React.useState(false);

  React.useEffect(() => {
    if (window.__arterioInstallPrompt) setInstallAvailable(true);
    const onAvailable = () => setInstallAvailable(true);
    window.addEventListener('arterio:install-available', onAvailable);
    return () => window.removeEventListener('arterio:install-available', onAvailable);
  }, []);

  const allItems: NavItem[] = [...NAV_SECTIONS.flatMap((s) => s.items), SETTINGS_ITEM];
  const pinned = PINNED_KEYS.map((key) => allItems.find((i) => i.key === key)!).filter(Boolean);
  const overflow = allItems.filter((i) => !PINNED_KEYS.includes(i.key as (typeof PINNED_KEYS)[number]));
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const overflowActive = overflow.some((i) => isActive(i.href));

  const pinnedIcons = { dashboard: LayoutDashboard, collection: LibraryBig, artists: Users } as const;

  return (
    <>
      <nav
        className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label={t('nav.sectionMain')}
      >
        <div className="grid h-16 grid-cols-4">
          {pinned.map((item) => {
            const Icon = pinnedIcons[item.key as keyof typeof pinnedIcons] ?? item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className={cn('size-5', active && 'stroke-[2.25]')} />
                {t(`nav.${item.key}`)}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
              overflowActive ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Menu className={cn('size-5', overflowActive && 'stroke-[2.25]')} />
            {t('nav.more')}
          </button>
        </div>
      </nav>

      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t('nav.more')}</DrawerTitle>
          </DrawerHeader>
          <div className="grid grid-cols-3 gap-2 px-4 pb-6">
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                setAssistantOpen(true);
              }}
              className="flex flex-col items-center gap-1.5 rounded-xl border bg-card p-3 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <Sparkles className="size-5 text-primary" />
              {t('assistant.title')}
            </button>
            {overflow.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border bg-card p-3 text-xs font-medium transition-colors',
                    active ? 'border-primary/50 bg-primary/5 text-primary' : 'text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className={cn('size-5', active ? 'text-primary' : 'text-muted-foreground')} />
                  {t(`nav.${item.key}`)}
                </Link>
              );
            })}
            {installAvailable && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  void window.__arterioInstallPrompt?.prompt();
                }}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed bg-card p-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <MonitorDown className="size-5 text-muted-foreground" />
                {t('pwa.install')}
              </button>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
