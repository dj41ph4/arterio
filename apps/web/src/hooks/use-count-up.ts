'use client';

import * as React from 'react';

/** Animates a number from 0 to `value` over `durationMs`, easing out. */
export function useCountUp(value: number, durationMs = 900): number {
  const [display, setDisplay] = React.useState(0);
  const startRef = React.useRef<number | null>(null);
  const fromRef = React.useRef(0);

  React.useEffect(() => {
    fromRef.current = 0;
    startRef.current = null;
    let raf = 0;

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(fromRef.current + (value - fromRef.current) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return display;
}
