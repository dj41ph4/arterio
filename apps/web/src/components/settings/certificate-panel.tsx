'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Trash2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function CertificatePanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['certificate'], queryFn: settingsApi.getCertificate });
  const [certificate, setCertificate] = React.useState('');
  const [privateKey, setPrivateKey] = React.useState('');

  const upload = useMutation({
    mutationFn: () => settingsApi.uploadCertificate(certificate, privateKey),
    onSuccess: () => {
      toast.success('Certificat installé — redémarrez le conteneur API pour l\'activer');
      setCertificate('');
      setPrivateKey('');
      qc.invalidateQueries({ queryKey: ['certificate'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Certificat invalide'),
  });

  const remove = useMutation({
    mutationFn: () => settingsApi.removeCertificate(),
    onSuccess: () => {
      toast.success('Certificat retiré — redémarrez le conteneur API pour revenir à l\'auto-signé');
      qc.invalidateQueries({ queryKey: ['certificate'] });
    },
  });

  if (isLoading || !data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" /> Certificat HTTPS
        </CardTitle>
        <CardDescription>
          Par défaut, l'API génère un certificat auto-signé à chaque démarrage (si{' '}
          <code className="rounded bg-muted px-1">HTTPS_ENABLED=true</code>). Installez ici votre propre certificat
          (et sa clé privée) pour le remplacer — utile si votre reverse proxy vérifie le certificat de l'upstream.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.hasCustomCertificate ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
            <div className="text-sm">
              <p className="font-medium text-foreground">Certificat personnalisé installé</p>
              <p className="text-xs text-muted-foreground">
                {data.subject} · valide jusqu'au {data.validTo ? new Date(data.validTo).toLocaleDateString('fr-FR') : '—'}
              </p>
            </div>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Retirer
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" /> Aucun certificat personnalisé — auto-signé actif.
          </p>
        )}

        <div>
          <label className="text-xs font-medium text-muted-foreground">Certificat (PEM)</label>
          <textarea
            rows={5}
            value={certificate}
            onChange={(e) => setCertificate(e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Clé privée (PEM, non chiffrée)</label>
          <textarea
            rows={5}
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        <button
          onClick={() => upload.mutate()}
          disabled={upload.isPending || !certificate.trim() || !privateKey.trim()}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50',
            'bg-primary',
          )}
        >
          <Save className="h-4 w-4" /> Installer le certificat
        </button>
      </CardContent>
    </Card>
  );
}
