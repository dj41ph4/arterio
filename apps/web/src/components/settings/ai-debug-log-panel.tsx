'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bug, RefreshCw, Trash2, CheckCircle2, XCircle, Minus, ChevronDown, ChevronRight } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';

interface AiDebugEntry {
  id: string;
  ts: string;
  op: 'autofill_artwork' | 'autofill_artist' | 'find_images' | 'enrichment';
  input: { artistName?: string; title?: string; fullName?: string };
  ddgContextBytes: number | null;
  structuredHit: { source: string; matchedTitle: string } | null;
  provider: string | null;
  success: boolean;
  fieldsFound: string[];
  imageSource: 'wikiart' | 'commons' | 'artsy' | 'ai-search' | null;
  durationMs: number;
  error?: string;
}

const OP_LABELS: Record<string, string> = {
  autofill_artwork: 'Autofill œuvre',
  autofill_artist: 'Autofill artiste',
  find_images: 'Recherche images',
  enrichment: 'Enrichissement',
};

const FIELD_LABELS: Record<string, string> = {
  description: 'description',
  techniqueName: 'technique',
  dateText: 'date',
  yearFrom: 'année',
  heightCm: 'hauteur',
  widthCm: 'largeur',
  dimensionsNote: 'dimensions',
  signatureDescription: 'signature',
  condition: 'état',
  tags: 'tags',
  imageUrl: 'image',
  biography: 'biographie',
  nationality: 'nationalité',
  birthDate: 'naissance',
  deathDate: 'décès',
  movement: 'mouvement',
};

function EntryRow({ entry }: { entry: AiDebugEntry }) {
  const [open, setOpen] = React.useState(false);
  const label = entry.input.title
    ? `${entry.input.artistName ?? '?'} — "${entry.input.title}"`
    : (entry.input.fullName ?? entry.input.artistName ?? '?');

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
      >
        {entry.success ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : entry.error ? (
          <XCircle className="h-4 w-4 shrink-0 text-red-500" />
        ) : (
          <Minus className="h-4 w-4 shrink-0 text-amber-400" />
        )}

        <span className="min-w-[120px] shrink-0 text-xs font-medium text-muted-foreground">
          {OP_LABELS[entry.op] ?? entry.op}
        </span>

        <span className="flex-1 truncate text-sm text-foreground">{label}</span>

        <span className="shrink-0 text-xs text-muted-foreground">{entry.durationMs}ms</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {new Date(entry.ts).toLocaleTimeString()}
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 bg-muted/30 px-4 py-3 text-xs sm:grid-cols-3">
          <Detail label="DDG contexte" value={entry.ddgContextBytes !== null ? `${entry.ddgContextBytes} octets` : 'aucun'} warn={entry.ddgContextBytes === null} />
          <Detail label="Source structurée" value={entry.structuredHit ? `${entry.structuredHit.source} — ${entry.structuredHit.matchedTitle}` : 'aucune'} />
          <Detail label="Fournisseur IA" value={entry.provider ?? '—'} />
          <Detail label="Image trouvée" value={entry.imageSource ?? 'non'} warn={!entry.imageSource} />
          <Detail
            label="Champs remplis"
            value={entry.fieldsFound.length ? entry.fieldsFound.map((f) => FIELD_LABELS[f] ?? f).join(', ') : 'aucun'}
            warn={entry.fieldsFound.length === 0}
          />
          {entry.error && <Detail label="Erreur" value={entry.error} warn />}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={warn ? 'font-medium text-amber-500' : 'text-foreground'}>{value}</span>
    </div>
  );
}

export function AiDebugLogPanel() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-debug-log'],
    queryFn: () => apiFetch<{ entries: AiDebugEntry[]; serverStarted: string }>('/ai/debug-log'),
    staleTime: 0,
    refetchInterval: 10_000,
  });

  const clearMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/ai/debug-log', { method: 'DELETE' }),
    onSuccess: () => {
      qc.setQueryData(['ai-debug-log'], []);
      toast.success('Logs effacés');
    },
    onError: () => toast.error('Échec de la suppression'),
  });

  const entries = data?.entries ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-primary" /> Logs IA (debug)
          </CardTitle>
          <CardDescription>
            Dernières opérations d'autofill — DDG, sources structurées, fournisseur utilisé, champs obtenus.
            Remis à zéro au redémarrage du serveur. Rafraîchi toutes les 10 s.
            {data?.serverStarted && (
              <span className="ml-1 text-[10px] text-muted-foreground/60">
                · serveur démarré {new Date(data.serverStarted).toLocaleString()}
              </span>
            )}
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir
          </button>
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending || entries.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" /> Effacer
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucune opération IA enregistrée depuis le démarrage du serveur.
            <br />
            Lance un autofill depuis une fiche œuvre ou artiste pour voir les données ici.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {/* Résumé rapide */}
            <div className="flex gap-6 px-4 py-3 text-xs text-muted-foreground">
              <span><strong className="text-foreground">{entries.length}</strong> opérations</span>
              <span><strong className="text-emerald-500">{entries.filter(e => e.success).length}</strong> succès</span>
              <span><strong className="text-amber-400">{entries.filter(e => !e.success && !e.error).length}</strong> partiels</span>
              <span><strong className="text-red-500">{entries.filter(e => e.error).length}</strong> erreurs</span>
              <span><strong className="text-foreground">{entries.filter(e => e.ddgContextBytes === null).length}</strong> sans contexte DDG</span>
            </div>
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
