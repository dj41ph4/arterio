'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ImagePlus, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { ARTWORK_STATUS, CONDITION_RATING, CURRENCY, type ArtworkView, type Currency, type Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { useCreateArtwork, useUpdateArtwork } from '@/hooks/use-artworks';
import { useCollections } from '@/hooks/use-collections';
import { useAiAvailable } from '@/hooks/use-ai-available';
import { aiApi } from '@/lib/data/ai';
import { artworkRepository } from '@/lib/data';
import { ApiError } from '@/lib/api/client';

interface ArtworkFormModalProps {
  open: boolean;
  onClose: () => void;
  artwork?: ArtworkView | null;
  /** Pre-fills and links the new artwork to this artist — used by "create artwork by this artist". */
  defaultArtistId?: string;
  defaultArtistName?: string;
}

interface FormState {
  title: string;
  artistName: string;
  year: string;
  techniqueName: string;
  collectionId: string;
  status: string;
  condition: string;
  currentValue: string;
  insuranceValue: string;
  currency: string;
  description: string;
  tags: string;
}

function emptyForm(): FormState {
  return {
    title: '', artistName: '', year: '', techniqueName: '', collectionId: '',
    status: 'draft', condition: 'unknown', currentValue: '', insuranceValue: '',
    currency: 'EUR', description: '', tags: '',
  };
}

