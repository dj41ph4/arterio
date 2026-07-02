'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { X, Search, Check } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import { artworkRepository } from '@/lib/data';
import { resolveLocalized } from '@arterio/shared';
import { useLocale } from 'next-intl';

interface ArtworkOption {
  id: string;
  title: string;
}

const TYPES = [
  { value: 'invoice', label: 'Facture' },
  { value: 'certificate', label: 'Certificat' },
  { value: 'report', label: 'Rapport' },
  { value: 'insurance', label: 'Assurance' },
] as const;

export function CreateDocumentModal({
  open,
  onClose,
  onCreated,
  defaultArtworkId,
  defaultArtworkTitle,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultArtworkId?: string;
  defaultArtworkTitle?: string;
}) {
  const locale = useLocale() as 'en' | 'fr' | 'it' | 'es' | 'de' | 'nl';
  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState<(typeof TYPES)[number]['value']>('report');
  const [search, setSearch] = React.useState('');
  const [results, setResults] = React.useState<ArtworkOption[]>([]);
  const [artwork, setArtwork] = React.useState<ArtworkOption | null>(
    defaultArtworkId ? { id: defaultArtworkId, title: defaultArtworkTitle ?? '' } : null,
  );
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTitle('');
      setType('report');
      setSearch('');
      setResults([]);
      setArtwork(defaultArtworkId ? { id: defaultArtworkId, title: defaultArtworkTitle ?? '' } : null);
    }
  }, [open, defaultArtworkId, defaultArtworkTitle]);

  React.useEffect(() => {
    if (defaultArtworkId || !search.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const page = await artworkRepository.list({ search: search.trim(), limit: 6 });
        setResults(page.items.map((a) => ({ id: a.id, title: resolveLocalized(a.title, locale) || a.inventoryNumber })));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [search, locale, defaultArtworkId]);

  const canSubmit = title.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await apiFetch('/documents', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), type, artworkId: artwork?.id }),
      });
      toast.success('Document créé');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la création du document');
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
        className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-semibold text-foreground">Nouveau document</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Titre</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ex. Certificat d'authenticité"
              className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {TYPES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${type === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {!defaultArtworkId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Œuvre liée (optionnel)</label>
              {artwork ? (
                <div className="mt-1.5 flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-sm">
                  <span className="truncate">{artwork.title}</span>
                  <button onClick={() => setArtwork(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative mt-1.5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher une œuvre…"
                    className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}
              {results.length > 0 && !artwork && (
                <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-border bg-card">
                  {results.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => { setArtwork(a); setSearch(''); setResults([]); }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="truncate">{a.title}</span>
                      <Check className="h-3.5 w-3.5 opacity-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
            {saving ? 'Création…' : 'Créer'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
