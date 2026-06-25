'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import {
  Search,
  CornerDownLeft,
  Moon,
  Sun,
  Plus,
  Upload,
  Palette,
} from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { useUiStore } from '@/stores/ui-store';
import { NAV_SECTIONS } from './nav';
import { ACCENT_PRESETS } from '@/lib/accent';
import { cn } from '@/lib/utils';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: React.ReactNode;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const setAccent = useUiStore((s) => s.setAccent);
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const t = useTranslations();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);

  // Global ⌘K / Ctrl+K
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  React.useEffect(() => {
    if (!open) setQuery('');
    setActive(0);
  }, [open]);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen],
  );

  const commands: Command[] = React.useMemo(() => {
    const nav: Command[] = NAV_SECTIONS.flatMap((s) => s.items).map((item) => ({
      id: `nav-${item.key}`,
      label: t(`nav.${item.key}`),
      group: t('command.groupNavigation'),
      icon: <item.icon className="size-4" />,
      run: () => go(item.href),
    }));

    const actions: Command[] = [
      {
        id: 'act-new',
        label: t('command.newArtwork'),
        group: t('command.groupActions'),
        icon: <Plus className="size-4" />,
        run: () => go('/collection'),
      },
      {
        id: 'act-import',
        label: t('command.importData'),
        group: t('command.groupActions'),
        icon: <Upload className="size-4" />,
        run: () => go('/collection'),
      },
    ];

    const prefs: Command[] = [
      {
        id: 'pref-theme',
        label: t('command.toggleTheme'),
        group: t('command.groupPreferences'),
        icon: resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />,
        run: () => {
          setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
          setOpen(false);
        },
      },
      ...ACCENT_PRESETS.slice(0, 4).map((p) => ({
        id: `pref-accent-${p.id}`,
        label: `${t('command.changeAccent')}: ${p.name}`,
        group: t('command.groupPreferences'),
        keywords: 'accent color theme',
        icon: <Palette className="size-4" style={{ color: `hsl(${p.light})` }} />,
        run: () => {
          setAccent(p.id);
          setOpen(false);
        },
      })),
    ];

    return [...nav, ...actions, ...prefs];
  }, [t, go, resolvedTheme, setTheme, setAccent, setOpen]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [commands, query]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, Command[]>();
    filtered.forEach((c) => {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    });
    return [...map.entries()];
  }, [filtered]);

  const flat = filtered;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(flat.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + flat.length) % Math.max(flat.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[active]?.run();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t('command.placeholder')}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Kbd>ESC</Kbd>
        </div>

        <div className="max-h-[340px] overflow-y-auto scrollbar-thin p-2">
          {flat.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t('command.empty')}
            </p>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-1">
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group}
              </p>
              {items.map((c) => {
                const index = flat.indexOf(c);
                const isActive = index === active;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => c.run()}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      isActive ? 'bg-muted text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <span className={cn(isActive ? 'text-primary' : 'text-muted-foreground')}>
                      {c.icon}
                    </span>
                    <span className="flex-1 text-foreground">{c.label}</span>
                    {isActive && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
