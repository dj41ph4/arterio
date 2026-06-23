'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  SlidersHorizontal,
  Palette,
  ShieldCheck,
  Users,
  KeyRound,
  Bell,
  DatabaseBackup,
  PackageOpen,
  Sun,
  Moon,
  Monitor,
  Check,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { LOCALES, LOCALE_META, type Locale } from '@arterio/shared';
import { usePathname, useRouter } from '@/i18n/navigation';
import { PageHeader } from '@/components/app-shell/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ACCENT_PRESETS } from '@/lib/accent';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { MembersPanel } from './members-panel';
import { GeneralPanel } from './general-panel';
import { NotificationsPanel } from './notifications-panel';
import { ApiKeysPanel } from './api-keys-panel';
import { ExternalSourcesPanel } from './external-sources-panel';
import { OAuthPanel } from './oauth-panel';
import { AuditLogPanel } from './audit-log-panel';
import { TrashPanel } from './trash-panel';
import { BackupsPanel } from './backups-panel';
import { MigrationPanel } from './migration-panel';
import { settingsApi } from '@/lib/data/admin';

const SECTIONS = [
  { id: 'general', icon: SlidersHorizontal, key: 'general', danger: false },
  { id: 'appearance', icon: Palette, key: 'appearance', danger: false },
  { id: 'security', icon: ShieldCheck, key: 'security', danger: false },
  { id: 'members', icon: Users, key: 'members', danger: false },
  { id: 'api', icon: KeyRound, key: 'api', danger: false },
  { id: 'notifications', icon: Bell, key: 'notifications', danger: false },
  { id: 'backups', icon: DatabaseBackup, key: 'backups', danger: false },
  { id: 'migration', icon: PackageOpen, key: 'migration', danger: false },
  { id: 'danger', icon: AlertTriangle, key: 'danger', danger: true },
] as const;

const DANGER_ITEMS = [
  { id: 'artworks',    label: 'Œuvres d\'art',    description: 'Toutes les fiches, médias et historiques d\'œuvres' },
  { id: 'artists',     label: 'Artistes',          description: 'Fiches artistes et biographies' },
  { id: 'collections', label: 'Collections',       description: 'Structures de collections et groupements' },
  { id: 'exhibitions', label: 'Expositions',       description: 'Données d\'expositions et participations' },
  { id: 'loans',       label: 'Prêts',             description: 'Contrats et historiques de prêts' },
  { id: 'locations',   label: 'Emplacements',      description: 'Lieux de stockage et cartographie' },
  { id: 'documents',   label: 'Documents',         description: 'Documents, contrats et certificats' },
  { id: 'restorations',label: 'Restaurations',     description: 'Rapports et interventions de conservation' },
] as const;

type DangerItemId = (typeof DANGER_ITEMS)[number]['id'];

