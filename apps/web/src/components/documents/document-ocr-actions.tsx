'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2, ScanText, Upload, Wand2 } from 'lucide-react';
import { apiFetch, API_BASE_URL } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Button } from '@/components/ui/button';

export interface DocumentRowView {
  id: string;
  title: string;
  type: string;
  artworkId: string | null;
  hasFile?: boolean;
  hasOcr?: boolean;
  extractedFields?: {
    price?: number;
    currency?: string;
    date?: string;
    seller?: string;
    invoiceNumber?: string;
  } | null;
}

/**
 * Per-document upload + OCR actions, and — when the AI extracted invoice
 * fields — the "Appliquer à l'œuvre" suggestion card. The price line is only
 * shown (and only applied) with the valuation write permission.
 */
export function DocumentOcrActions({ doc, onChanged }: { doc: DocumentRowView; onChanged: () => void }) {
  const t = useTranslations('documents.ocr');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const { data: me } = useCurrentUser();
  const canWriteValuation = (me?.permissions ?? []).includes('valuation:update');

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const { accessToken } = useAuthStore.getState();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE_URL}/documents/${doc.id}/file`, {
        method: 'POST',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t('uploaded'));
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('failed')),
  });

  const ocrMutation = useMutation({
    mutationFn: () => apiFetch(`/documents/${doc.id}/ocr`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(t('analyzed'));
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('failed')),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const f = doc.extractedFields!;
      const body: Record<string, unknown> = { hasInvoice: true };
      if (f.date) body.acquisitionDate = f.date;
      if (f.price && canWriteValuation) body.valuation = { purchasePrice: f.price, currency: f.currency };
      return apiFetch(`/artworks/${doc.artworkId}`, { method: 'PATCH', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(t('applied'));
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('failed')),
  });

  const f = doc.extractedFields;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) uploadMutation.mutate(file);
          }}
        />
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
          {uploadMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
          {doc.hasFile ? t('replaceFile') : t('uploadFile')}
        </Button>
        {doc.hasFile && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => ocrMutation.mutate()} disabled={ocrMutation.isPending}>
            {ocrMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <ScanText className="size-3" />}
            {ocrMutation.isPending ? t('analyzing') : doc.hasOcr ? t('reanalyze') : t('analyze')}
          </Button>
        )}
      </div>

      {f && doc.artworkId && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Wand2 className="size-3.5 text-primary" />
            {t('extracted')}
          </div>
          <dl className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {f.price != null && canWriteValuation && (
              <div>
                <dt className="inline font-medium">{t('price')} : </dt>
                <dd className="inline text-foreground">{f.price.toLocaleString()} {f.currency ?? ''}</dd>
              </div>
            )}
            {f.date && (
              <div>
                <dt className="inline font-medium">{t('date')} : </dt>
                <dd className="inline text-foreground">{f.date}</dd>
              </div>
            )}
            {f.seller && (
              <div className="col-span-2">
                <dt className="inline font-medium">{t('seller')} : </dt>
                <dd className="inline text-foreground">{f.seller}</dd>
              </div>
            )}
            {f.invoiceNumber && (
              <div className="col-span-2">
                <dt className="inline font-medium">{t('invoiceNumber')} : </dt>
                <dd className="inline text-foreground">{f.invoiceNumber}</dd>
              </div>
            )}
          </dl>
          <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
            {applyMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            {t('apply')}
          </Button>
        </div>
      )}
    </div>
  );
}
