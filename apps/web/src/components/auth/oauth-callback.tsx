'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Lands here after the API's OAuth callback redirects the browser back with
 * tokens in the URL fragment (never the query string, so they never hit a
 * server log). Pure client-side hand-off: read the fragment, store the
 * tokens, then go to the workspace.
 */
export function OAuthCallback() {
  const t = useTranslations('auth');
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const err = params.get('error');
    if (err) {
      setError(err);
      return;
    }
    const access = params.get('access');
    const refresh = params.get('refresh');
    if (!access || !refresh) {
      setError('missing_tokens');
      return;
    }
    setTokens(access, refresh);
    router.replace('/dashboard');
  }, [router, setTokens]);

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{t('oauthError')}</p>
        <button onClick={() => router.replace('/login')} className="text-sm font-medium text-primary hover:underline">
          {t('backToLogin')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