function DangerZone() {
  const [selected, setSelected] = React.useState<Set<DangerItemId>>(new Set());
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const allSelected = selected.size === DANGER_ITEMS.length;
  const noneSelected = selected.size === 0;

  const toggle = (id: DangerItemId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(DANGER_ITEMS.map((i) => i.id)));
  };

  const actionLabel = allSelected
    ? 'Réinitialisation complète'
    : `Supprimer la sélection (${selected.size})`;

  const CONFIRM_WORD = 'SUPPRIMER';

  const [error, setError] = React.useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await settingsApi.wipeData(Array.from(selected));
      setDone(true);
      setConfirmOpen(false);
      setSelected(new Set());
      setConfirmText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La suppression a échoué');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div className="text-sm">
          <p className="font-semibold text-red-500">Zone dangereuse — actions irréversibles</p>
          <p className="mt-0.5 text-red-400/80">
            Les données supprimées ne peuvent pas être récupérées. Assurez-vous d'avoir une sauvegarde avant de procéder.
          </p>
        </div>
      </div>

      {done && (
        <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/5 p-4 text-sm text-green-600 dark:text-green-400">
          <Check className="h-4 w-4 shrink-0" />
          Données supprimées avec succès.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Select all */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
        <span className="text-sm font-medium text-foreground">Tout sélectionner</span>
        <button
          onClick={toggleAll}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded border-2 transition-colors',
            allSelected
              ? 'border-red-500 bg-red-500 text-white'
              : selected.size > 0
              ? 'border-red-500/60 bg-red-500/20'
              : 'border-border',
          )}
        >
          {allSelected && <Check className="h-3 w-3" />}
          {!allSelected && selected.size > 0 && <span className="h-0.5 w-2.5 bg-red-500 rounded-full" />}
        </button>
      </div>

      {/* Items */}
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {DANGER_ITEMS.map((item) => {
          const checked = selected.has(item.id);
          return (
            <div
              key={item.id}
              onClick={() => toggle(item.id)}
              className="flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/40"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              <div
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
                  checked ? 'border-red-500 bg-red-500 text-white' : 'border-border',
                )}
              >
                {checked && <Check className="h-3 w-3" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action button */}
      <button
        disabled={noneSelected}
        onClick={() => setConfirmOpen(true)}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all',
          noneSelected
            ? 'cursor-not-allowed border border-border text-muted-foreground'
            : 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-900/20',
        )}
      >
        <Trash2 className="h-4 w-4" />
        {noneSelected ? 'Sélectionnez au moins un type de données' : actionLabel}
      </button>

      {/* Confirmation dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setConfirmOpen(false); setConfirmText(''); }} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-red-500/30 bg-background p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              {allSelected ? 'Réinitialisation complète' : 'Confirmer la suppression'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Vous allez supprimer définitivement :{' '}
              <span className="font-medium text-foreground">
                {Array.from(selected).map((id) => DANGER_ITEMS.find((i) => i.id === id)?.label).join(', ')}
              </span>.
              <br />Cette action est <strong>irréversible</strong>.
            </p>
            <div className="mt-4">
              <label className="text-xs font-medium text-muted-foreground">
                Tapez <span className="font-mono font-bold text-red-500">{CONFIRM_WORD}</span> pour confirmer
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder={CONFIRM_WORD}
                className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-red-500/40"
              />
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => { setConfirmOpen(false); setConfirmText(''); }}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Annuler
              </button>
              <button
                disabled={confirmText !== CONFIRM_WORD || deleting}
                onClick={handleDelete}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white transition-opacity hover:bg-red-700 disabled:opacity-40"
              >
                {deleting ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> Suppression…</>
                ) : (
                  <><Trash2 className="h-4 w-4" /> Confirmer</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const accent = useUiStore((s) => s.accent);
  const setAccent = useUiStore((s) => s.setAccent);
  const [section, setSection] = React.useState<string>('appearance');
  const [pending, startTransition] = React.useTransition();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="mx-auto max-w-[1100px] p-4 md:p-6 lg:p-8">
      <PageHeader title={t('settings.title')} />
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        {/* Section nav */}
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  s.danger
                    ? active
                      ? 'bg-red-500/10 text-red-500'
                      : 'text-red-500/70 hover:bg-red-500/5 hover:text-red-500'
                    : active
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {t(`settings.${s.key}`)}
              </button>
            );
          })}
        </nav>

        {/* Panels */}
        <div className="space-y-6">
          {section === 'appearance' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('theme.appearance')}</CardTitle>
                  <CardDescription>{t('theme.accent')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-3 gap-3">
                    {(['light', 'dark', 'system'] as const).map((mode) => {
                      const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
                      const active = mounted && theme === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => setTheme(mode)}
                          className={cn(
                            'flex flex-col items-center gap-2 rounded-xl border p-4 transition-all',
                            active ? 'border-primary ring-2 ring-ring/40' : 'border-border hover:bg-muted/40',
                          )}
                        >
                          <Icon className="size-5" />
                          <span className="text-sm font-medium">{t(`theme.${mode}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <Separator />
                  <div>
                    <p className="mb-3 text-sm font-medium">{t('theme.accent')}</p>
                    <div className="flex flex-wrap gap-2.5">
                      {ACCENT_PRESETS.map((preset) => {
                        const selected = preset.id === accent;
                        return (
                          <button
                            key={preset.id}
                            onClick={() => setAccent(preset.id)}
                            title={preset.name}
                            className={cn(
                              'flex size-9 items-center justify-center rounded-full transition-transform hover:scale-110',
                              selected && 'ring-2 ring-ring/60 ring-offset-2 ring-offset-background',
                            )}
                            style={{ background: `hsl(${preset.light})` }}
                          >
                            {selected && <Check className="size-4 text-white" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.language')}</CardTitle>
                  <CardDescription>{t('settings.languageHint')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {LOCALES.map((l) => {
                      const active = l === locale;
                      return (
                        <button
                          key={l}
                          disabled={pending}
                          onClick={() => startTransition(() => router.replace(pathname, { locale: l }))}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-all',
                            active ? 'border-primary ring-2 ring-ring/40' : 'border-border hover:bg-muted/40',
                          )}
                        >
                          <span className="text-base">{LOCALE_META[l].flag}</span>
                          <span className="flex-1 text-left font-medium">{LOCALE_META[l].nativeLabel}</span>
                          {active && <Check className="size-4 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {section === 'security' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.security')}</CardTitle>
                  <CardDescription>État réel des protections de cette installation.</CardDescription>
                </CardHeader>
                <CardContent className="divide-y divide-border">
                  {[
                    { label: 'Chiffrement des valuations (AES-256-GCM)', available: true },
                    { label: 'Journal d\'audit inviolable (chaîné par hachage)', available: true },
                    { label: 'Limitation de débit sur la connexion (anti brute-force)', available: true },
                    { label: 'Authentification à deux facteurs (TOTP)', available: false },
                    { label: 'Clés de sécurité / Passkeys (WebAuthn)', available: false },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between py-3">
                      <span className="text-sm">{item.label}</span>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-medium',
                          item.available
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {item.available ? 'Actif' : 'Non disponible'}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <AuditLogPanel />
              <OAuthPanel />
            </>
          )}

          {section === 'general' && <GeneralPanel />}
          {section === 'members' && <MembersPanel />}
          {section === 'api' && (
            <>
              <ApiKeysPanel />
              <ExternalSourcesPanel />
            </>
          )}
          {section === 'notifications' && <NotificationsPanel />}
          {section === 'backups' && <BackupsPanel />}
          {section === 'migration' && <MigrationPanel />}
          {section === 'danger' && (
            <>
              <TrashPanel />
              <DangerZone />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
