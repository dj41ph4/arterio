'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Loader2, Merge } from 'lucide-react';
import type { Locale } from '@arterio/shared';
import { resolveLocalized } from '@arterio/shared';
import { duplicatesApi, type VisualDuplicateGroup } from '@/lib/data/duplicates';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArtworkThumbnail } from '@/components/artwork/thumbnail';
import { cn } from '@/lib/utils';

function DuplicateGroup({
  group,
  onMerged,
  onIgnore,
}: {
  group: VisualDuplicateGroup;
  onMerged: () => void;
  onIgnore: () => void;
}) {
  const t = useTranslations('duplicates');
  const locale = useLocale() as Locale;
  const [canonicalId, setCanonicalId] = React.useState(group.artworks[0]!.id);

  const mergeMutation = useMutation({
    mutationFn: () =>
      duplicatesApi.merge(
        canonicalId,
        group.artworks.filter((a) => a.id !== canonicalId).map((a) => a.id),
      ),
    onSuccess: () => {
      toast.success(t('mergedToast'));
      onMerged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('mergeFailed')),
  });

  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <Badge tone="primary" className="text-[11px]">
          {t('similarity', { pct: group.similarity })}
        </Badge>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onIgnore}>
            {t('ignore')}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => mergeMutation.mutate()} disabled={mergeMutation.isPending}>
            {mergeMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Merge className="size-3.5" />}
            {t('merge')}
          </Button>
        </div>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{t('keepHint')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {group.artworks.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setCanonicalId(a.id)}
            className={cn(
              'overflow-hidden rounded-lg border-2 text-left transition-colors',
              canonicalId === a.id ? 'border-primary' : 'border-transparent hover:border-border',
            )}
          >
            <div className="aspect-square">
              <ArtworkThumbnail colors={a.dominantColors} src={a.thumbnailUrl} />
            </div>
            <div className={cn('p-2', canonicalId === a.id ? 'bg-primary/5' : 'bg-card')}>
              <p className="truncate text-xs font-medium">{resolveLocalized(a.title, locale) || a.inventoryNumber}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {a.inventoryNumber}
                {canonicalId === a.id ? ` — ${t('keep')}` : ''}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function VisualDuplicatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('duplicates');
  const qc = useQueryClient();
  const [ignored, setIgnored] = React.useState<Set<number>>(new Set());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['visual-duplicates'],
    queryFn: duplicatesApi.findVisual,
    enabled: open,
    staleTime: 0,
  });

  React.useEffect(() => {
    if (open) setIgnored(new Set());
  }, [open]);

  const groups = (data?.groups ?? []).filter((_, i) => !ignored.has(i));

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={t('visualTitle')}
      description={data ? t('visualSubtitle', { images: data.comparedImages }) : undefined}
      contentClassName="max-w-2xl"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t('analyzing')}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Copy className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group, i) => (
            <DuplicateGroup
              key={group.artworks.map((a) => a.id).join('-')}
              group={group}
              onMerged={() => {
                qc.invalidateQueries({ queryKey: ['artworks'] });
                void refetch();
              }}
              onIgnore={() => setIgnored((s) => new Set([...s, i]))}
            />
          ))}
        </div>
      )}
    </ResponsiveDialog>
  );
}
