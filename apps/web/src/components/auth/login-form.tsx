'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/auth-store';
import { API_BASE_URL } from '@/lib/api/client';

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    if (process.env.NEXT_PUBLIC_DATA_SOURCE !== 'http') {
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
          <button type="button" className="text-xs font-medium text-primary hover:underline">
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

      <Button type="submit" className="w-full shadow-elevated" size="lg" disabled={loading}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            {t('signInButton')} <ArrowRight className="size-4" />
          </>
        )}
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase text-muted-foreground">{t('or')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" onClick={() => router.push('/dashboard')}>
          Google
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push('/dashboard')}>
          Microsoft
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <button type="button" className="font-medium text-primary hover:underline">
          {t('requestAccess')}
        </button>
      </p>
    </motion.form>
  );
}
