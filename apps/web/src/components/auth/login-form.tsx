'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/auth-store';
import { API_BASE_URL } from '@/lib/api/client';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

export function LoginForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [loading, setLoading] = React.useState(false);
  const [oauthProviders, setOauthProviders] = React.useState<{ google: boolean; microsoft: boolean }>({
    google: false,
    microsoft: false,
  });
  const [emailConfigured, setEmailConfigured] = React.useState(false);
  const [forgotOpen, setForgotOpen] = React.useState(false);
  const [forgotEmail, setForgotEmail] = React.useState('');
  const [forgotSending, setForgotSending] = React.useState(false);

  // Fresh install, nobody has set up an admin account yet — send there
  // instead of showing a login form with nothing to log into.
  React.useEffect(() => {
    if (!USE_API) return;
    fetch(`${API_BASE_URL}/setup/status`)
      .then((r) => r.json())
      .then((data: { needsSetup: boolean }) => {
        if (data.needsSetup) router.replace('/setup');
      })
      .catch(() => undefined);
  }, [router]);

  // Only show a provider's button once it actually has credentials configured
  // in Settings — otherwise clicking it would just fail.
  React.useEffect(() => {
    if (!USE_API) return;
    fetch(`${API_BASE_URL}/auth/oauth/providers`)
      .then((r) => r.json())
      .then(setOauthProviders)
      .catch(() => undefined);
    fetch(`${API_BASE_URL}/auth/email-status`)
      .then((r) => r.json())
      .then((d: { configured: boolean }) => setEmailConfigured(d.configured))
      .catch(() => undefined);
  }, []);

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setForgotSending(true);
    // Always shows the same generic confirmation, success or not — matches the
    // backend, which never reveals whether an email is registered.
    await fetch(`${API_BASE_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: forgotEmail }),
    }).catch(() => undefined);
    toast.success(t('forgotPasswordSent'));
    setForgotOpen(false);
    setForgotEmail('');
    setForgotSending(false);
  }

  function startOAuth(provider: 'google' | 'microsoft') {
    const params = new URLSearchParams({ returnOrigin: window.location.origin, locale });
    window.location.href = `${API_BASE_URL}/auth/oauth/${provider}/start?${params.toString()}`;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    if (!USE_API) {
      // Demo mode: no backend wired — navigate straight to the workspace.
      setTimeout(() => router.push('/dashboard'), 650);
      return;
    }

    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Login failed' }));
        throw new Error(body.message ?? 'Login failed');
      }
      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      router.push('/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  }

  return (
    <motion.form
      onSubmit={onSubmit}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-sm space-y-5"
    >
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="email">
          {t('email')}
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            name="email"
            type="email"
            required
            defaultValue="admin@arterio.app"
            placeholder="you@museum.org"
            className="pl-9"
            autoComplete="email"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium" htmlFor="password">
            {t('password')}
          </label>
          <button
            type="button"
            onClick={() => (emailConfigured ? setForgotOpen((v) => !v) : toast.info(t('forgotPasswordHint')))}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t('forgotPassword')}
          </button>
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            name="password"
            type="password"
            required
            defaultValue="demo-password"
            placeholder="••••••••"
            className="pl-9"
            autoComplete="current-password"
          />
        </div>
      </div>

      {forgotOpen && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t('forgotPasswordPrompt')}</p>
          <div className="flex gap-2">
            <Input
              type="email"
              required
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="you@museum.org"
              className="flex-1"
            />
            <Button type="button" size="sm" disabled={forgotSending || !forgotEmail} onClick={handleForgotPassword}>
              {forgotSending ? <Loader2 className="size-4 animate-spin" /> : t('forgotPasswordSend')}
            </Button>
          </div>
        </div>
      )}

      <Button type="submit" className="w-full shadow-elevated" size="lg" disabled={loading}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            {t('signInButton')} <ArrowRight className="size-4" />
          </>
        )}
      </Button>

      {(oauthProviders.google || oauthProviders.microsoft) && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase text-muted-foreground">{t('or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {oauthProviders.google && (
              <Button type="button" variant="outline" onClick={() => startOAuth('google')}>
                {t('continueWithGoogle')}
              </Button>
            )}
            {oauthProviders.microsoft && (
              <Button type="button" variant="outline" onClick={() => startOAuth('microsoft')}>
                {t('continueWithMicrosoft')}
              </Button>
            )}
          </div>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <button type="button" className="font-medium text-primary hover:underline">
          {t('requestAccess')}
        </button>
      </p>
    </motion.form>
  );
}