function fromArtwork(art: ArtworkView, locale: Locale): FormState {
  return {
    title: resolveLocalized(art.title, locale),
    artistName: art.artistName ?? '',
    year: art.yearFrom != null ? String(art.yearFrom) : '',
    techniqueName: art.techniqueName ?? '',
    collectionId: art.collectionId ?? '',
    status: art.status,
    condition: art.condition,
    currentValue: art.valuation?.currentValue != null ? String(art.valuation.currentValue) : '',
    insuranceValue: art.valuation?.insuranceValue != null ? String(art.valuation.insuranceValue) : '',
    currency: art.valuation?.currency ?? 'EUR',
    description: resolveLocalized(art.description, locale),
    tags: art.tags.join(', '),
  };
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {children}{required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

const inputClass = 'mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring';

export function ArtworkFormModal({ open, onClose, artwork, defaultArtistId, defaultArtistName }: ArtworkFormModalProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const isEdit = !!artwork;
  const create = useCreateArtwork();
  const update = useUpdateArtwork();
  const { data: collections = [] } = useCollections();

  const [form, setForm] = React.useState<FormState>(emptyForm());
  const [aiImageUrl, setAiImageUrl] = React.useState<string | null>(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const aiAvailable = useAiAvailable();

  React.useEffect(() => {
    if (!open) return;
    if (artwork) setForm(fromArtwork(artwork, locale));
    else setForm({ ...emptyForm(), artistName: defaultArtistName ?? '' });
    setAiImageUrl(null);
  }, [open, artwork, locale, defaultArtistName]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const saving = create.isPending || update.isPending;

  const handleAiAutofill = async () => {
    if (!form.title.trim() && !form.artistName.trim()) return;
    setAiLoading(true);
    try {
      const { data, meta } = await aiApi.autofillArtwork({
        title: form.title.trim() || undefined,
        artistName: form.artistName.trim() || undefined,
        locale,
      });
      // eslint-disable-next-line no-console -- intentional human-readable AI debug trail, see CLAUDE.md AI section
      console.info('[AI autofill:artwork]', meta.message, meta.attempts);
      if (data.imageUrl) setAiImageUrl(data.imageUrl);
      if (!meta.hasUsableData) {
        toast.error(meta.message);
        return;
      }
      setForm((f) => ({
        ...f,
        description: f.description || data.description || f.description,
        techniqueName: f.techniqueName || data.techniqueName || f.techniqueName,
        year: f.year || (data.yearFrom ? String(data.yearFrom) : f.year),
        condition: data.condition && CONDITION_RATING.includes(data.condition as never) ? data.condition : f.condition,
        tags: f.tags || (data.tags?.length ? data.tags.join(', ') : f.tags),
      }));
      toast.success(meta.message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('artwork.form.aiError'));
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error(t('artwork.form.titleRequired'));
      return;
    }
    const collection = collections.find((c) => c.id === form.collectionId);
    const payload: Partial<ArtworkView> = {
      title: { [locale]: form.title.trim() },
      description: form.description.trim() ? { [locale]: form.description.trim() } : {},
      artistName: form.artistName.trim() || null,
      ...(!isEdit && defaultArtistId ? { artistId: defaultArtistId } : {}),
      yearFrom: form.year ? Number(form.year) : null,
      dateText: form.year || null,
      techniqueName: form.techniqueName.trim() || null,
      collectionId: form.collectionId || null,
      collectionName: collection?.name ?? null,
      collectionColor: collection?.color ?? null,
      status: form.status as ArtworkView['status'],
      condition: form.condition as ArtworkView['condition'],
      valuation: (form.currentValue || form.insuranceValue)
        ? {
            currency: form.currency as Currency,
            currentValue: form.currentValue ? Number(form.currentValue) : null,
            insuranceValue: form.insuranceValue ? Number(form.insuranceValue) : null,
            purchasePrice: artwork?.valuation?.purchasePrice ?? null,
          }
        : null,
      tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
    };

    try {
      let saved: ArtworkView;
      if (isEdit && artwork) {
        saved = await update.mutateAsync({ id: artwork.id, patch: payload });
        toast.success(t('artwork.form.updateSuccess'));
      } else {
        saved = await create.mutateAsync(payload);
        toast.success(t('artwork.form.createSuccess'));
      }
      if (aiImageUrl) {
        artworkRepository.attachMediaFromUrl(saved.id, aiImageUrl).catch(() => {
          toast.error(t('artwork.form.aiImageError'));
        });
      }
      onClose();
    } catch {
      toast.error(t('artwork.form.error'));
    }
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
        className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <ImagePlus className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-foreground">
              {isEdit ? t('artwork.form.editTitle') : t('artwork.form.createTitle')}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FieldLabel required>{t('artwork.fields.title')}</FieldLabel>
              <input autoFocus type="text" value={form.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
            </div>

            <div>
              <FieldLabel>{t('artwork.fields.artist')}</FieldLabel>
              <div className="mt-1.5 flex gap-2">
                <input type="text" value={form.artistName} onChange={(e) => set('artistName', e.target.value)} className={`${inputClass} mt-0`} />
                {aiAvailable && (
                  <button
                    type="button"
                    title={t('artwork.form.aiAutofill')}
                    disabled={aiLoading || (!form.title.trim() && !form.artistName.trim())}
                    onClick={handleAiAutofill}
                    className="flex shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 px-3 text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                  >
                    {aiLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>
            <div>
              <FieldLabel>{t('artwork.fields.date')}</FieldLabel>
              <input type="text" inputMode="numeric" placeholder="1937" value={form.year} onChange={(e) => set('year', e.target.value)} className={inputClass} />
            </div>

            <div>
              <FieldLabel>{t('artwork.fields.technique')}</FieldLabel>
              <input type="text" value={form.techniqueName} onChange={(e) => set('techniqueName', e.target.value)} className={inputClass} />
            </div>
            <div>
              <FieldLabel>{t('artwork.fields.collection')}</FieldLabel>
              <select value={form.collectionId} onChange={(e) => set('collectionId', e.target.value)} className={inputClass}>
                <option value="">—</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel>{t('artwork.fields.status')}</FieldLabel>
              <select value={form.status} onChange={(e) => set('status', e.target.value)} className={inputClass}>
                {ARTWORK_STATUS.map((s) => (
                  <option key={s} value={s}>{t(`status.${s}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{t('artwork.fields.condition')}</FieldLabel>
              <select value={form.condition} onChange={(e) => set('condition', e.target.value)} className={inputClass}>
                {CONDITION_RATING.map((c) => (
                  <option key={c} value={c}>{t(`condition.${c}`)}</option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel>{t('artwork.fields.value')}</FieldLabel>
              <input type="number" min="0" value={form.currentValue} onChange={(e) => set('currentValue', e.target.value)} className={inputClass} />
            </div>
            <div>
              <FieldLabel>{t('artwork.fields.insuranceValue')}</FieldLabel>
              <input type="number" min="0" value={form.insuranceValue} onChange={(e) => set('insuranceValue', e.target.value)} className={inputClass} />
            </div>

            <div>
              <FieldLabel>{t('artwork.form.currency')}</FieldLabel>
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={inputClass}>
                {CURRENCY.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>{t('artwork.fields.tags')}</FieldLabel>
              <input type="text" placeholder={t('artwork.form.tagsPlaceholder')} value={form.tags} onChange={(e) => set('tags', e.target.value)} className={inputClass} />
            </div>

            <div className="col-span-2">
              <FieldLabel>{t('artwork.fields.description')}</FieldLabel>
              <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} className={`${inputClass} resize-none`} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            {t('common.cancel')}
          </button>
          <button
            disabled={saving}
            onClick={handleSubmit}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
            {t('common.save')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
