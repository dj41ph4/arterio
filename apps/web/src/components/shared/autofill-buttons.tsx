'use client';

import * as React from 'react';
import { RefreshCw, BookOpen, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAiAvailable } from '@/hooks/use-ai-available';
import { ApiError } from '@/lib/api/client';

export interface AutofillOutcome {
  message: string;
  success: boolean;
}

interface AutofillButtonsProps {
  /** Free, structured, non-AI source (Wikidata/Wikipedia for artists). Omit entirely when no such source exists for this entity — an artwork's technique/condition/tags have no Wiki equivalent, so artwork forms only ever pass `onAi`. */
  onWiki?: () => Promise<AutofillOutcome>;
  /** AI-grounded autofill — only ever rendered when OpenRouter/Gemini is actually configured for this org. */
  onAi?: () => Promise<AutofillOutcome>;
  wikiLabel?: string;
  disabled?: boolean;
}

/**
 * Same "Wiki" / "IA" pair, same icons, same colors, in every form that offers
 * autocomplete — artwork text autofill, artist text autofill, artist photo,
 * artwork photo. Consistency here matters more than each screen picking its
 * own button style: a user shouldn't have to relearn what a button means
 * just because they moved from an artist form to an artwork form.
 */
export function AutofillButtons({ onWiki, onAi, wikiLabel = 'Wiki', disabled }: AutofillButtonsProps) {
  const aiAvailable = useAiAvailable();
  const [loading, setLoading] = React.useState<'wiki' | 'ai' | null>(null);

  const run = async (which: 'wiki' | 'ai', fn: () => Promise<AutofillOutcome>) => {
    setLoading(which);
    try {
      const { message, success } = await fn();
      if (success) toast.success(message);
      else toast.error(message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Échec de l'autocomplétion");
    } finally {
      setLoading(null);
    }
  };

  const showAi = aiAvailable && Boolean(onAi);
  if (!onWiki && !showAi) return null;

  return (
    <div className="flex items-center gap-2">
      {onWiki && (
        <button
          type="button"
          disabled={disabled || loading !== null}
          onClick={() => run('wiki', onWiki)}
          title="Recherche gratuite (Wikidata/Wikipedia)"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {loading === 'wiki' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
          {wikiLabel}
        </button>
      )}
      {showAi && (
        <button
          type="button"
          disabled={disabled || loading !== null}
          onClick={() => run('ai', onAi!)}
          title="Recherche par intelligence artificielle"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        >
          {loading === 'ai' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          IA
        </button>
      )}
    </div>
  );
}
