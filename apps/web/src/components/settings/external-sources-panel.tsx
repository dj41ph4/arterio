'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Check, ExternalLink } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const SOURCES = [
  { key: 'europeana', label: 'Europeana', hint: '50M+ objets — institutions européennes', signupUrl: 'https://pro.europeana.eu/get-api' },
  { key: 'rijksmuseum', label: 'Rijksmuseum', hint: 'Excellent pour les peintres européens', signupUrl: 'https://www.rijksmuseum.nl/en/rijksstudio/artists' },
  { key: 'harvard', label: 'Harvard Art Museums', hint: 'Métadonnées très riches', signupUrl: 'https://harvardartmuseums.org/collections/api' },
  { key: 'smithsonian', label: 'Smithsonian Open Access', hint: 'Des millions d\'objets, 19 musées', signupUrl: 'https://api.data.gov/signup' },
] as const;

export function ExternalSourcesPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['org-settings'], queryFn: settingsApi.getOrganization });
  const [values, setValues] = React.useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (patch: Record<string, string>) => settingsApi.updateExternalSources(patch),
    onSuccess: () => {
      toast.success('Clés enregistrées');
      setValues({});
      qc.invalidateQueries({ queryKey: ['org-settings'] });
    },
    onError: () => toast.error("Échec de l'enregistrement"),
  });

  if (isLoading || !data) return null;

  const hasChanges = Object.values(values).some((v) => v !== undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources externes</CardTitle>
        <CardDescription>
          Clés API gratuites utilisées comme solution de repli pour l'enrichissement des artistes
          quand Wikidata ne trouve rien. Met Museum et Art Institute of Chicago ne nécessitent aucune clé et sont déjà actifs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {SOURCES.map((source) => {
          const configured = data.externalSources[source.key];
          return (
            <div key={source.key} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
                  {source.label}
                  {configured && (
                    <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                      <Check className="h-3 w-3" /> Configurée
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={values[source.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [source.key]: e.target.value }))}
                  placeholder={configured ? '••••••••••••••••' : 'Coller la clé API ici'}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  {source.hint} ·{' '}
                  <a href={source.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                    Obtenir une clé <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>
            </div>
          );
        })}

        <button
          onClick={() => mutation.mutate(values)}
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
