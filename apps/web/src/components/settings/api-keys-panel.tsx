'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Copy, Trash2, KeyRound } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function ApiKeysPanel() {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [revealedSecret, setRevealedSecret] = React.useState<string | null>(null);
  const { data: keys, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: settingsApi.listApiKeys });

  const createMutation = useMutation({
    mutationFn: () => settingsApi.createApiKey({ name }),
    onSuccess: (created) => {
      setRevealedSecret(created.secret);
      setName('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: () => toast.error('Échec de la création'),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => settingsApi.revokeApiKey(id),
    onSuccess: () => { toast.success('Clé révoquée'); qc.invalidateQueries({ queryKey: ['api-keys'] }); },
    onError: () => toast.error('Échec de la révocation'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clés API</CardTitle>
        <CardDescription>Pour intégrer Arterio à des outils externes. Le secret n'est affiché qu'une fois.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {revealedSecret && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="mb-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
              Copiez cette clé maintenant — elle ne sera plus jamais affichée
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-background px-2 py-1.5 text-xs">{revealedSecret}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(revealedSecret); toast.success('Copié'); }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-muted"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); if (name) createMutation.mutate(); }}
          className="flex items-end gap-2"
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nom de la clé</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Intégration site web"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending || !name}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Créer
          </button>
        </form>

        {!isLoading && (
          <div className="divide-y divide-border rounded-xl border border-border">
            {keys?.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Aucune clé API créée.</p>
            )}
            {keys?.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-4 py-3">
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{k.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{k.prefix}…</p>
                </div>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  k.revokedAt ? 'bg-muted text-muted-foreground' : 'bg-green-500/10 text-green-600 dark:text-green-400',
                )}>
                  {k.revokedAt ? 'Révoquée' : 'Active'}
                </span>
                {!k.revokedAt && (
                  <button
                    onClick={() => revokeMutation.mutate(k.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
