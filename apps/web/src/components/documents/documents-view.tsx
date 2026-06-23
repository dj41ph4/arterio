'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileText, Search, Receipt, ShieldCheck, ScrollText, Download, Lock, Plus, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { apiFetch } from '@/lib/api/client';
import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { CreateDocumentModal } from './create-document-modal';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

interface DocumentView {
  id: string;
  title: string;
  type: 'invoice' | 'certificate' | 'report' | 'insurance';
  artworkId?: string | null;
  linkedTo: string;
  uploadedAt: string;
  sizeKb: number;
}

const DEMO_DOCUMENTS: DocumentView[] = [
  { id: 'd1', title: 'Facture d\'acquisition — Vermeer', type: 'invoice', linkedTo: 'Landscape near Spring', uploadedAt: '2024-03-12', sizeKb: 312 },
  { id: 'd2', title: 'Certificat d\'authenticité', type: 'certificate', linkedTo: 'Composition Argenteuil', uploadedAt: '2024-05-02', sizeKb: 880 },
  { id: 'd3', title: 'Rapport de condition annuel', type: 'report', linkedTo: 'Allegory of Twilight', uploadedAt: '2026-01-20', sizeKb: 1540 },
  { id: 'd4', title: 'Police d\'assurance 2026', type: 'insurance', linkedTo: 'Collection complète', uploadedAt: '2026-01-01', sizeKb: 2200 },
  { id: 'd5', title: 'Expertise notariée', type: 'certificate', linkedTo: 'Self-Portrait No. VII', uploadedAt: '2025-11-18', sizeKb: 640 },
  { id: 'd6', title: 'Facture restauration', type: 'invoice', linkedTo: 'View of Saint Jerome', uploadedAt: '2026-02-09', sizeKb: 145 },
  { id: 'd7', title: 'Rapport de transport', type: 'report', linkedTo: 'Portrait of a Young Woman', uploadedAt: '2026-06-15', sizeKb: 410 },
  { id: 'd8', title: 'Avenant assurance prêt', type: 'insurance', linkedTo: 'Allegory of Twilight', uploadedAt: '2026-06-18', sizeKb: 290 },
];

const TYPE_ICON = { invoice: Receipt, certificate: ScrollText, report: FileText, insurance: ShieldCheck };
const TYPE_TONE = { invoice: 'neutral', certificate: 'violet', report: 'info', insurance: 'success' } as const;

export function DocumentsView() {
  const t = useTranslations();
  const [search, setSearch] = useState('');
  const [documents, setDocuments] = useState<DocumentView[]>(USE_API ? [] : DEMO_DOCUMENTS);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = () => {
    if (!USE_API) return;
    apiFetch<{ data: DocumentView[] }>('/documents')
      .then((res) => setDocuments(res.data))
      .catch(() => setDocuments([]));
  };

  useEffect(refresh, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce document ?')) return;
    try {
      await apiFetch(`/documents/${id}`, { method: 'DELETE' });
      toast.success('Document supprimé');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la suppression');
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return documents
      .filter((d) => d.title.toLowerCase().includes(q) || d.linkedTo.toLowerCase().includes(q))
      .sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));
  }, [search, documents]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 pb-3 md:px-6">
        <PageHeader
          title={t('nav.documents')}
          subtitle={t('documents.subtitle', { count: filtered.length })}
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nouveau document
            </Button>
          }
        />
      </div>

      {USE_API && <CreateDocumentModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={refresh} />}

      <div className="border-b border-border bg-background px-6 py-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('documents.searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-4 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <FileText className="h-10 w-10 opacity-40" />
            <p className="text-sm">{t('common.noResults')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {filtered.map((doc) => {
              const Icon = TYPE_ICON[doc.type];
              return (
                <div key={doc.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                    {doc.artworkId ? (
                      <Link
                        href={`/artworks/${doc.artworkId}`}
                        className="truncate text-xs text-primary hover:underline"
                      >
                        {doc.linkedTo}
                      </Link>
                    ) : (
                      <p className="truncate text-xs text-muted-foreground">{doc.linkedTo}</p>
                    )}
                  </div>
                  <Badge tone={TYPE_TONE[doc.type]} className="hidden shrink-0 sm:flex">
                    {t(`documents.type.${doc.type}`)}
                  </Badge>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {formatDate(doc.uploadedAt)}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
                    {(doc.sizeKb / 1024).toFixed(1)} MB
                  </span>
                  <button
                    onClick={() => toast.info(t('documents.encryptedNotice'))}
                    className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={t('documents.encryptedNotice')}
                  >
                    <Lock className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => toast.success(t('documents.downloadStarted', { title: doc.title }))}
                    className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  {USE_API && (
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
