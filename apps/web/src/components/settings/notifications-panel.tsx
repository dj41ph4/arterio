'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

const NOTIFICATION_TOGGLES = [
  { key: 'loanDue', label: 'Échéance de prêt à venir' },
  { key: 'insuranceExpiring', label: "Police d'assurance qui expire" },
  { key: 'restorationDue', label: 'Restauration programmée' },
  { key: 'newArtworkImported', label: 'Nouvelle œuvre importée' },
  { key: 'memberJoined', label: 'Nouveau membre ajouté' },
];

export function NotificationsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['org-settings'], queryFn: settingsApi.getOrganization });

  const mutation = useMutation({
    mutationFn: (notifications: Record<string, boolean>) => settingsApi.updateOrganization({ notifications }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-settings'] }),
    onError: () => toast.error('Échec de la mise à jour'),
  });

  if (isLoading || !data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Choisissez les événements qui déclenchent une alerte.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {NOTIFICATION_TOGGLES.map((item) => (
          <div key={item.key} className="flex items-center justify-between py-3">
            <span className="text-sm">{item.label}</span>
            <Switch
              checked={data.notifications[item.key] ?? true}
              onCheckedChange={(checked) => mutation.mutate({ [item.key]: checked })}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
