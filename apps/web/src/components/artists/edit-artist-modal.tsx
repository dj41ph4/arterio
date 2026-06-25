'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { X, Save, RefreshCw, AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { artistRepository, type ArtistView } from '@/lib/data/artist-repository';
import { LOCALES, LOCALE_META, type Locale } from '@arterio/shared';
import { cn } from '@/lib/utils';

interface EditArtistModalProps {
  artist: ArtistView;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

export function EditArtistModal({ artist, open, onClose, onDeleted }: EditArtistModalProps) {
  const qc = useQueryClient();
  const [fullName, setFullName] = React.useState(artist.fullName);
  const [nationality, setNationality] = React.useState(artist.nationality ?? '');
  const [birthDate, setBirthDate] = React.useState(artist.birthDate ?? '');
  const [deathDate, setDeathDate] = React.useState(artist.deathDate ?? '');
  const [thumbnail, setThumbnail] = React.useState(artist.thumbnail ?? '');
  const [bioLocale, setBioLocale] = React.useState<Locale>('fr');
  const [biography, setBiography] = React.useState<Partial<Record<Locale, string>>>(artist.biography ?? {});
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFullName(artist.fullName);
    setNationality(artist.nationality ?? '');
    setBirthDate(artist.birthDate ?? '');
    setDeathDate(artist.deathDate ?? '');
    setThumbnail(artist.thumbnail ?? '');
    setBiography(artist.biography ?? {});
    setConfirmDelete(false);
    setConfirmReset(false);
  }, [open, artist]);

  const saveMutation = useMutation({
    mutationFn: () =>
      artistRepository.update(artist.id, {
        fullName: fullName.trim(),
        nationality,
        birthDate,
        deathDate,
        thumbnail,
        biography,
      }),
    onSuccess: () => {
      toast.success('Artiste mis à jour');
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      qc.invalidateQueries({ queryKey: ['artist', artist.id] });
      onClose();
    },
    onError: () => toast.error('Échec de la mise à jour'),
  });

  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const uploadPhotoMutation = useMutation({
    mutationFn: (file: File) => artistRepository.uploadPhoto(artist.id, file),
    onSuccess: (updated) => {
      setThumbnail(updated.thumbnail ?? '');
      toast.success('Photo mise à jour');
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      qc.invalidateQueries({ queryKey: ['artist', artist.id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Échec de l'envoi de la photo"),
  });

  const resetMutation = useMutation({
    mutationFn: () => artistRepository.update(artist.id, { resetEnrichment: true }),
    onSuccess: () => {
      toast.success('Enrichissement réinitialisé — relancez la recherche après correction du nom');
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      qc.invalidateQueries({ queryKey: ['artist', artist.id] });
      setConfirmReset(false);
      onClose();
    },
    onError: () => toast.error('Échec de la réinitialisation'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => artistRepository.remove(artist.id, artist.artworkCount > 0),
    onSuccess: () => {
      toast.success(`${artist.fullName} supprimé`);
      qc.invalidateQueries({ queryKey: ['artists-all'] });
      onClose();
      onDeleted?.();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Échec de la suppression'),
  });

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
        transition={{ duration: 0.2 }}
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-semibold text-foreground">Modifier l'artiste</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nom complet</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nationalité</label>
              <input
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                placeholder="ex. France"
                className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Photo</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  value={thumbnail}
                  onChange={(e) => setThumbnail(e.target.value)}
                  placeholder="https://… ou importer un fichier"
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadPhotoMutation.isPending}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {uploadPhotoMutation.isPending ? 'Envoi…' : 'Importer'}
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) uploadPhotoMutation.mutate(file);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Naissance</label>
              <input
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                placeholder="AAAA-MM-JJ"
                className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Décès</label>
              <input
                value={deathDate}
                onChange={(e) => setDeathDate(e.target.value)}
                placeholder="AAAA-MM-JJ"
                className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Biographie</label>
            <div className="mt-1.5 flex gap-1">
              {LOCALES.map((l) => (
                <button
                  key={l}
                  onClick={() => setBioLocale(l)}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium uppercase transition-colors',
                    bioLocale === l ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {LOCALE_META[l].flag} {l}
                </button>
              ))}
            </div>
            <textarea
              value={biography[bioLocale] ?? ''}
              onChange={(e) => setBiography((b) => ({ ...b, [bioLocale]: e.target.value }))}
              rows={5}
              placeholder={`Biographie en ${LOCALE_META[bioLocale].nativeLabel}…`}
              className="mt-1.5 w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Danger zone */}
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
              <AlertTriangle className="h-3.5 w-3.5" /> Zone sensible
            </p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Réinitialise la biographie, la photo, le mouvement et les identifiants externes
                (utile si une mauvaise correspondance a été trouvée — homonyme).
              </p>
              {confirmReset ? (
                <div className="flex shrink-0 gap-1.5">
                  <button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending} className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                    Confirmer
                  </button>
                  <button onClick={() => setConfirmReset(false)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                    Annuler
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmReset(true)} className="shrink-0 rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10">
                  Réinitialiser
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-red-500/20 pt-3">
              <p className="text-xs text-muted-foreground">
                Supprime définitivement la fiche artiste
                {artist.artworkCount > 0
                  ? ` — ${artist.artworkCount} œuvre(s) seront détachées (artiste mis à "inconnu"), pas supprimées.`
                  : '.'}
              </p>
              {confirmDelete ? (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" /> Confirmer
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="shrink-0 rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10"
                >
                  Supprimer
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
            Annuler
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !fullName.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </motion.div>
    </div>
  );
}
