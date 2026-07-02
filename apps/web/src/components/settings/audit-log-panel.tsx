'use client';

import * as React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface AuditEntry {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorName: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  'auth.login_success': 'Connexion réussie',
  'auth.login_failed': 'Connexion échouée',
  'artwork.delete': 'Œuvre supprimée',
  'settings.danger_zone_wipe': 'Suppression en masse (zone dangereuse)',
  'member.invite': 'Membre invité',
  'member.update': 'Membre modifié',
  'member.remove': 'Membre désactivé',
  'member.reset_password': 'Mot de passe réinitialisé',
};

export function AuditLogPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => apiFetch<AuditEntry[]>('/settings/audit-log'),
  });

  const verifyMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; brokenAt?: string }>('/settings/audit-log/verify'),
    onSuccess: (res) => {
      if (res.ok) toast.success('Journal intact — aucune altération détectée');
      else toast.error(`Chaîne rompue à l'entrée ${res.brokenAt}`);
    },
    onError: () => toast.error('Échec de la vérification'),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Journal d'audit</CardTitle>
          <CardDescription>
            Trace inviolable des actions sensibles — chaque entrée est liée par hachage à la précédente.
          </CardDescription>
        </div>
        <button
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {verifyMutation.isPending ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          Vérifier l'intégrité
        </button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : !data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucune entrée pour le moment.</p>
        ) : (
          <div className="divide-y divide-border">
            {data.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 py-2.5 text-sm">
                {entry.action.includes('failed') || entry.action.includes('wipe') ? (
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
                ) : (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-foreground">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{entry.actorName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
