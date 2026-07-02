'use client';

import * as React from 'react';

const QUERY = '(max-width: 767px)'; // below Tailwind's md

/**
 * SSR-safe mobile detection: defaults to desktop on the server/first paint and
 * corrects after mount — same hydration-mismatch avoidance strategy as the
 * Zustand stores' skipHydration.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isMobile;
}
