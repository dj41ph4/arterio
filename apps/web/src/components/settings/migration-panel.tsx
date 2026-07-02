'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Download, Upload, PackageOpen, AlertTriangle, RotateCcw } from 'lucide-react';
import { settingsApi } from '@/lib/data/admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function MigrationPanel() {
  const [exporting, setExporting] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [confirmRestore, setConfirmRestore] = React.useState(false);
  const [confirmImport, setConfirmImport] = React.useState(false);
  const [restoreResult, setRestoreResult] = React.useState<{ restoredItems: number } | null>(null);
  const [importResult, setImportResult] = React.useState<{ organizationId: string; organizationName: string } | null>(null);
  const restoreInputRef = React.useRef<HTMLInputElement>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      await settingsApi.downloadMigration();
      toast.success('Export de migration téléchargé');
    } catch (err) {
      toast.error(err instanceof Error ? `Échec de l'export : ${err.message}` : "Échec de l'export");
    } finally {
      setExporting(false);
    }
  };

  const onRestoreFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRestoring(true);
    setRestoreResult(null);
    try {
      const res = await settingsApi.restoreMigration(file);
      setRestoreResult(res);
      toast.success(`Restauration terminée — ${res.restoredItems} éléments restaurés`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la restauration');
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  };

  const onImportFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await settingsApi.importMigration(file);
      setImportResult(res);
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
      {/* ── Export ─────────────────────────────────────────────────────────── */}
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
              <p className="text-xs text-muted-foreground">À utiliser pour sauvegarder ou réinstaller ailleurs.</p>
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

      {/* ── Restore (in-place) ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Restaurer dans l'organisation courante</CardTitle>
          <CardDescription>
            Efface toutes les données de l'organisation actuelle et les remplace par le contenu du
            fichier .zip. Vous restez connecté — pas besoin de changer de compte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" /> Action irréversible
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Toutes les données actuelles (œuvres, artistes, collections…) seront supprimées avant
              l'import. Exportez d'abord si vous avez besoin de les conserver.
            </p>
          </div>

          <div className="mt-4 flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Fichier de migration (.zip)</p>
              <p className="text-xs text-muted-foreground">Sélectionnez le fichier exporté précédemment.</p>
            </div>
            {confirmRestore ? (
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => restoreInputRef.current?.click()}
                  disabled={restoring}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {restoring ? 'Restauration…' : 'Choisir le fichier'}
                </button>
                <button
                  onClick={() => setConfirmRestore(false)}
                  className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRestore(true)}
                className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                <RotateCcw className="h-4 w-4" /> Restaurer
              </button>
            )}
          </div>

          {restoreResult && (
            <p className="mt-3 text-xs text-emerald-600">
              Restauration réussie — {restoreResult.restoredItems} éléments rechargés. Rechargez la page pour voir les données.
            </p>
          )}

          <input ref={restoreInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onRestoreFilePicked} />
        </CardContent>
      </Card>

      {/* ── Import new org ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Importer comme nouvelle organisation</CardTitle>
          <CardDescription>
            Crée une <strong>nouvelle</strong> organisation parallèle à partir du fichier .zip — ne
            touche pas aux données actuelles. Utile pour migrer vers un nouveau serveur ou fusionner
            deux installations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" /> Après l'import
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Une nouvelle organisation est créée. Pour y accéder, déconnectez-vous puis reconnectez-vous
              avec l'un des comptes de l'organisation importée (mêmes identifiants qu'à l'export).
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
                  onClick={() => importInputRef.current?.click()}
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

          {importResult && (
            <p className="mt-3 text-xs text-emerald-600">
              Organisation « {importResult.organizationName} » créée (id : {importResult.organizationId}).
              Déconnectez-vous puis reconnectez-vous avec un compte de cette organisation.
            </p>
          )}

          <input ref={importInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onImportFilePicked} />
        </CardContent>
      </Card>
    </div>
  );
}
