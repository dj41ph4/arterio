'use client';

import * as React from 'react';
import { Plus, Truck, FileText, UserPlus } from 'lucide-react';
import { ArtworkFormModal } from '@/components/artwork/artwork-form-modal';
import { CreateLoanModal } from '@/components/loans/create-loan-modal';
import { CreateDocumentModal } from '@/components/documents/create-document-modal';
import { AddArtistModal } from '@/components/artists/add-artist-modal';
import { useRouter } from '@/i18n/navigation';

const ACTIONS = [
  { key: 'artwork', icon: Plus, label: 'Nouvelle œuvre' },
  { key: 'loan', icon: Truck, label: 'Prêter une œuvre' },
  { key: 'document', icon: FileText, label: 'Nouveau document' },
  { key: 'artist', icon: UserPlus, label: 'Nouvel artiste' },
] as const;

type ActionKey = (typeof ACTIONS)[number]['key'];

export function QuickActions() {
  const router = useRouter();
  const [open, setOpen] = React.useState<ActionKey | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => setOpen(a.key)}
            className="group flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-subtle transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated"
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
              <a.icon className="size-3.5" />
            </span>
            {a.label}
          </button>
        ))}
      </div>

      <ArtworkFormModal open={open === 'artwork'} onClose={() => setOpen(null)} />
      <CreateLoanModal open={open === 'loan'} onClose={() => setOpen(null)} onCreated={() => setOpen(null)} />
      <CreateDocumentModal open={open === 'document'} onClose={() => setOpen(null)} onCreated={() => setOpen(null)} />
      <AddArtistModal
        open={open === 'artist'}
        onClose={() => setOpen(null)}
        onAdded={(artist) => {
          setOpen(null);
          router.push(`/artists/${artist.id}`);
        }}
      />
    </>
  );
}
