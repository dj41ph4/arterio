'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { DatabaseBackup, Download } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function BackupsPanel() {
  const [downloading, setDownloading] = React.useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await settingsApi.downloadBackup();
      toast.success('Sauvegarde téléchargée');
    } catch (err) {
      toast.error(err instanceof Error ? `Échec de la sauvegarde : ${err.message}` : 'Échec de la sauvegarde');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sauvegardes</CardTitle>
        <CardDescription>
          Téléchargez une copie complète de vos données (œuvres, artistes, collections, mouvements) au format JSON.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <DatabaseBackup className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Sauvegarde manuelle complète</p>
            <p className="text-xs text-muted-foreground">Génère un export JSON horodaté de toute la collection.</p>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> {downloading ? 'Génération…' : 'Télécharger'}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Conservez ce fichier en lieu sûr — il contient l'ensemble de vos données, y compris les informations financières chiffrées.
        </p>
      </CardContent>
    </Card>
  );
}
