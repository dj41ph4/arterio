'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, RefreshCw, Check } from 'lucide-react';
import { toast } from 'sonner';
import { enrichArtistLive } from '@/lib/wikipedia-enrichment';
import { artistRepository, type ArtistView } from '@/lib/data/artist-repository';
import { useAiAvailable } from '@/hooks/use-ai-available';
import { aiApi } from '@/lib/data/ai';
import { ApiError } from '@/lib/api/client';
import { useLocale } from 'next-intl';
import type { Locale } from '@arterio/shared';

interface AddArtistModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: (artist: ArtistView) => void;
}

type Status = 'idle' | 'loading' | 'done' | 'notfound';

export function AddArtistModal({ open, onClose, onAdded }: AddArtistModalProps) {
  const locale = useLocale() as Locale;
  const aiAvailable = useAiAvailable();
  const [name, setName] = React.useState('');
  const [status, setStatus] = React.useState<Status>('idle');
  const [log, setLog] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<ArtistView | null>(null);

  const reset = () => {
    setName('');
    setStatus('idle');
    setLog([]);
    setResult(null);
  };

  const addLog = (msg: string) => setLog((l) => [...l, msg]);

  const handleEnrich = async () => {
    if (!name.trim()) return;
    setStatus('loading');
    setLog([]);
    addLog(`Recherche de "${name}" sur Wikidata…`);
    try {
      const data = await enrichArtistLive(name.trim());
      if (!data.qid) {
        setStatus('notfound');
        addLog('Aucune entrée Wikidata trouvée pour ce nom.');
        return;
      }
      const canonicalName = data.label ?? name.trim();
      if (canonicalName !== name.trim()) {
        addLog(`Nom corrigé d'après Wikidata : "${canonicalName}"`);
      }
      addLog(`Trouvé : ${data.qid} — ${data.nationality ?? 'nationalité inconnue'}`);
      addLog(`Récupération des biographies (${Object.keys(data.biographies).length} langues trouvées)…`);
      if (data.imageUrl) addLog('Portrait récupéré depuis Wikimedia Commons.');
      if (data.ulanId) addLog(`Identifiant Getty ULAN : ${data.ulanId}`);
      if (data.viafId) addLog(`Identifiant VIAF : ${data.viafId}`);

      const artist: ArtistView = {
        id: `artist-${data.qid.toLowerCase()}`,
        fullName: canonicalName,
        sortName: canonicalName,
        nationality: data.nationality,
        birthDate: data.birthDate,
        deathDate: data.deathDate,
        biography: data.biographies,
        movement: data.movement ? { id: data.movement.toLowerCase().replace(/\s+/g, '-'), name: data.movement } : undefined,
        externalIds: {
          wikidata: data.qid,
          ulan: data.ulanId,
          viaf: data.viafId,
        },
        externalUrls: {
          wikipedia: data.sourceUrls.wikipedia,
          wikidata: data.sourceUrls.wikidata,
          ulan: data.ulanId ? `https://vocab.getty.edu/ulan/${data.ulanId}` : undefined,
          viaf: data.viafId ? `https://viaf.org/viaf/${data.viafId}` : undefined,
        },
        thumbnail: data.imageUrl,
        artworkCount: 0,
        artworkIds: [],
        notableWorks: data.notableWorks,
        influencedBy: data.influencedBy,
      };

      await artistRepository.add(artist);
      setResult(artist);
      setStatus('done');
      addLog('Fiche artiste créée avec succès.');
      toast.success(`${canonicalName} ajouté avec données Wikipedia en direct`);
    } catch (err) {
      setStatus('notfound');
      addLog(`Erreur : ${String(err)}`);
    }
  };

  const handleAiEnrich = async () => {
    if (!name.trim()) return;
    setStatus('loading');
    setLog([]);
    addLog(`Recherche IA de "${name}"…`);
    try {
      const { data, meta } = await aiApi.autofillArtist({ fullName: name.trim(), locale });
      addLog(meta.message);
      if (!meta.hasUsableData) {
        setStatus('notfound');
        toast.error(meta.message);
        return;
      }
      const artist: ArtistView = {
        id: `artist-ai-${Date.now()}`,
        fullName: name.trim(),
        sortName: name.trim(),
        nationality: data.nationality,
        birthDate: data.birthDate,
        deathDate: data.deathDate,
        biography: data.biography ? { [locale]: data.biography } : {},
        movement: data.movement ? { id: data.movement.toLowerCase().replace(/\s+/g, '-'), name: data.movement } : undefined,
        externalIds: {},
        externalUrls: {},
        thumbnail: data.imageUrl,
        artworkCount: 0,
        artworkIds: [],
      };
      await artistRepository.add(artist);
      setResult(artist);
      setStatus('done');
      addLog('Fiche artiste créée avec succès.');
      toast.success(meta.message);
    } catch (err) {
      setStatus('notfound');
      const message = err instanceof ApiError ? err.message : String(err);
      addLog(`Erreur : ${message}`);
      toast.error(message);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => { reset(); onClose(); }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">Nouvel artiste — recherche Wikipedia en direct</h2>
          </div>
          <button onClick={() => { reset(); onClose(); }} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nom complet de l'artiste</label>
            <div className="mt-1.5 flex gap-2">
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEnrich()}
                placeholder="ex. Vincent van Gogh"
                disabled={status === 'loading'}
                className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={handleEnrich}
                disabled={status === 'loading' || !name.trim()}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {status === 'loading' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Rechercher
              </button>
              {aiAvailable && (
                <button
                  onClick={handleAiEnrich}
                  disabled={status === 'loading' || !name.trim()}
                  title="Recherche IA (si Wikidata ne trouve rien)"
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                >
                  IA
                </button>
              )}
            </div>
          </div>

          {/* Live log */}
          {log.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/40 p-4 font-mono text-xs space-y-1.5">
              {log.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-muted-foreground"
                >
                  {status === 'done' && i === log.length - 1 ? (
                    <span className="flex items-center gap-1.5 text-green-500"><Check className="h-3 w-3" /> {line}</span>
                  ) : (
                    `› ${line}`
                  )}
                </motion.div>
              ))}
            </div>
          )}

          {status === 'notfound' && log.length === 1 && (
            <p className="text-sm text-amber-500">Essayez avec le nom complet (prénom + nom).</p>
          )}

          {/* Result preview */}
          {result && status === 'done' && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
              {result.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={result.thumbnail} alt={result.fullName} className="h-16 w-16 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{result.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {result.nationality} · {result.birthDate?.slice(0, 4)}–{result.deathDate?.slice(0, 4) ?? ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Object.keys(result.biography).length} biographie(s) récupérée(s) ({Object.keys(result.biography).join(', ').toUpperCase()})
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          {status === 'done' ? (
            <button
              onClick={() => { if (result) onAdded(result); reset(); onClose(); }}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Voir la fiche
            </button>
          ) : (
            <button onClick={() => { reset(); onClose(); }} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
              Annuler
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
