'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, X, Sparkles, Check } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MAX_MODELS = 3;

export function AiModelsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['ai-settings'], queryFn: settingsApi.getAiSettings });
  const { data: freeModels } = useQuery({
    queryKey: ['openrouter-free-models'],
    queryFn: settingsApi.listOpenRouterFreeModels,
    staleTime: 5 * 60 * 1000,
  });

  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [apiKey, setApiKey] = React.useState<string | undefined>(undefined);
  const [models, setModels] = React.useState<string[] | null>(null);

  const effectiveEnabled = enabled ?? data?.enabled ?? false;
  const effectiveModels = models ?? data?.models ?? [];
  const hasChanges = enabled !== null || apiKey !== undefined || models !== null;

  const mutation = useMutation({
    mutationFn: () => settingsApi.updateAiSettings({ enabled: enabled ?? undefined, apiKey, models: models ?? undefined }),
    onSuccess: () => {
      toast.success('Réglages IA enregistrés');
      setEnabled(null);
      setApiKey(undefined);
      setModels(null);
      qc.invalidateQueries({ queryKey: ['ai-settings'] });
    },
    onError: () => toast.error("Échec de l'enregistrement"),
  });

  if (isLoading || !data) return null;

  const addModel = (id: string) => {
    if (effectiveModels.includes(id) || effectiveModels.length >= MAX_MODELS) return;
    setModels([...effectiveModels, id]);
  };
  const removeModel = (id: string) => setModels(effectiveModels.filter((m) => m !== id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Intelligence artificielle (OpenRouter)
        </CardTitle>
        <CardDescription>
          Activez l'enrichissement IA et choisissez jusqu'à {MAX_MODELS} modèles gratuits, par ordre de priorité —
          si le premier ne répond pas, l'application bascule automatiquement sur le suivant. Désactivé (ou aucun
          modèle accessible), le mode normal (Wikidata + musées en ligne) reste utilisé tel quel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
          <span className="text-sm font-medium text-foreground">Activer l'IA pour cette organisation</span>
          <input
            type="checkbox"
            checked={effectiveEnabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
        </label>

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
            Clé API OpenRouter
            {data.hasApiKey && (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                <Check className="h-3 w-3" /> Configurée
              </span>
            )}
          </label>
          <input
            type="password"
            value={apiKey ?? ''}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={data.hasApiKey ? '••••••••••••••••' : 'Coller la clé API OpenRouter ici'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Gratuite sur{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-primary hover:underline">
              openrouter.ai/keys
            </a>
            . Les modèles marqués « free » ci-dessous n'ont aucun coût.
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Modèles, par ordre de priorité</p>
          {effectiveModels.length === 0 && (
            <p className="mb-2 text-sm text-muted-foreground">Aucun modèle choisi — le modèle par défaut du serveur sera utilisé.</p>
          )}
          <ol className="space-y-2">
            {effectiveModels.map((id, i) => (
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

          {effectiveModels.length < MAX_MODELS && (
            <select
              value=""
              onChange={(e) => addModel(e.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="" disabled>
                Ajouter un modèle gratuit…
              </option>
              {(freeModels ?? [])
                .filter((m) => !effectiveModels.includes(m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
            </select>
          )}
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !hasChanges}
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
