'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useLocale } from 'next-intl';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import { resolveLocalized, type Locale } from '@arterio/shared';
import { trashApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function TrashPanel() {
  const locale = useLocale() as Locale;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['artwork-trash'], queryFn: trashApi.list });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => trashApi.restore(id),
    onSuccess: () => {
      toast.success('Œuvre restaurée');
      qc.invalidateQueries({ queryKey: ['artwork-trash'] });
    },
    onError: () => toast.error('Échec de la restauration'),
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => trashApi.purge(id),
    onSuccess: () => {
      toast.success('Œuvre supprimée définitivement');
      qc.invalidateQueries({ queryKey: ['artwork-trash'] });
    },
    onError: () => toast.error('Échec de la suppression'),
  });

  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Corbeille</CardTitle>
        <CardDescription>
          Les œuvres supprimées restent ici jusqu'à restauration ou suppression définitive — rien n'est jamais perdu par accident.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">La corbeille est vide.</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{resolveLocalized(a.title, locale) || a.inventoryNumber}</p>
                  <p className="text-xs text-muted-foreground">{a.inventoryNumber}</p>
                </div>
                <button
                  onClick={() => restoreMutation.mutate(a.id)}
                  disabled={restoreMutation.isPending}
                  title="Restaurer"
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restaurer
                </button>
                <button
                  onClick={() => {
                    if (confirm('Supprimer définitivement cette œuvre ? Cette action est irréversible.')) {
                      purgeMutation.mutate(a.id);
                    }
                  }}
                  disabled={purgeMutation.isPending}
                  title="Supprimer définitivement"
                  className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </button>
              </div>
            ))}
          </div>
        )}
        {items.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="h-3 w-3" /> La suppression définitive ne peut pas être annulée.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
