'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, Check } from 'lucide-react';
import { artistRepository, type ArtistView } from '@/lib/data/artist-repository';
import { aiApi } from '@/lib/data/ai';
import { ApiError } from '@/lib/api/client';
import { useLocale } from 'next-intl';
import type { Locale } from '@arterio/shared';
import { AutofillButtons, type AutofillOutcome } from '@/components/shared/autofill-buttons';

interface AddArtistModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: (artist: ArtistView) => void;
}

type Status = 'idle' | 'loading' | 'done' | 'notfound';

export function AddArtistModal({ open, onClose, onAdded }: AddArtistModalProps) {
  const locale = useLocale() as Locale;
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

  /** Same backend pipeline as every other "réessayer enrichissement" button — Wikidata,
   *  Wikipedia, museum APIs, DBpedia, gallery scrapers and AI translation, instead of the
   *  old client-side Wikidata/Wikipedia-only lookup that skipped all of that. */
  const handleEnrich = async (): Promise<AutofillOutcome> => {
    if (!name.trim()) return { message: 'Entrez un nom.', success: false };
    setStatus('loading');
    setLog([]);
    addLog(`Recherche de "${name.trim()}" via Wikidata/Wikipédia (+ sources de secours)…`);
    try {
      const created = await artistRepository.add({
        id: '',
        fullName: name.trim(),
        sortName: name.trim(),
        biography: {},
        externalIds: {},
        externalUrls: {},
        artworkCount: 0,
        artworkIds: [],
      } as ArtistView);

      if (Object.keys(created.externalIds).length === 0) {
        setStatus('notfound');
        const message = 'Aucune information trouvée pour ce nom (Wikidata, musées, sources de secours).';
        addLog(message);
        setResult(created);
        return { message, success: false };
      }

      if (created.fullName !== name.trim()) {
        addLog(`Nom corrigé d'après les sources : "${created.fullName}"`);
      }
      addLog(`Trouvé — ${created.nationality ?? 'nationalité inconnue'}`);
      addLog(`${Object.keys(created.biography).length} biographie(s) récupérée(s) (${Object.keys(created.biography).join(', ').toUpperCase()}).`);
      if (created.thumbnail) addLog('Portrait récupéré.');
      if (created.externalIds.ulan) addLog(`Identifiant Getty ULAN : ${created.externalIds.ulan}`);
      if (created.externalIds.viaf) addLog(`Identifiant VIAF : ${created.externalIds.viaf}`);

      setResult(created);
      setStatus('done');
      addLog('Fiche artiste créée avec succès.');
      return { message: `${created.fullName} ajouté avec enrichissement complet`, success: true };
    } catch (err) {
      setStatus('notfound');
      const message = `Erreur : ${err instanceof ApiError ? err.message : String(err)}`;
      addLog(message);
      return { message, success: false };
    }
  };

  const handleAiEnrich = async (): Promise<AutofillOutcome> => {
    if (!name.trim()) return { message: 'Entrez un nom.', success: false };
    setStatus('loading');
    setLog([]);
    addLog(`Recherche IA de "${name}"…`);
    try {
      const { data, meta } = await aiApi.autofillArtist({ fullName: name.trim(), locale });
      addLog(meta.message);
      if (!meta.hasUsableData) {
        setStatus('notfound');
        return { message: meta.message, success: false };
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
      return { message: meta.message, success: true };
    } catch (err) {
      setStatus('notfound');
      const message = err instanceof ApiError ? err.message : String(err);
      addLog(`Erreur : ${message}`);
      return { message, success: false };
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
              <AutofillButtons onWiki={handleEnrich} onAi={handleAiEnrich} disabled={!name.trim()} />
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
