'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Star,
  Share2,
  Pencil,
  Maximize2,
  QrCode,
  Images,
  FileText,
  MapPin,
  History,
  Wrench,
  ScrollText,
  ShieldCheck,
  Trash2,
  Truck,
  Frame,
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react';
import type { Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { useArtwork, useToggleFavorite } from '@/hooks/use-artworks';
import { artworkRepository } from '@/lib/data';
import { aiApi } from '@/lib/data/ai';
import { ImageSearchButtons } from '@/components/shared/image-search-buttons';
import { apiFetch } from '@/lib/api/client';
import { Link, useRouter } from '@/i18n/navigation';
import { formatCurrency, formatDate, formatDimensions } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { CreateDocumentModal } from '@/components/documents/create-document-modal';
import { ArtworkThumbnail } from './thumbnail';
import { StatusBadge, ConditionBadge } from './status-badge';
import { ArtworkFormModal } from './artwork-form-modal';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children || '—'}</dd>
    </div>
  );
}

export function ArtworkDetailView({ id }: { id: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { data: art, isLoading } = useArtwork(id);
  const toggleFav = useToggleFavorite();
  const [activeImage, setActiveImage] = React.useState(0);
  const [editOpen, setEditOpen] = React.useState(false);

  if (isLoading) return <DetailSkeleton />;
  if (!art) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">{t('common.noResults')}</p>
        <Button variant="outline" onClick={() => router.push('/collection')}>
          <ArrowLeft className="size-4" /> {t('common.back')}
        </Button>
      </div>
    );
  }

  const title = resolveLocalized(art.title, locale);
  const description = resolveLocalized(art.description, locale);
  const imageCount = Math.max(art.imageCount, 1);
  // Synthesise gallery variations from the dominant palette.
  const galleryColors = Array.from({ length: imageCount }, (_, i) => {
    const rot = art.dominantColors.slice(i % art.dominantColors.length).concat(art.dominantColors);
    return rot.slice(0, 3);
  });

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6 lg:p-8">
      {/* Breadcrumb + actions */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/collection')} className="gap-1.5 -ml-2">
          <ArrowLeft className="size-4" /> {t('nav.collection')}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleFav.mutate({ id: art.id, value: !art.isFavorite })}
          >
            <Star className={cn('size-4', art.isFavorite && 'fill-amber-400 text-amber-400')} />
            {t('nav.favorites')}
          </Button>
          <Button variant="outline" size="icon-sm"><Share2 className="size-4" /></Button>
          <Button variant="outline" size="icon-sm"><QrCode className="size-4" /></Button>
          <Button size="sm" onClick={() => setEditOpen(true)}><Pencil className="size-4" /> {t('common.edit')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Left — imagery */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-3"
        >
          <div className="group relative">
            <ArtworkThumbnail
              colors={galleryColors[activeImage] ?? art.dominantColors}
              src={art.primaryImageUrl}
              className="aspect-[4/5] w-full shadow-elevated"
              rounded="xl"
              showIcon
            />
            <Button
              variant="secondary"
              size="icon-sm"
              className="absolute right-3 top-3 opacity-0 shadow-floating transition-opacity group-hover:opacity-100"
            >
              <Maximize2 className="size-4" />
            </Button>
          </div>
          {imageCount > 1 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
              {galleryColors.map((colors, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(i)}
                  className={cn(
                    'shrink-0 overflow-hidden rounded-lg ring-2 transition-all',
                    i === activeImage ? 'ring-primary' : 'ring-transparent hover:ring-border',
                  )}
                >
                  <ArtworkThumbnail colors={colors} className="size-16" rounded="md" showIcon={false} />
                </button>
              ))}
            </div>
          )}
        </motion.div>

        {/* Right — info */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={art.status} />
            <ConditionBadge condition={art.condition} />
            <Badge tone="outline" className="font-mono">{art.inventoryNumber}</Badge>
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight text-balance">
            {title}
          </h1>
          <p className="mt-1.5 text-lg text-muted-foreground">
            {art.artistName ?? art.attribution ?? '—'}
            {art.dateText && <span className="text-muted-foreground/70">, {art.dateText}</span>}
          </p>

          {art.valuation && (
            <Card className="mt-5 border-primary/20 bg-primary/[0.03]">
              <CardContent className="flex items-center gap-6 p-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="size-5" />
                </div>
                <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('artwork.fields.value')}</p>
                    <p className="font-display text-lg font-semibold tabular-nums">
                      {formatCurrency(art.valuation.currentValue, art.valuation.currency, locale)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('artwork.fields.insuranceValue')}</p>
                    <p className="font-display text-lg font-semibold tabular-nums">
                      {formatCurrency(art.valuation.insuranceValue, art.valuation.currency, locale)}
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-xs text-muted-foreground">{t('artwork.fields.purchasePrice')}</p>
                    <p className="font-display text-lg font-semibold tabular-nums">
                      {formatCurrency(art.valuation.purchasePrice, art.valuation.currency, locale)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="overview" className="mt-6">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-x-1 gap-y-1 border-b-0 pb-1">
              <TabsTrigger value="overview" className="px-2.5"><ScrollText />{t('artwork.tabs.overview')}</TabsTrigger>
              <TabsTrigger value="media" className="px-2.5"><Images />{t('artwork.tabs.media')}</TabsTrigger>
              <TabsTrigger value="documents" className="px-2.5"><FileText />{t('artwork.tabs.documents')}</TabsTrigger>
              <TabsTrigger value="loans" className="px-2.5"><Truck />{t('artwork.tabs.loans')}</TabsTrigger>
              <TabsTrigger value="exhibitions" className="px-2.5"><Frame />{t('artwork.tabs.exhibitions')}</TabsTrigger>
              <TabsTrigger value="location" className="px-2.5"><MapPin />{t('artwork.tabs.location')}</TabsTrigger>
              <TabsTrigger value="conservation" className="px-2.5"><Wrench />{t('artwork.tabs.conservation')}</TabsTrigger>
              <TabsTrigger value="history" className="px-2.5"><History />{t('artwork.tabs.history')}</TabsTrigger>
            </TabsList>
            <Separator className="-mt-px" />

            <TabsContent value="overview">
              {description && (
                <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{description}</p>
              )}
              <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <Field label={t('artwork.fields.artist')}>{art.artistName}</Field>
                <Field label={t('artwork.fields.authentication')}>
                  <span className="capitalize">{art.authentication.replace(/_/g, ' ')}</span>
                </Field>
                <Field label={t('artwork.fields.date')}>{art.dateText}</Field>
                <Field label={t('artwork.fields.technique')}>{art.techniqueName}</Field>
                <Field label={t('artwork.fields.support')}>{art.supportName}</Field>
                <Field label={t('artwork.fields.dimensions')}>
                  {formatDimensions(art.heightCm, art.widthCm, art.depthCm)}
                </Field>
                <Field label={t('artwork.fields.signature')}>{art.signatureDescription}</Field>
                <Field label={t('artwork.fields.collection')}>
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: art.collectionColor ?? undefined }} />
                    {art.collectionName}
                  </span>
                </Field>
                <Field label={t('artwork.fields.location')}>{art.currentLocationName}</Field>
                <Field label={t('artwork.fields.acquisition')}>
                  <span className="capitalize">{art.acquisitionMethod}</span>
                  {art.acquisitionDate && ` · ${formatDate(art.acquisitionDate, locale)}`}
                </Field>
                <Field label={t('artwork.detail.addedOn', { date: formatDate(art.createdAt, locale) })}>
                  {formatDate(art.updatedAt, locale)}
                </Field>
              </dl>
              {art.tags.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <div className="flex flex-wrap gap-1.5">
                    {art.tags.map((tag) => (
                      <Badge key={tag} tone="neutral">#{tag}</Badge>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="media">
              <MediaTab artworkId={art.id} media={art.media} title={title} artistName={art.artistName} />
            </TabsContent>

            <TabsContent value="documents">
              <ArtworkDocumentsTab artworkId={art.id} artworkTitle={title} />
            </TabsContent>

            <TabsContent value="loans">
              <ArtworkLoansTab artworkId={art.id} />
            </TabsContent>

            <TabsContent value="exhibitions">
              <ArtworkExhibitionsTab artworkId={art.id} />
            </TabsContent>

            <TabsContent value="location">
              <ArtworkLocationTab artworkId={art.id} currentLocationId={art.currentLocationId} currentLocationName={art.currentLocationName} />
            </TabsContent>

            <TabsContent value="conservation">
              <ArtworkConservationTab artworkId={art.id} />
            </TabsContent>

            <TabsContent value="history">
              <PlaceholderTab label={t('artwork.tabs.history')} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ArtworkFormModal open={editOpen} onClose={() => setEditOpen(false)} artwork={art} />
    </div>
  );
}

interface ArtworkDocumentRow {
  id: string;
  title: string;
  type: 'invoice' | 'certificate' | 'report' | 'insurance';
  uploadedAt: string;
}

function ArtworkDocumentsTab({ artworkId, artworkTitle }: { artworkId: string; artworkTitle: string }) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['artwork-documents', artworkId],
    queryFn: () => apiFetch<{ data: ArtworkDocumentRow[] }>(`/documents?artworkId=${artworkId}`),
  });

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce document ?')) return;
    try {
      await apiFetch(`/documents/${id}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['artwork-documents', artworkId] });
      toast.success('Document supprimé');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la suppression');
    }
  };

  const docs = data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="size-3.5" /> Joindre un document
        </Button>
      </div>
      <CreateDocumentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ['artwork-documents', artworkId] })}
        defaultArtworkId={artworkId}
        defaultArtworkTitle={artworkTitle}
      />
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : docs.length === 0 ? (
        <PlaceholderEmpty icon={FileText} label="Aucun document lié à cette œuvre" />
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(doc.uploadedAt)}</p>
              </div>
              <Badge tone="neutral" className="shrink-0">{doc.type}</Badge>
              <button
                onClick={() => handleDelete(doc.id)}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ArtworkLoanRow {
  id: string;
  direction: 'in' | 'out';
  counterparty: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'active' | 'returned' | 'overdue';
}

const LOAN_STATUS_TONE = { pending: 'info', active: 'success', returned: 'neutral', overdue: 'danger' } as const;

function ArtworkLoansTab({ artworkId }: { artworkId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['artwork-loans', artworkId],
    queryFn: () => apiFetch<{ data: ArtworkLoanRow[] }>(`/loans?artworkId=${artworkId}`),
  });
  const loans = data?.data ?? [];

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (loans.length === 0) return <PlaceholderEmpty icon={Truck} label="Cette œuvre n'a jamais été prêtée" />;

  return (
    <div className="space-y-2">
      {loans.map((loan) => (
        <div key={loan.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', loan.direction === 'out' ? 'bg-blue-500/12 text-blue-600 dark:text-blue-400' : 'bg-violet-500/12 text-violet-600 dark:text-violet-400')}>
            {loan.direction === 'out' ? <ArrowUpFromLine className="size-4" /> : <ArrowDownToLine className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{loan.counterparty}</p>
            <p className="text-xs text-muted-foreground">{formatDate(loan.startDate)} – {formatDate(loan.endDate)}</p>
          </div>
          <Badge tone={LOAN_STATUS_TONE[loan.status]} dot className="shrink-0">{loan.status}</Badge>
        </div>
      ))}
    </div>
  );
}

interface ArtworkExhibitionRow {
  id: string;
  title: string;
  venue: string;
  startDate: string;
  endDate: string;
  color: string;
}

function ArtworkExhibitionsTab({ artworkId }: { artworkId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['artwork-exhibitions', artworkId],
    queryFn: () => apiFetch<{ data: ArtworkExhibitionRow[] }>(`/exhibitions?artworkId=${artworkId}`),
  });
  const exhibitions = data?.data ?? [];

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (exhibitions.length === 0) return <PlaceholderEmpty icon={Frame} label="Cette œuvre n'a participé à aucune exposition" />;

  return (
    <div className="space-y-2">
      {exhibitions.map((ex) => (
        <div key={ex.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: ex.color }} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{ex.title}</p>
            <p className="truncate text-xs text-muted-foreground">{ex.venue}</p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{formatDate(ex.startDate)} – {formatDate(ex.endDate)}</span>
        </div>
      ))}
    </div>
  );
}

interface LocationOption {
  id: string;
  room: string;
  building: string;
}

function ArtworkLocationTab({
  artworkId,
  currentLocationId,
  currentLocationName,
}: {
  artworkId: string;
  currentLocationId?: string | null;
  currentLocationName?: string | null;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = React.useState<string>(currentLocationId ?? '');
  const { data } = useQuery({
    queryKey: ['locations-all'],
    queryFn: () => apiFetch<{ data: LocationOption[] }>('/locations'),
  });
  const locations = data?.data ?? [];

  const moveMutation = useMutation({
    mutationFn: (locationId: string) =>
      apiFetch(`/artworks/${artworkId}/location`, { method: 'PATCH', body: JSON.stringify({ locationId: locationId || null }) }),
    onSuccess: () => {
      toast.success('Œuvre déplacée');
      qc.invalidateQueries({ queryKey: ['artwork', artworkId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Échec du déplacement'),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Emplacement actuel</p>
        <p className="mt-1 flex items-center gap-2 text-sm font-medium text-foreground">
          <MapPin className="size-4 text-primary" /> {currentLocationName || 'Non renseigné'}
        </p>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground">Déplacer vers</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— Aucun —</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.building ? `${loc.building} · ${loc.room}` : loc.room}</option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          onClick={() => moveMutation.mutate(selected)}
          disabled={moveMutation.isPending || selected === (currentLocationId ?? '')}
        >
          {moveMutation.isPending ? 'Déplacement…' : 'Déplacer'}
        </Button>
      </div>
    </div>
  );
}

interface RestorationRow {
  id: string;
  status: 'proposed' | 'in_progress' | 'completed';
  title: string;
  diagnosis: string;
  treatment: string;
  conservator: string | null;
  cost: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
}

const RESTORATION_STATUS_TONE = { proposed: 'info', in_progress: 'warning', completed: 'success' } as const;
const RESTORATION_STATUS_LABEL = { proposed: 'Proposée', in_progress: 'En cours', completed: 'Terminée' } as const;

function ArtworkConservationTab({ artworkId }: { artworkId: string }) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [diagnosis, setDiagnosis] = React.useState('');
  const [treatment, setTreatment] = React.useState('');
  const [conservator, setConservator] = React.useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['artwork-restorations', artworkId],
    queryFn: () => apiFetch<{ data: RestorationRow[] }>(`/restorations?artworkId=${artworkId}`),
  });
  const restorations = data?.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['artwork-restorations', artworkId] });
    qc.invalidateQueries({ queryKey: ['artwork', artworkId] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch('/restorations', {
        method: 'POST',
        body: JSON.stringify({ artworkId, title, diagnosis: diagnosis || undefined, treatment: treatment || undefined, conservator: conservator || undefined }),
      }),
    onSuccess: () => {
      toast.success('Restauration proposée');
      setTitle(''); setDiagnosis(''); setTreatment(''); setConservator('');
      setFormOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Échec de la création'),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/restorations/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }),
    onSuccess: () => { toast.success('Restauration marquée comme terminée'); invalidate(); },
    onError: () => toast.error('Échec de la mise à jour'),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" onClick={() => setFormOpen((v) => !v)} className="gap-1.5">
          <Plus className="size-3.5" /> Proposer une restauration
        </Button>
      </div>

      {formOpen && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre de l'intervention"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <textarea
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="Diagnostic"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            rows={2}
          />
          <textarea
            value={treatment}
            onChange={(e) => setTreatment(e.target.value)}
            placeholder="Traitement envisagé"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            rows={2}
          />
          <input
            value={conservator}
            onChange={(e) => setConservator(e.target.value)}
            placeholder="Restaurateur·rice"
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button size="sm" onClick={() => createMutation.mutate()} disabled={!title.trim() || createMutation.isPending}>
            {createMutation.isPending ? 'Création…' : 'Créer'}
          </Button>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : restorations.length === 0 ? (
        <PlaceholderEmpty icon={Wrench} label="Aucune restauration enregistrée pour cette œuvre" />
      ) : (
        <div className="space-y-2">
          {restorations.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{r.title}</p>
                <Badge tone={RESTORATION_STATUS_TONE[r.status]} dot>{RESTORATION_STATUS_LABEL[r.status]}</Badge>
              </div>
              {r.diagnosis && <p className="mt-1 text-xs text-muted-foreground">Diagnostic : {r.diagnosis}</p>}
              {r.treatment && <p className="mt-1 text-xs text-muted-foreground">Traitement : {r.treatment}</p>}
              {r.conservator && <p className="mt-1 text-xs text-muted-foreground">Par {r.conservator}</p>}
              {r.status !== 'completed' && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => completeMutation.mutate(r.id)} disabled={completeMutation.isPending}>
                  Marquer comme terminée
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderEmpty({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-dotted text-center">
      <Icon className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function MediaTab({
  artworkId,
  media,
  title,
  artistName,
}: {
  artworkId: string;
  media: { id: string; url: string }[];
  title: string;
  artistName?: string | null;
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['artwork', artworkId] });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => artworkRepository.uploadMedia(artworkId, file),
    onSuccess: () => {
      toast.success(t('artwork.media.uploaded'));
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('artwork.media.uploadFailed')),
  });

  const attachFromUrlMutation = useMutation({
    mutationFn: (url: string) => artworkRepository.attachMediaFromUrl(artworkId, url),
    onSuccess: () => {
      toast.success('Image ajoutée à la galerie');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Échec de l'ajout de l'image"),
  });

  const removeMutation = useMutation({
    mutationFn: (mediaId: string) => artworkRepository.removeMedia(artworkId, mediaId),
    onSuccess: () => invalidate(),
    onError: () => toast.error(t('artwork.media.removeFailed')),
  });

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    Array.from(files).forEach((file) => uploadMutation.mutate(file));
  };

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-dotted hover:border-primary/50',
        )}
      >
        <Images className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{t('artwork.media.dropHint')}</p>
        <p className="text-xs text-muted-foreground">{t('artwork.media.formats')}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      <ImageSearchButtons
        onSearchWiki={() => aiApi.findArtworkImagesWiki({ title, artistName: artistName ?? undefined })}
        onSearchAi={() => aiApi.findArtworkImagesAi({ title, artistName: artistName ?? undefined })}
        onPick={(url) => attachFromUrlMutation.mutate(url)}
        disabled={attachFromUrlMutation.isPending}
      />

      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {media.map((m) => (
            <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt="" className="h-full w-full object-cover" />
              <button
                onClick={() => removeMutation.mutate(m.id)}
                disabled={removeMutation.isPending}
                className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={t('common.delete')}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-dotted text-center">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">Module available in the next phase.</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6 lg:p-8">
      <Skeleton className="mb-5 h-8 w-40" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Skeleton className="aspect-[4/5] w-full rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-9 w-full" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
