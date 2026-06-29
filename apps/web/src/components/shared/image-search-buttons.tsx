'use client';

import * as React from 'react';
import { RefreshCw, Image as ImageIcon, Sparkles, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAiAvailable } from '@/hooks/use-ai-available';
import { ApiError } from '@/lib/api/client';
import type { ImageSearchResult } from '@/lib/data/ai';

interface ImageSearchButtonsProps {
  /** WikiArt + Wikimedia Commons — no AI/LLM call, always available. */
  onSearchWiki: () => Promise<ImageSearchResult>;
  /** AI-grounded web search — only rendered when OpenRouter is configured for this org. */
  onSearchAi: () => Promise<ImageSearchResult>;
  /** Called once per clicked candidate — the caller decides whether that means "attach to gallery" or "set as the single photo". */
  onPick: (url: string) => void;
  disabled?: boolean;
}

/**
 * "Wiki" + "IA" image-search buttons for an artwork/artist photo field —
 * shows real candidate thumbnails to pick from instead of auto-picking one,
 * since "as many images as possible" means showing options, not guessing
 * which single hit the user wants.
 */
export function ImageSearchButtons({ onSearchWiki, onSearchAi, onPick, disabled }: ImageSearchButtonsProps) {
  const aiAvailable = useAiAvailable();
  const [loading, setLoading] = React.useState<'wiki' | 'ai' | null>(null);
  const [results, setResults] = React.useState<string[] | null>(null);

  const run = async (which: 'wiki' | 'ai') => {
    setLoading(which);
    try {
      const { images, message } = which === 'wiki' ? await onSearchWiki() : await onSearchAi();
      setResults(images);
      if (images.length) toast.success(message);
      else toast.error(message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Échec de la recherche d'images");
      setResults([]);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || loading !== null}
          onClick={() => run('wiki')}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {loading === 'wiki' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          Wiki
        </button>
        {aiAvailable && (
          <button
            type="button"
            disabled={disabled || loading !== null}
            onClick={() => run('ai')}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            {loading === 'ai' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            IA
          </button>
        )}
      </div>

      {results !== null && results.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {results.map((url) => (
            <button
              key={url}
              type="button"
              onClick={() => {
                onPick(url);
                setResults((r) => r?.filter((u) => u !== url) ?? null);
              }}
              className="group relative aspect-square overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
              title="Ajouter cette image"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
                <Plus className="h-5 w-5" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
