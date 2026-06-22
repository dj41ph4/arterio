'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Download, Upload, PackageOpen, AlertTriangle } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function MigrationPanel() {
  const [exporting, setExporting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [confirmImport, setConfirmImport] = React.useState(false);
  const [result, setResult] = React.useState<{ organizationId: string; organizationName: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      await settingsApi.downloadMigration();
      toast.success('Export de migration téléchargé');
    } catch {
      toast.error("Échec de l'export");
    } finally {
      setExporting(false);
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await settingsApi.importMigration(file);
      setResult(res);
      toast.success(`Organisation « ${res.organizationName} » importée avec succès`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'import");
    } finally {
      setImporting(false);
      setConfirmImport(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Exporter une migration complète</CardTitle>
          <CardDescription>
            Génère un fichier .zip unique contenant absolument tout : organisation, membres et rôles,
            artistes, œuvres, collections, mouvements, documents, prêts, expositions, restaurations —
            et les fichiers (photos, documents) eux-mêmes, pas seulement leurs métadonnées.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PackageOpen className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Export complet (.zip)</p>
              <p className="text-xs text-muted-foreground">
                À utiliser pour réinstaller ailleurs sans rien perdre.
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> {exporting ? 'Génération…' : 'Télécharger'}
            </button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Ce fichier contient des données sensibles en clair (valeurs financières déchiffrées) —
            conservez-le comme un secret, au même titre qu'un mot de passe.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Importer une migration</CardTitle>
          <CardDescription>
            Restaure un fichier .zip généré par l'export ci-dessus. Crée toujours une <strong>nouvelle</strong>{' '}
            organisation à partir du fichier — n'écrase et ne fusionne jamais avec les données actuelles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" /> Après l'import
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Les comptes et mots de passe importés sont restaurés tels quels — reconnectez-vous avec l'un
              des comptes de l'organisation importée pour y accéder.
            </p>
          </div>

          <div className="mt-4 flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Fichier de migration (.zip)</p>
              <p className="text-xs text-muted-foreground">Sélectionnez le fichier exporté précédemment.</p>
            </div>
            {confirmImport ? (
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {importing ? 'Import en cours…' : 'Choisir le fichier'}
                </button>
                <button
                  onClick={() => setConfirmImport(false)}
                  className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmImport(true)}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                <Upload className="h-4 w-4" /> Importer
              </button>
            )}
          </div>

          {result && (
            <p className="mt-3 text-xs text-emerald-600">
              Organisation « {result.organizationName} » créée (id : {result.organizationId}).
              Déconnectez-vous puis reconnectez-vous avec un compte de cette organisation.
            </p>
          )}

          <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onFilePicked} />
        </CardContent>
      </Card>
    </div>
  );
}
