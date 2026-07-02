'use client';

import * as React from 'react';

declare global {
  interface Window {
    /** Stashed beforeinstallprompt event — consumed by the "Installer l'application" tile in the mobile nav. */
    __arterioInstallPrompt?: { prompt: () => Promise<void> } | null;
  }
}

/**
 * Registers the service worker (public/sw.js — installability + share target)
 * and stashes the install prompt for UI surfaces that want to offer "install".
 * Renders nothing.
 */
export function PwaSetup() {
  React.useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Non-fatal: HTTP origins other than localhost don't get SWs — the app works fine without.
      });
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__arterioInstallPrompt = e as unknown as { prompt: () => Promise<void> };
      window.dispatchEvent(new CustomEvent('arterio:install-available'));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  return null;
}
