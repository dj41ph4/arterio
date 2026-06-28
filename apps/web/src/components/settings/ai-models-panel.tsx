'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, X, Sparkles } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MAX_MODELS = 3;

export function AiModelsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['ai-models'], queryFn: settingsApi.getAiModels });
  const { data: freeModels } = useQuery({
    queryKey: ['openrouter-free-models'],
    queryFn: settingsApi.listOpenRouterFreeModels,
    staleTime: 5 * 60 * 1000,
  });
  const [selected, setSelected] = React.useState<string[] | null>(null);

  const models = selected ?? data?.models ?? [];

  const mutation = useMutation({
    mutationFn: (next: string[]) => settingsApi.updateAiModels(next),
    onSuccess: () => {
      toast.success('Modèles IA enregistrés');
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['ai-models'] });
    },
    onError: () => toast.error("Échec de l'enregistrement"),
  });

  if (isLoading) return null;

  const addModel = (id: string) => {
    if (models.includes(id) || models.length >= MAX_MODELS) return;
    setSelected([...models, id]);
  };
  const removeModel = (id: string) => setSelected(models.filter((m) => m !== id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Intelligence artificielle
        </CardTitle>
        <CardDescription>
          Choisissez jusqu'à {MAX_MODELS} modèles gratuits OpenRouter, par ordre de priorité. Si le premier
          ne répond pas, l'application bascule automatiquement sur le suivant. Nécessite
          <code className="mx-1 rounded bg-muted px-1">AI_ENABLED=true</code>,
          <code className="mx-1 rounded bg-muted px-1">AI_PROVIDER=openrouter</code> et
          <code className="mx-1 rounded bg-muted px-1">OPENROUTER_API_KEY</code> configurés sur le serveur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {models.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucun modèle choisi — le modèle par défaut du serveur (<code>OPENROUTER_MODEL</code>) sera utilisé.
          </p>
        )}
        <ol className="space-y-2">
          {models.map((id, i) => (
            <li key={id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="font-mono text-foreground">{id}</span>
              </span>
              <button onClick={() => removeModel(id)} className="text-muted-foreground hover:text-destructive">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>

        {models.length < MAX_MODELS && (
          <select
            value=""
            onChange={(e) => addModel(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="" disabled>
              Ajouter un modèle gratuit…
            </option>
            {(freeModels ?? [])
              .filter((m) => !models.includes(m.id))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id})
                </option>
              ))}
          </select>
        )}

        <button
          onClick={() => mutation.mutate(models)}
          disabled={mutation.isPending || selected === null}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50',
            'bg-primary',
          )}
        >
          <Save className="h-4 w-4" /> Enregistrer
        </button>
      </CardContent>
    </Card>
  );
}
