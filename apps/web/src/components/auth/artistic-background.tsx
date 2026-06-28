'use client';

import * as React from 'react';

/**
 * Generative line-art background for the auth/setup screens — replaces a
 * static blurred-blob image with a few flowing contour lines that drift
 * smoothly (sine-driven control points, not random jitter), like a slow
 * brush stroke. Mutates path `d` attributes directly via refs instead of
 * going through React state every frame — a render loop at 60fps through
 * setState would otherwise re-render the whole tree for nothing.
 */

interface LineSpec {
  baseY: number; // 0–100, % of viewBox height
  amplitude: number;
  frequency: number;
  phase: number;
  speed: number;
  width: number;
  color: 'primary' | 'violet';
  opacity: number;
}

const LINES: LineSpec[] = [
  { baseY: 18, amplitude: 8, frequency: 1.3, phase: 0, speed: 0.18, width: 1.5, color: 'primary', opacity: 0.5 },
  { baseY: 34, amplitude: 11, frequency: 0.9, phase: 1.4, speed: 0.13, width: 1, color: 'violet', opacity: 0.35 },
  { baseY: 50, amplitude: 14, frequency: 1.1, phase: 2.6, speed: 0.21, width: 1.25, color: 'primary', opacity: 0.4 },
  { baseY: 64, amplitude: 9, frequency: 1.6, phase: 0.7, speed: 0.16, width: 1, color: 'violet', opacity: 0.3 },
  { baseY: 78, amplitude: 13, frequency: 0.8, phase: 3.3, speed: 0.11, width: 1.5, color: 'primary', opacity: 0.35 },
  { baseY: 90, amplitude: 7, frequency: 1.4, phase: 1.9, speed: 0.19, width: 1, color: 'violet', opacity: 0.25 },
];

const POINTS = 9; // control points per line across the width
const VIEW_W = 100;
const VIEW_H = 100;

/** Smooth curve through evenly-spaced points using quadratic midpoint smoothing. */
function buildPath(ys: number[]): string {
  const step = VIEW_W / (ys.length - 1);
  let d = `M 0 ${ys[0]!.toFixed(2)}`;
  for (let i = 0; i < ys.length - 1; i++) {
    const x0 = i * step;
    const x1 = (i + 1) * step;
    const y0 = ys[i]!;
    const y1 = ys[i + 1]!;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    d += ` Q ${x0.toFixed(2)} ${y0.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    d += ` Q ${mx.toFixed(2)} ${my.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return d;
}

export function ArtisticBackground() {
  const pathRefs = React.useRef<(SVGPathElement | null)[]>([]);

  React.useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const start = performance.now();

    const render = (t: number) => {
      const elapsed = (t - start) / 1000;
      LINES.forEach((line, i) => {
        const el = pathRefs.current[i];
        if (!el) return;
        const ys: number[] = [];
        for (let p = 0; p < POINTS; p++) {
          const x = p / (POINTS - 1);
          const y =
            line.baseY +
            Math.sin(x * line.frequency * Math.PI * 2 + line.phase + elapsed * line.speed) * line.amplitude;
          ys.push(y);
        }
        el.setAttribute('d', buildPath(ys));
      });
      if (!reduceMotion) raf = requestAnimationFrame(render);
    };

    render(start);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="line-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="15%" stopColor="white" stopOpacity="1" />
          <stop offset="85%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id="line-mask">
          <rect width={VIEW_W} height={VIEW_H} fill="url(#line-fade)" />
        </mask>
      </defs>
      <g mask="url(#line-mask)">
        {LINES.map((line, i) => (
          <path
            key={i}
            ref={(el) => {
              pathRefs.current[i] = el;
            }}
            fill="none"
            stroke={line.color === 'primary' ? 'hsl(var(--primary))' : 'hsl(259 84% 67%)'}
            strokeOpacity={line.opacity}
            strokeWidth={line.width}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
