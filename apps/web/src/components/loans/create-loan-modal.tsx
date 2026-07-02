'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { X, Search, Check, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { artworkRepository } from '@/lib/data';
import { resolveLocalized } from '@arterio/shared';
import { useLocale } from 'next-intl';

interface ArtworkOption {
  id: string;
  title: string;
  artistName: string | null;
}

export function CreateLoanModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const locale = useLocale() as 'en' | 'fr' | 'it' | 'es' | 'de' | 'nl';
  const [counterparty, setCounterparty] = React.useState('');
  const [direction, setDirection] = React.useState<'out' | 'in'>('out');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [results, setResults] = React.useState<ArtworkOption[]>([]);
  const [selected, setSelected] = React.useState<ArtworkOption[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setCounterparty('');
      setDirection('out');
      setStartDate('');
      setEndDate('');
      setSearch('');
      setResults([]);
      setSelected([]);
    }
  }, [open]);

  React.useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const page = await artworkRepository.list({ search: search.trim(), limit: 6 });
        setResults(
          page.items.map((a) => ({
            id: a.id,
            title: resolveLocalized(a.title, locale) || a.inventoryNumber,
            artistName: a.artistName ?? null,
          })),
        );
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [search, locale]);

  const addArtwork = (a: ArtworkOption) => {
    if (selected.some((s) => s.id === a.id)) return;
    setSelected((s) => [...s, a]);
    setSearch('');
    setResults([]);
  };

  const removeArtwork = (id: string) => setSelected((s) => s.filter((a) => a.id !== id));

  const canSubmit = counterparty.trim().length > 0 && selected.length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await apiFetch('/loans', {
        method: 'POST',
        body: JSON.stringify({
          counterparty: counterparty.trim(),
          direction: direction === 'out' ? 'outgoing' : 'incoming',
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          artworkIds: selected.map((a) => a.id),
        }),
      });
      toast.success('Prêt créé');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la création du prêt');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-semibold text-foreground">Prêter une œuvre</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Direction */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Sens du prêt</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('out')}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${direction === 'out' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
              >
                <ArrowUpFromLine className="h-4 w-4" /> Sortant (on prête)
              </button>
              <button
                type="button"
                onClick={() => setDirection('in')}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${direction === 'in' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
              >
                <ArrowDownToLine className="h-4 w-4" /> Entrant (on emprunte)
              </button>
            </div>
          </div>

          {/* Counterparty */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {direction === 'out' ? "Emprunteur (qui reçoit l'œuvre)" : 'Prêteur (qui nous prête)'}
            </label>
            <input
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder="ex. Musée du Louvre, Paris"
              className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Date de départ</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Retour prévu</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Artwork picker */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Œuvre(s) concernée(s)</label>
            <div className="relative mt-1.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une œuvre par titre, artiste, n° inventaire…"
                className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {results.length > 0 && (
              <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-border bg-card">
                {results.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => addArtwork(a)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">
                      {a.title} {a.artistName && <span className="text-muted-foreground">· {a.artistName}</span>}
                    </span>
                    {selected.some((s) => s.id === a.id) && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                ))}
              </div>
            )}
            {selected.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.map((a) => (
                  <span key={a.id} className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                    {a.title}
                    <button type="button" onClick={() => removeArtwork(a.id)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Création…' : 'Créer le prêt'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
