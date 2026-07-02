'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function GeneralPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['org-settings'], queryFn: settingsApi.getOrganization });
  const [name, setName] = React.useState('');
  const [legalName, setLegalName] = React.useState('');

  React.useEffect(() => {
    if (data) { setName(data.name); setLegalName(data.legalName ?? ''); }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => settingsApi.updateOrganization({ name, legalName }),
    onSuccess: () => { toast.success('Organisation mise à jour'); qc.invalidateQueries({ queryKey: ['org-settings'] }); },
    onError: () => toast.error('Échec de la mise à jour'),
  });

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisation</CardTitle>
        <CardDescription>Informations générales de votre organisation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Nom</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Raison sociale</label>
          <input
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="—"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !name}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> Enregistrer
        </button>
      </CardContent>
    </Card>
  );
}
