'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  CornerDownLeft,
  Moon,
  Sun,
  Plus,
  Upload,
  Palette,
  Sparkles,
  LibraryBig,
  Users,
  FileText,
  Frame,
  Wand2,
  Loader2,
} from 'lucide-react';
import type { Locale } from '@arterio/shared';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { searchApi } from '@/lib/data/search';
import { useDebounce } from '@/hooks/use-debounce';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { useUiStore } from '@/stores/ui-store';
import { useAssistantStore } from '@/stores/assistant-store';
import { NAV_SECTIONS } from './nav';
import { ACCENT_PRESETS } from '@/lib/accent';
import { cn } from '@/lib/utils';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

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
  const setAssistantOpen = useUiStore((s) => s.setAssistantOpen);
  const setPendingQuestion = useAssistantStore((s) => s.setPendingQuestion);
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [aiSearching, setAiSearching] = React.useState(false);
  const debouncedQuery = useDebounce(query.trim(), 250);

  // Unified instant search — artworks, artists, documents (incl. OCR), exhibitions.
  const { data: results } = useQuery({
    queryKey: ['global-search', debouncedQuery, locale],
    queryFn: () => searchApi.run(debouncedQuery, locale),
    enabled: USE_API && open && debouncedQuery.length >= 2,
    staleTime: 10_000,
  });

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
        id: 'act-assistant',
        label: t('assistant.title'),
        group: t('command.groupActions'),
        keywords: 'ai ia chat assistant collection question',
        icon: <Sparkles className="size-4" />,
        run: () => {
          setOpen(false);
          setAssistantOpen(true);
        },
      },
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
  }, [t, go, resolvedTheme, setTheme, setAccent, setOpen, setAssistantOpen]);

  // Content search results + AI rows, injected ABOVE the static commands while typing.
  const searchCommands: Command[] = React.useMemo(() => {
    if (!query.trim() || query.trim().length < 2) return [];
    const out: Command[] = [];
    for (const a of results?.artworks ?? []) {
      out.push({
        id: `sr-art-${a.id}`,
        label: a.artist ? `${a.title} — ${a.artist}` : a.title,
        group: t('search.groups.artworks'),
        icon: <LibraryBig className="size-4" />,
        run: () => go(`/artworks/${a.id}`),
      });
    }
    for (const a of results?.artists ?? []) {
      out.push({
        id: `sr-artist-${a.id}`,
        label: a.name,
        group: t('search.groups.artists'),
        icon: <Users className="size-4" />,
        run: () => go(`/artists/${a.id}`),
      });
    }
    for (const d of results?.documents ?? []) {
      out.push({
        id: `sr-doc-${d.id}`,
        label: d.matchedInOcr ? `${d.title} · ${t('search.inOcr')}` : d.title,
        group: t('search.groups.documents'),
        icon: <FileText className="size-4" />,
        run: () => go(d.artworkId ? `/artworks/${d.artworkId}` : '/documents'),
      });
    }
    for (const e of results?.exhibitions ?? []) {
      out.push({
        id: `sr-exh-${e.id}`,
        label: e.venue ? `${e.title} — ${e.venue}` : e.title,
        group: t('search.groups.exhibitions'),
        icon: <Frame className="size-4" />,
        run: () => go('/exhibitions'),
      });
    }
    if (USE_API && query.trim().length >= 3) {
      out.push({
        id: 'sr-ai-filters',
        label: t('search.aiSearch', { query: query.trim() }),
        group: t('search.groupAi'),
        icon: aiSearching ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />,
        run: () => {
          if (aiSearching) return;
          setAiSearching(true);
          const q = query.trim();
          searchApi
            .aiFilters(q, locale)
            .then(({ filters }) => {
              const params = new URLSearchParams();
              if (filters.search) params.set('q', filters.search);
              if (filters.artistName) params.set('q', params.get('q') ? `${params.get('q')} ${filters.artistName}` : filters.artistName);
              if (filters.status?.length) params.set('status', filters.status.join(','));
              if (filters.color) params.set('color', filters.color);
              if (filters.favorite) params.set('favorite', 'true');
              setOpen(false);
              router.push(`/collection${params.size ? `?${params.toString()}` : ''}`);
            })
            .catch(() => toast.error(t('search.aiFailed')))
            .finally(() => setAiSearching(false));
        },
      });
      out.push({
        id: 'sr-ai-ask',
        label: t('search.askAssistant'),
        group: t('search.groupAi'),
        icon: <Sparkles className="size-4" />,
        run: () => {
          setPendingQuestion(query.trim());
          setOpen(false);
          setAssistantOpen(true);
        },
      });
    }
    return out;
  }, [query, results, t, go, router, locale, aiSearching, setOpen, setAssistantOpen, setPendingQuestion]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const staticMatches = commands.filter((c) =>
      `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q),
    );
    return [...searchCommands, ...staticMatches];
  }, [commands, searchCommands, query]);

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
