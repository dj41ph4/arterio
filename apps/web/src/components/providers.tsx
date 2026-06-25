'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { applyAccent } from '@/lib/accent';

/** Keeps the CSS accent variables in sync with the chosen accent + active theme. */
function AccentSync() {
  const accent = useUiStore((s) => s.accent);
  const { resolvedTheme } = useTheme();

  // Rehydrate persisted preferences on the client (store uses skipHydration).
  React.useEffect(() => {
    void useUiStore.persist.rehydrate();
    void useAuthStore.persist.rehydrate();
  }, []);

  React.useEffect(() => {
    applyAccent(accent, resolvedTheme === 'dark');
  }, [accent, resolvedTheme]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={250}>
          <AccentSync />
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast:
                  'rounded-lg border border-border bg-popover text-popover-foreground shadow-floating',
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </NextThemesProvider>
  );
}
