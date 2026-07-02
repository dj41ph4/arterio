'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Check, Copy } from 'lucide-react';
import { settingsApi, type OAuthProviderKey } from '@/lib/data/admin';
import { API_BASE_URL } from '@/lib/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const PROVIDERS: { key: OAuthProviderKey; label: string; consoleUrl: string; consoleHint: string }[] = [
  {
    key: 'google',
    label: 'Google',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    consoleHint: 'Identifiants → ID client OAuth → Application Web',
  },
  {
    key: 'microsoft',
    label: 'Microsoft',
    consoleUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    consoleHint: 'Microsoft Entra ID → Inscriptions d\'applications',
  },
];

export function OAuthPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['oauth-providers'], queryFn: settingsApi.getOAuthProviders });
  const [values, setValues] = React.useState<Record<string, { clientId?: string; clientSecret?: string }>>({});

  const mutation = useMutation({
    mutationFn: ({ provider, patch }: { provider: OAuthProviderKey; patch: { clientId?: string; clientSecret?: string } }) =>
      settingsApi.updateOAuthProvider(provider, patch),
    onSuccess: (_data, vars) => {
      toast.success(`Connexion ${vars.provider === 'google' ? 'Google' : 'Microsoft'} enregistrée`);
      setValues((v) => ({ ...v, [vars.provider]: {} }));
      qc.invalidateQueries({ queryKey: ['oauth-providers'] });
    },
    onError: () => toast.error("Échec de l'enregistrement"),
  });

  if (isLoading || !data) return null;

  const redirectUriFor = (provider: OAuthProviderKey) => `${API_BASE_URL}/auth/oauth/${provider}/callback`;

  const copyRedirectUri = (provider: OAuthProviderKey) => {
    navigator.clipboard.writeText(redirectUriFor(provider));
    toast.success('URI de redirection copiée');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connexion Google &amp; Microsoft</CardTitle>
        <CardDescription>
          Permet aux membres de se connecter avec leur compte Google ou Microsoft, en plus du mot de
          passe. Tant qu'un fournisseur n'a pas d'identifiants configurés ici, son bouton n'apparaît
          pas sur la page de connexion. La connexion ne crée jamais de nouveau compte — l'adresse
          e-mail doit déjà correspondre à un membre invité.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {PROVIDERS.map((p) => {
          const configured = data[p.key];
          const v = values[p.key] ?? {};
          const redirectUri = redirectUriFor(p.key);
          return (
            <div key={p.key} className="rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {p.label}
                  {configured && (
                    <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                      <Check className="h-3 w-3" /> Configuré
                    </span>
                  )}
                </span>
                <a href={p.consoleUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Créer des identifiants {p.label} →
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">ID client</label>
                  <input
                    type="text"
                    value={v.clientId ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, [p.key]: { ...s[p.key], clientId: e.target.value } }))}
                    placeholder={configured ? '••••••••••••' : 'Coller l\'ID client'}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Secret client</label>
                  <input
                    type="password"
                    value={v.clientSecret ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, [p.key]: { ...s[p.key], clientSecret: e.target.value } }))}
                    placeholder={configured ? '••••••••••••' : 'Coller le secret client'}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{redirectUri}</span>
                <button
                  type="button"
                  onClick={() => copyRedirectUri(p.key)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  <Copy className="h-3 w-3" /> Copier
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Collez cette URI exacte comme "URI de redirection autorisée" dans {p.consoleHint}.
              </p>

              <button
                onClick={() => mutation.mutate({ provider: p.key, patch: v })}
                disabled={mutation.isPending || (!v.clientId && !v.clientSecret)}
                className={cn(
                  'mt-3 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50',
                )}
              >
                <Save className="h-4 w-4" /> Enregistrer
              </button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
