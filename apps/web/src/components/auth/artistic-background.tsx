'use client';

import * as React from 'react';

/**
 * Generative line-art background for the auth/setup screens — a handful of
 * soft, flowing brush-stroke-like ribbons instead of thin uniform sine
 * lines: each stroke is the sum of two sine harmonics (not a single clean
 * period, so the motion never looks mechanical), rendered twice — a wide,
 * blurred "glow" pass underneath a crisp pass on top — for the soft-edged
 * depth of an actual brush stroke, with a warmer 3-colour indigo/violet/rose
 * palette instead of a flat two-tone. Mutates path `d` attributes directly
 * via refs instead of going through React state every frame — a render loop
 * at 60fps through setState would otherwise re-render the whole tree for
 * nothing.
 */

interface LineSpec {
  baseY: number; // 0–100, % of viewBox height
  amplitude: number;
  frequency: number;
  phase: number;
  speed: number;
  /** Secondary harmonic — smaller, faster or slower, different phase — is what keeps the curve from reading as a perfect, mechanical sine wave. */
  amplitude2: number;
  frequency2: number;
  phase2: number;
  speed2: number;
  width: number;
  color: 'indigo' | 'violet' | 'rose';
  opacity: number;
}

const LINES: LineSpec[] = [
  { baseY: 14, amplitude: 7, frequency: 1.1, phase: 0, speed: 0.1, amplitude2: 2.5, frequency2: 2.7, phase2: 1.1, speed2: 0.16, width: 2.2, color: 'indigo', opacity: 0.45 },
  { baseY: 30, amplitude: 10, frequency: 0.8, phase: 1.4, speed: 0.08, amplitude2: 3, frequency2: 2.1, phase2: 2.3, speed2: 0.13, width: 1.6, color: 'rose', opacity: 0.3 },
  { baseY: 47, amplitude: 13, frequency: 0.95, phase: 2.6, speed: 0.12, amplitude2: 4, frequency2: 1.9, phase2: 0.4, speed2: 0.1, width: 2, color: 'violet', opacity: 0.38 },
  { baseY: 63, amplitude: 8, frequency: 1.3, phase: 0.7, speed: 0.09, amplitude2: 2.5, frequency2: 2.4, phase2: 3.1, speed2: 0.15, width: 1.6, color: 'indigo', opacity: 0.28 },
  { baseY: 78, amplitude: 12, frequency: 0.7, phase: 3.3, speed: 0.07, amplitude2: 3.5, frequency2: 2.2, phase2: 1.7, speed2: 0.11, width: 2, color: 'rose', opacity: 0.3 },
  { baseY: 92, amplitude: 6, frequency: 1.2, phase: 1.9, speed: 0.1, amplitude2: 2, frequency2: 2.8, phase2: 0.9, speed2: 0.14, width: 1.4, color: 'violet', opacity: 0.22 },
];

const STROKE = {
  indigo: 'hsl(var(--primary))',
  violet: 'hsl(259 84% 67%)',
  rose: 'hsl(330 75% 70%)',
};

const POINTS = 11; // control points per line across the width
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

function curveY(line: LineSpec, x: number, elapsed: number): number {
  return (
    line.baseY +
    Math.sin(x * line.frequency * Math.PI * 2 + line.phase + elapsed * line.speed) * line.amplitude +
    Math.sin(x * line.frequency2 * Math.PI * 2 + line.phase2 + elapsed * line.speed2) * line.amplitude2
  );
}

export function ArtisticBackground() {
  // Two refs per line: the soft blurred glow pass, and the crisp pass on top.
  const glowRefs = React.useRef<(SVGPathElement | null)[]>([]);
  const sharpRefs = React.useRef<(SVGPathElement | null)[]>([]);

  React.useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const start = performance.now();

    const render = (t: number) => {
      const elapsed = (t - start) / 1000;
      LINES.forEach((line, i) => {
        const ys: number[] = [];
        for (let p = 0; p < POINTS; p++) {
          ys.push(curveY(line, p / (POINTS - 1), elapsed));
        }
        const d = buildPath(ys);
        glowRefs.current[i]?.setAttribute('d', d);
        sharpRefs.current[i]?.setAttribute('d', d);
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
        <filter id="brush-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>
      <g mask="url(#line-mask)">
        {/* Soft glow pass — wide, blurred, faint; gives each stroke a painted edge instead of a hard vector line. */}
        {LINES.map((line, i) => (
          <path
            key={`glow-${i}`}
            ref={(el) => {
              glowRefs.current[i] = el;
            }}
            fill="none"
            stroke={STROKE[line.color]}
            strokeOpacity={line.opacity * 0.55}
            strokeWidth={line.width * 3.2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            filter="url(#brush-blur)"
          />
        ))}
        {/* Crisp pass on top — the actual visible stroke. */}
        {LINES.map((line, i) => (
          <path
            key={`sharp-${i}`}
            ref={(el) => {
              sharpRefs.current[i] = el;
            }}
            fill="none"
            stroke={STROKE[line.color]}
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
