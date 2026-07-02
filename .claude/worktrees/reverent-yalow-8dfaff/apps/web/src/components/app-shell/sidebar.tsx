'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { PanelLeftClose, PanelLeft, Plus } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui-store';
import { Logo, Wordmark } from './logo';
import { NAV_SECTIONS, SETTINGS_ITEM, type NavItem } from './nav';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

function NavLink({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}) {
  const t = useTranslations('nav');
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      className={cn(
        'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
        active
          ? 'text-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/8 hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 -z-10 rounded-lg bg-sidebar-accent/12"
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        />
      )}
      <Icon
        className={cn(
          'size-[18px] shrink-0 transition-colors',
          active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
        )}
      />
      {!collapsed && <span className="truncate">{t(item.key)}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{t(item.key)}</TooltipContent>
      </Tooltip>
    );
  }
  return link;
}

export function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 248 }}
      transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      className="sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex"
    >
      {/* Brand */}
      <div
        className={cn(
          'flex h-16 items-center gap-2.5 px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        <Logo />
        {!collapsed && (
          <div className="flex flex-col leading-none">
            <Wordmark />
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('app.tagline')}
            </span>
          </div>
        )}
      </div>

      {/* New artwork CTA */}
      <div className={cn('px-3 pb-2', collapsed && 'px-2')}>
        <Button
          asChild
          className={cn('w-full shadow-elevated', collapsed && 'px-0')}
          size={collapsed ? 'icon' : 'default'}
        >
          <Link href="/collection">
            <Plus className="size-4" />
            {!collapsed && <span>{t('grid.newArtwork')}</span>}
          </Link>
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto scrollbar-thin px-3 py-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.labelKey} className="space-y-1">
            {!collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t(`nav.${section.labelKey}`)}
              </p>
            )}
            {section.items.map((item) => (
              <NavLink
                key={item.key}
                item={item}
                collapsed={collapsed}
                active={isActive(pathname, item.href)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="space-y-1 border-t border-sidebar-border p-3">
        <NavLink
          item={SETTINGS_ITEM}
          collapsed={collapsed}
          active={isActive(pathname, SETTINGS_ITEM.href)}
        />
        <button
          onClick={toggle}
          className={cn(
            'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/8 hover:text-foreground',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <PanelLeft className="size-[18px]" />
          ) : (
            <>
              <PanelLeftClose className="size-[18px]" />
              <span>{t('common.view')}</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
