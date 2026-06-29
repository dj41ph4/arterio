'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, X, Sparkles, Check, Search, Image as ImageIcon, ArrowRightLeft } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MAX_MODELS = 3;

/** OpenRouter marks free models with a 🆓 emoji or a "(free)" suffix in the name, and/or a ":free" id suffix. */
function isFreeModel(m: { id: string; name: string }): boolean {
  return m.name.includes('🆓') || /\(free\)/i.test(m.name) || m.id.endsWith(':free');
}

export function AiModelsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['ai-settings'], queryFn: settingsApi.getAiSettings });
  const { data: allModels } = useQuery({
    queryKey: ['openrouter-models'],
    queryFn: settingsApi.listOpenRouterModels,
    staleTime: 5 * 60 * 1000,
  });

  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [apiKey, setApiKey] = React.useState<string | undefined>(undefined);
  const [wikiartApiKey, setWikiartApiKey] = React.useState<string | undefined>(undefined);
  const [artsyApiKey, setArtsyApiKey] = React.useState<string | undefined>(undefined);
  const [geminiApiKey, setGeminiApiKey] = React.useState<string | undefined>(undefined);
  const [providerOrder, setProviderOrder] = React.useState<('openrouter' | 'gemini')[] | null>(null);
  const [multiModelMode, setMultiModelMode] = React.useState<'parallel' | 'fallback' | null>(null);
  const [models, setModels] = React.useState<string[] | null>(null);
  const [search, setSearch] = React.useState('');
  const [freeOnly, setFreeOnly] = React.useState(true);

  const effectiveEnabled = enabled ?? data?.enabled ?? false;
  const effectiveModels = models ?? data?.models ?? [];
  const effectiveOrder = providerOrder ?? data?.providerOrder ?? ['openrouter', 'gemini'];
  const effectiveMultiModelMode = multiModelMode ?? data?.multiModelMode ?? 'parallel';
  const hasChanges =
    enabled !== null ||
    apiKey !== undefined ||
    wikiartApiKey !== undefined ||
    artsyApiKey !== undefined ||
    geminiApiKey !== undefined ||
    providerOrder !== null ||
    multiModelMode !== null ||
    models !== null;

  const mutation = useMutation({
    mutationFn: () =>
      settingsApi.updateAiSettings({
        enabled: enabled ?? undefined,
        apiKey,
        wikiartApiKey,
        artsyApiKey,
        geminiApiKey,
        providerOrder: providerOrder ?? undefined,
        multiModelMode: multiModelMode ?? undefined,
        models: models ?? undefined,
      }),
    onSuccess: () => {
      toast.success('Réglages IA enregistrés');
      setEnabled(null);
      setApiKey(undefined);
      setWikiartApiKey(undefined);
      setArtsyApiKey(undefined);
      setGeminiApiKey(undefined);
      setProviderOrder(null);
      setMultiModelMode(null);
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

  const filteredModels = (allModels ?? [])
    .filter((m) => !effectiveModels.includes(m.id))
    .filter((m) => !freeOnly || isFreeModel(m))
    .filter((m) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    })
    .slice(0, 50);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Intelligence artificielle (OpenRouter + Gemini)
        </CardTitle>
        <CardDescription>
          Activez l'enrichissement IA et choisissez jusqu'à {MAX_MODELS} modèles. Les modèles configurés sont
          interrogés simultanément sur la même recherche, et leurs réponses sont fusionnées — le champ le plus
          complet de chacun est conservé, sans répétition. Désactivé (ou aucun modèle accessible), le mode normal
          (Wikidata + musées en ligne) reste utilisé tel quel.
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
            .
          </p>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ArrowRightLeft className="h-3.5 w-3.5 text-primary" /> Mode d'appel des modèles
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMultiModelMode('parallel')}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors',
                effectiveMultiModelMode === 'parallel' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted',
              )}
            >
              Parallèle — fusionne les réponses (le plus complet, coûte un appel par modèle)
            </button>
            <button
              type="button"
              onClick={() => setMultiModelMode('fallback')}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors',
                effectiveMultiModelMode === 'fallback' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted',
              )}
            >
              Économique — un modèle à la fois, bascule seulement si rien d'exploitable
            </button>
          </div>
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
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher un modèle…"
                    className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={freeOnly}
                    onChange={(e) => setFreeOnly(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Gratuits 🆓 seulement
                </label>
              </div>
              <select
                value=""
                onChange={(e) => addModel(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>
                  {filteredModels.length} modèle{filteredModels.length > 1 ? 's' : ''} — choisir…
                </option>
                {filteredModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
            <ImageIcon className="h-3.5 w-3.5 text-primary" /> Clé API WikiArt (optionnel)
            {data.hasWikiArtKey && (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                <Check className="h-3 w-3" /> Configurée
              </span>
            )}
          </label>
          <input
            type="password"
            value={wikiartApiKey ?? ''}
            onChange={(e) => setWikiartApiKey(e.target.value)}
            placeholder={data.hasWikiArtKey ? '••••••••••••••••' : 'accessCode:secretCode'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Si renseignée, WikiArt est utilisé en priorité pour trouver une vraie photo d'œuvre/portrait
            d'artiste (sinon : Wikimedia Commons). Clé gratuite à demander sur{' '}
            <a
              href="https://www.wikiart.org/fr/App/GetApi/GetKeys"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              wikiart.org/fr/App/GetApi/GetKeys
            </a>{' '}
            — collez le code d'accès et le code secret séparés par <code>:</code> (ex.{' '}
            <code>abc123:xyz789</code>).
          </p>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
            <ImageIcon className="h-3.5 w-3.5 text-primary" /> Clé API Artsy (optionnel)
            {data.hasArtsyKey && (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                <Check className="h-3 w-3" /> Configurée
              </span>
            )}
          </label>
          <input
            type="password"
            value={artsyApiKey ?? ''}
            onChange={(e) => setArtsyApiKey(e.target.value)}
            placeholder={data.hasArtsyKey ? '••••••••••••••••' : 'clientId:clientSecret'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Recherchée entre Wikimedia Commons et la recherche IA (donc après WikiArt/Commons, avant l'IA) pour
            trouver une vraie photo d'œuvre/portrait d'artiste sur l'index curaté d'Artsy. Clé gratuite à demander
            sur{' '}
            <a
              href="https://developers.artsy.net/v2"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              developers.artsy.net
            </a>{' '}
            (« Getting Started ») — collez l'ID client et la clé secrète séparés par <code>:</code> (ex.{' '}
            <code>abc123:xyz789</code>).
          </p>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
            Clé API Gemini (optionnel — secours gratuit)
            {data.hasGeminiKey && (
              <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                <Check className="h-3 w-3" /> Configurée
              </span>
            )}
          </label>
          <input
            type="password"
            value={geminiApiKey ?? ''}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            placeholder={data.hasGeminiKey ? '••••••••••••••••' : 'Coller la clé API Gemini ici'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Si OpenRouter ne renvoie rien d'utilisable (quota épuisé, erreur 402…), Gemini prend automatiquement le
            relais — recherche web native incluse, sans frais supplémentaire. Clé gratuite sur{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline">
              aistudio.google.com/apikey
            </a>
            .
          </p>
        </div>

        {(data.hasApiKey || apiKey) && (data.hasGeminiKey || geminiApiKey) && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ArrowRightLeft className="h-3.5 w-3.5 text-primary" /> Ordre de priorité
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setProviderOrder(['openrouter', 'gemini'])}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors',
                  effectiveOrder[0] === 'openrouter' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted',
                )}
              >
                OpenRouter en priorité, Gemini en secours
              </button>
              <button
                type="button"
                onClick={() => setProviderOrder(['gemini', 'openrouter'])}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors',
                  effectiveOrder[0] === 'gemini' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted',
                )}
              >
                Gemini en priorité, OpenRouter en secours
              </button>
            </div>
          </div>
        )}

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
