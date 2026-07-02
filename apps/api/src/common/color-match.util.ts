/**
 * Hue-based color matching over stored dominant-color palettes (hex strings).
 * Shared by the collection color filter and the similar-works scoring.
 */

export interface Hsl {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

export function hexToHsl(hex: string): Hsl | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Saturation below which a color reads as neutral (noir/blanc/gris) rather than a hue. */
const NEUTRAL_SATURATION = 0.12;

export type ColorTarget = { kind: 'hue'; hsl: Hsl } | { kind: 'black' } | { kind: 'white' } | { kind: 'gray' };

export function parseColorTarget(value: string): ColorTarget | null {
  const v = value.trim().toLowerCase();
  if (v === 'black') return { kind: 'black' };
  if (v === 'white') return { kind: 'white' };
  if (v === 'gray' || v === 'grey') return { kind: 'gray' };
  const hsl = hexToHsl(v);
  if (!hsl) return null;
  if (hsl.s < NEUTRAL_SATURATION) {
    if (hsl.l < 0.2) return { kind: 'black' };
    if (hsl.l > 0.8) return { kind: 'white' };
    return { kind: 'gray' };
  }
  return { kind: 'hue', hsl };
}

/** True when at least one palette entry is close to the target. */
export function paletteMatches(palette: string[], target: ColorTarget, hueTolerance = 35): boolean {
  for (const hex of palette) {
    const c = hexToHsl(hex);
    if (!c) continue;
    switch (target.kind) {
      case 'black':
        if (c.l < 0.18) return true;
        break;
      case 'white':
        if (c.l > 0.82) return true;
        break;
      case 'gray':
        if (c.s < NEUTRAL_SATURATION && c.l >= 0.18 && c.l <= 0.82) return true;
        break;
      case 'hue':
        if (c.s >= NEUTRAL_SATURATION && hueDistance(c.h, target.hsl.h) <= hueTolerance) return true;
        break;
    }
  }
  return false;
}

/** 0..1 proximity between two palettes — best pairwise hue match, for similarity scoring. */
export function paletteProximity(a: string[], b: string[]): number {
  const hslA = a.map(hexToHsl).filter((c): c is Hsl => !!c && c.s >= NEUTRAL_SATURATION);
  const hslB = b.map(hexToHsl).filter((c): c is Hsl => !!c && c.s >= NEUTRAL_SATURATION);
  if (!hslA.length || !hslB.length) return 0;
  let best = 180;
  for (const ca of hslA) for (const cb of hslB) best = Math.min(best, hueDistance(ca.h, cb.h));
  return 1 - best / 180;
}
