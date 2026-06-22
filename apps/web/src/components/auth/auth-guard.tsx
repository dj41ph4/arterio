'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Redirects to /login when the app is wired to the real API (NEXT_PUBLIC_DATA_SOURCE=http)
 * and no access token is present — without this, protected pages just hang forever
 * re-fetching data that 401s.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { locale } = useParams<{ locale: string }>();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    void Promise.resolve(useAuthStore.persist.rehydrate()).then(() => setHydrated(true));
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    if (process.env.NEXT_PUBLIC_DATA_SOURCE !== 'http') return;
    if (!accessToken) {
      window.location.href = `/${locale}/login`;
    }
  }, [hydrated, accessToken, locale]);

  if (process.env.NEXT_PUBLIC_DATA_SOURCE === 'http' && (!hydrated || !accessToken)) {
    return null;
  }

  return <>{children}</>;
}
