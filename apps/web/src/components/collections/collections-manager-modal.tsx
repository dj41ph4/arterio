'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Pencil, Trash2, LibraryBig, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useFacets } from '@/hooks/use-artworks';
import {
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
} from '@/hooks/use-collections';
import type { CollectionView } from '@/lib/data/collection-repository';

const COLOR_PRESETS = [
  '#b45309', '#0ea5e9', '#8b5cf6', '#10b981', '#ec4899',
  '#ef4444', '#f59e0b', '#06b6d4', '#6366f1', '#84cc16',
];

interface CollectionFormState {
  id: string | null;
  name: string;
  description: string;
  color: string;
}

const EMPTY_FORM: CollectionFormState = { id: null, name: '', description: '', color: COLOR_PRESETS[0]! };

export function CollectionsManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations();
  const { data: collections = [], isLoading } = useCollections();
  const { data: facets } = useFacets();
  const createMutation = useCreateCollection();
  const updateMutation = useUpdateCollection();
  const deleteMutation = useDeleteCollection();

  const [form, setForm] = React.useState<CollectionFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<CollectionView | null>(null);

  const countFor = (id: string) => facets?.collection.find((c) => c.value === id)?.count ?? 0;

  const handleSubmit = async () => {
    if (!form || !form.name.trim()) {
      toast.error(t('collections.nameRequired'));
      return;
    }
    if (form.id) {
      await updateMutation.mutateAsync({
        id: form.id,
        patch: { name: form.name.trim(), description: form.description.trim() || undefined, color: form.color },
      });
      toast.success(t('collections.updated'));
    } else {
      await createMutation.mutateAsync({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        color: form.color,
      });
      toast.success(t('collections.created'));
    }
    setForm(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync(deleteTarget.id);
    toast.success(t('collections.deleted'));
    setDeleteTarget(null);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2 }}
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <LibraryBig className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">{t('collections.title')}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence initial={false}>
            {form ? (
              // ── Create / edit form ──────────────────────────────────────
              <motion.div key="form" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('collections.name')}</label>
                  <input
                    autoFocus
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t('collections.namePlaceholder')}
                    className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('collections.description')}</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder={t('collections.descriptionPlaceholder')}
                    rows={2}
                    className="mt-1.5 w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t('collections.color')}</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setForm({ ...form, color: c })}
                        style={{ background: c }}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110',
                          form.color === c && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                        )}
                      >
                        {form.color === c && <Check className="h-4 w-4 text-white" />}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : (
              // ── List ─────────────────────────────────────────────────────
              <motion.div key="list" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-2">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />)
                ) : collections.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                    <LibraryBig className="h-8 w-8 opacity-40" />
                    <p className="text-sm">{t('collections.empty')}</p>
                  </div>
                ) : (
                  collections.map((c) => (
                    <div
                      key={c.id}
                      className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                    >
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                        {c.description && <p className="truncate text-xs text-muted-foreground">{c.description}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('collections.worksCount', { count: countFor(c.id) })}
                      </span>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => setForm({ id: c.id, name: c.name, description: c.description ?? '', color: c.color })}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Delete confirm inline */}
          {deleteTarget && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="flex-1 text-sm">
                <p className="text-red-500">{t('collections.deleteConfirm', { name: deleteTarget.name })}</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setDeleteTarget(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                    {t('common.cancel')}
                  </button>
                  <button onClick={handleDelete} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          {form ? (
            <button onClick={() => setForm(null)} className="text-sm text-muted-foreground hover:text-foreground">
              ← {t('common.back')}
            </button>
          ) : (
            <button
              onClick={() => setForm(EMPTY_FORM)}
              className="flex items-center gap-2 text-sm font-medium text-primary hover:opacity-80"
            >
              <Plus className="h-4 w-4" />
              {t('collections.add')}
            </button>
          )}
          {form && (
            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t('common.save')}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
