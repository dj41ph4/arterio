'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Building2, User, Mail, Lock, ArrowRight, Loader2, Upload, FileArchive, Server, Network } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/auth-store';
import { API_BASE_URL } from '@/lib/api/client';
import { buildApiBaseFromHost, saveApiHostOverride, getApiHostOverride } from '@/lib/api/setup-host';
import { cn } from '@/lib/utils';

function ApiServerQuestion({
  onAnswer,
}: {
  onAnswer: (apiBase: string) => void;
}) {
  const t = useTranslations('setup');
  const [showHostInput, setShowHostInput] = React.useState(false);
  // Pre-fill with a previous answer, if any, as a convenience — never trusted
  // silently (see the comment in SetupForm), the operator must confirm it.
  const [host, setHost] = React.useState(() => getApiHostOverride()?.replace(/^https?:\/\//, '').replace(/\/api\/v1\/?$/, '') ?? '');

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm space-y-5"
    >
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('apiServerQuestion')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('apiServerQuestionHint')}</p>
      </div>

      {!showHostInput ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onAnswer(API_BASE_URL)}
            className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-colors hover:border-primary hover:bg-primary/5"
          >
            <Server className="size-6 text-primary" />
            <span className="text-sm font-medium">{t('apiServerSame')}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowHostInput(true)}
            className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-colors hover:border-primary hover:bg-primary/5"
          >
            <Network className="size-6 text-primary" />
            <span className="text-sm font-medium">{t('apiServerDifferent')}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-sm font-medium" htmlFor="apiHost">{t('apiServerHostLabel')}</label>
          <Input
            id="apiHost"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={t('apiServerHostPlaceholder')}
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setShowHostInput(false)} className="flex-1">
              {t('apiServerBack')}
            </Button>
            <Button
              type="button"
              disabled={!host.trim()}
              onClick={() => {
                const apiBase = buildApiBaseFromHost(host);
                saveApiHostOverride(apiBase);
                onAnswer(apiBase);
              }}
              className="flex-1"
            >
              {t('apiServerContinue')} <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function NewOrgForm({ loading, onSubmit }: { loading: boolean; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  const t = useTranslations('setup');

  return (
    <motion.form
      onSubmit={onSubmit}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-5"
    >
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="organizationName">
          {t('organizationName')}
        </label>
        <div className="relative">
          <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="organizationName"
            name="organizationName"
            type="text"
            required
            placeholder={t('organizationNamePlaceholder')}
            className="pl-9"
            autoComplete="organization"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="fullName">
          {t('fullName')}
        </label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="fullName" name="fullName" type="text" required className="pl-9" autoComplete="name" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="email">
          {t('email')}
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="email" name="email" type="email" required className="pl-9" autoComplete="email" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="password">
          {t('password')}
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="••••••••"
            className="pl-9"
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="confirmPassword">
          {t('confirmPassword')}
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            placeholder="••••••••"
            className="pl-9"
            autoComplete="new-password"
          />
        </div>
      </div>

      <Button type="submit" className="w-full shadow-elevated" size="lg" disabled={loading}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            {t('submitButton')} <ArrowRight className="size-4" />
          </>
        )}
      </Button>
    </motion.form>
  );
}

function ImportForm({ loading, onPick }: { loading: boolean; onPick: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  const t = useTranslations('setup');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <FileArchive className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('importHint')}</p>
      </div>
      <Button
        type="button"
        className="w-full shadow-elevated"
        size="lg"
        disabled={loading}
        onClick={() => fileInputRef.current?.click()}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <Upload className="size-4" /> {t('importButton')}
          </>
        )}
      </Button>
      <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onPick} />
    </div>
  );
}

export function SetupForm() {
  const t = useTranslations('setup');
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [mode, setMode] = React.useState<'new' | 'import'>('new');
  const [loading, setLoading] = React.useState(false);
  const [checking, setChecking] = React.useState(true);
  const [importResult, setImportResult] = React.useState<{ organizationName: string } | null>(null);
  // Asked once, before any API call: lets a split web/API deployment point at
  // the right host instead of guessing from window.location. Always re-asked
  // here even if a previous answer is saved — landing back on /setup means
  // the database is fresh, so a stale override from a previous install must
  // not be trusted silently (it's still offered as the input's default).
  const [apiBase, setApiBase] = React.useState<string | null>(
    process.env.NEXT_PUBLIC_DATA_SOURCE !== 'http' ? API_BASE_URL : null,
  );

  React.useEffect(() => {
    if (!apiBase) return; // still waiting on the "same server?" question
    if (process.env.NEXT_PUBLIC_DATA_SOURCE !== 'http') {
      setChecking(false);
      return;
    }
    fetch(`${apiBase}/setup/status`)
      .then((r) => r.json())
      .then((data: { needsSetup: boolean }) => {
        if (!data.needsSetup) {
          toast.info(t('redirecting'));
          router.replace('/login');
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [apiBase, router, t]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const organizationName = (form.elements.namedItem('organizationName') as HTMLInputElement).value;
    const fullName = (form.elements.namedItem('fullName') as HTMLInputElement).value;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    const confirmPassword = (form.elements.namedItem('confirmPassword') as HTMLInputElement).value;

    if (password.length < 8) {
      toast.error(t('passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('passwordMismatch'));
      return;
    }

    setLoading(true);

    if (process.env.NEXT_PUBLIC_DATA_SOURCE !== 'http') {
      setTimeout(() => router.push('/dashboard'), 650);
      return;
    }

    try {
      const res = await fetch(`${apiBase}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationName, fullName, email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Setup failed' }));
        throw new Error(body.message ?? 'Setup failed');
      }
      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      router.push('/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Setup failed');
      setLoading(false);
    }
  }

  async function onImportFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${apiBase}/setup/import`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Import failed' }));
        throw new Error(body.message ?? 'Import failed');
      }
      const data = await res.json();
      setImportResult({ organizationName: data.organizationName });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  if (!apiBase) return <ApiServerQuestion onAnswer={setApiBase} />;

  if (checking) return null;

  if (importResult) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-5"
      >
        <p className="text-sm font-semibold text-foreground">{t('importSuccessTitle')}</p>
        <p className="text-sm text-muted-foreground">
          {t('importSuccessBody', { name: importResult.organizationName })}
        </p>
        <Button className="w-full" onClick={() => router.push('/login')}>
          {t('importSuccessTitle')} <ArrowRight className="size-4" />
        </Button>
      </motion.div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-5">
      <div className="flex rounded-lg border border-border p-1">
        <button
          type="button"
          onClick={() => setMode('new')}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'new' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t('modeNew')}
        </button>
        <button
          type="button"
          onClick={() => setMode('import')}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'import' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t('modeImport')}
        </button>
      </div>

      {mode === 'import' ? (
        <ImportForm loading={loading} onPick={onImportFilePicked} />
      ) : (
        <NewOrgForm loading={loading} onSubmit={onSubmit} />
      )}
    </div>
  );
}
